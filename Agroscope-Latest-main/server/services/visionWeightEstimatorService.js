/**
 * Weight Estimation (AgroScope): Gemini API primary, Vision + scale-aware math fallback.
 * Uses GEMINI_API_KEY for AI weight/volume estimate from image + context.
 * Vision OBJECT_LOCALIZATION detects Hand for scale anchor; if Gemini unavailable, uses semi-ellipsoid (handheld) or macro volume.
 */

import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';
import crypto from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getDensityKgM3, WASTE_TYPE_ID_TO_LABEL } from '../data/wasteDensities.js';
import { geminiGenerateJson, imagePart, textPart, hasGeminiKey } from './geminiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const GOOGLE_CLOUD_SCOPE = ['https://www.googleapis.com/auth/cloud-platform'];
const MAX_IMAGE_SIZE_BYTES = (process.env.VISION_MAX_IMAGE_SIZE_MB || 10) * 1024 * 1024;
const CARBON_FACTOR_KG_PER_TONNE = 1.5;
const CERTIFICATION_STANDARD = 'AgroScope Visual Estimate v1';

/**
 * Number of independent Gemini passes to run per image. Their median is used.
 * Single-shot visual weight estimation is very high variance (observed ~100x
 * spread on one photo); a 3-sample median plus a structured schema brings that
 * down to well under 2x. Samples run in parallel, so latency is ~1 call.
 */
const WEIGHT_SAMPLES = Math.min(5, Math.max(1, Number(process.env.GEMINI_WEIGHT_SAMPLES) || 3));

const ANCHOR_WIDTH_CM = {
  hand: 9.0,
  finger: 2.0,
  person: 100.0,
  macro_pile: 100.0,
};

const HANDHELD_WEIGHT_CAP_KG = 2.0;

// Lazy-load sharp so server starts even if optional sharp is missing (e.g. on Render)
let _sharp; // undefined = not loaded, null = failed, object = loaded
async function getSharp() {
  if (_sharp !== undefined) return _sharp;
  try {
    _sharp = (await import('sharp')).default;
  } catch {
    _sharp = null;
  }
  return _sharp;
}

function imageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function callVisionApi(imageBase64, apiKey, getToken) {
  const body = {
    requests: [{
      image: { content: imageBase64 },
      features: [
        { type: 'OBJECT_LOCALIZATION', maxResults: 20 },
        { type: 'IMAGE_PROPERTIES' },
        { type: 'LABEL_DETECTION', maxResults: 20 },
        { type: 'SAFE_SEARCH_DETECTION' },
        { type: 'TEXT_DETECTION' },
      ],
    }],
  };
  const url = apiKey
    ? `${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`
    : VISION_ENDPOINT;
  const headers = { 'Content-Type': 'application/json' };
  if (!apiKey && getToken) headers.Authorization = `Bearer ${await getToken()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Vision API ${res.status}`);
  return json?.responses?.[0] || {};
}

function normalizedBoxWidth(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0;
  const xs = vertices.map((v) => v.x ?? 0);
  return Math.max(0, Math.max(...xs) - Math.min(...xs));
}

function normalizedBoxHeight(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0;
  const ys = vertices.map((v) => v.y ?? 0);
  return Math.max(0, Math.max(...ys) - Math.min(...ys));
}

/**
 * Detect scale anchor from Vision localizedObjectAnnotations.
 * Returns { anchorType: 'hand'|'finger'|'macro_pile', handWidthPx, handHeightPx, vertices, name } or null for macro.
 */
function detectScaleAnchor(visionResponse, imageWidth, imageHeight) {
  const objects = visionResponse?.localizedObjectAnnotations || [];
  const w = Math.max(1, imageWidth);
  const h = Math.max(1, imageHeight);
  for (const obj of objects) {
    const name = (obj.name || '').toLowerCase();
    const verts = obj.boundingPoly?.normalizedVertices;
    if (!verts || verts.length < 2) continue;
    const nw = normalizedBoxWidth(verts);
    const nh = normalizedBoxHeight(verts);
    const widthPx = nw * w;
    const heightPx = nh * h;
    if (name === 'hand') {
      return { anchorType: 'hand', handWidthPx: widthPx, handHeightPx: heightPx, vertices: verts, name: 'Hand' };
    }
    if (name === 'finger') {
      return { anchorType: 'finger', handWidthPx: widthPx, handHeightPx: heightPx, vertices: verts, name: 'Finger' };
    }
  }
  return null;
}

/**
 * Semi-ellipsoid volume: V = (2/3) * π * a * b * c (a,b base semi-axes, c height).
 * Here we use r_width for both base radii and height = real_h_cm.
 * Volume in cm³ → weight via density in kg/m³ (1 m³ = 1,000,000 cm³).
 */
function calculateWeightHandheld(handWidthPx, pileWidthPx, pileHeightPx, imageWidth, imageHeight, densityKgM3, anchorType) {
  const anchorCm = ANCHOR_WIDTH_CM[anchorType] ?? ANCHOR_WIDTH_CM.hand;
  if (!(handWidthPx > 0)) {
    const fallbackVolumeCm3 = 200;
    const volumeM3 = fallbackVolumeCm3 / 1_000_000;
    return { weightKg: volumeM3 * densityKgM3, volumeM3, volumeCm3: fallbackVolumeCm3 };
  }
  const pixelsToCm = anchorCm / handWidthPx;
  const realWidthCm = pileWidthPx * pixelsToCm;
  const realHeightCm = pileHeightPx * pixelsToCm;
  const rWidth = realWidthCm / 2;
  const volumeCm3 = (2 / 3) * Math.PI * (rWidth * rWidth) * Math.max(0.5, realHeightCm);
  const volumeM3 = volumeCm3 / 1_000_000;
  let weightKg = volumeM3 * densityKgM3;
  if (anchorType === 'hand' || anchorType === 'finger') {
    // Cap at what a hand can physically hold. This used to collapse anything
    // over 0.5 kg to a flat 0.025 kg — a 20x understatement — rather than
    // simply clamping to the cap.
    weightKg = Math.min(weightKg, HANDHELD_WEIGHT_CAP_KG);
  }
  return { weightKg, volumeM3, volumeCm3 };
}

/**
 * Macro mode: no hand anchor. Use frame coverage to estimate volume in m³.
 * Adjusted for "Demo/Tabletop" context to avoid 114kg values for small unanchored shots.
 */
function calculateWeightMacro(frameCoveragePercent, densityKgM3) {
  const coverage = Math.min(95, Math.max(5, frameCoveragePercent || 25)) / 100;
  // Previously assumed massive 2.5m³ fallback:
  // const volumeM3 = coverage * 2.5; 
  // For LIVE DEMOS, typically taking place on a table, 0.05m³ (50 Liters max volume) is more reasonable when scaling without explicit anchor. 
  const assumedMaxVolume = 0.05; 
  const volumeM3 = coverage * assumedMaxVolume;
  const fillFactor = 0.4;
  const weightKg = volumeM3 * densityKgM3 * fillFactor;
  return { weightKg, volumeM3, volumeCm3: volumeM3 * 1_000_000 };
}

/** Frame coverage from Vision bounding boxes (sum of areas, normalized 0–1). */
function frameCoverageFromVision(visionResponse) {
  const objects = visionResponse?.localizedObjectAnnotations || [];
  if (objects.length === 0) return null;
  let total = 0;
  for (const obj of objects) {
    const verts = obj.boundingPoly?.normalizedVertices;
    if (!Array.isArray(verts) || verts.length < 3) continue;
    const w = normalizedBoxWidth(verts);
    const h = normalizedBoxHeight(verts);
    total += w * h;
  }
  const percent = Math.min(100, Math.round(total * 100));
  return percent > 0 ? percent : null;
}

const GEMINI_MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const GEMINI_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

async function resizeForGemini(buffer, mimeType) {
  const sharp = await getSharp();
  const mt = (mimeType || 'image/jpeg').toLowerCase();
  const needsConvert = !GEMINI_IMAGE_TYPES.includes(mt);
  const needsResize = sharp && buffer.length > GEMINI_MAX_IMAGE_BYTES;
  if (!sharp || (!needsConvert && !needsResize)) {
    return { buffer, mimeType: GEMINI_IMAGE_TYPES.includes(mt) ? mt : 'image/jpeg' };
  }
  try {
    let pipeline = sharp(buffer);
    if (needsResize) pipeline = pipeline.resize(1024, 1024, { fit: 'inside', withoutEnlargement: true });
    const out = await pipeline.jpeg({ quality: 85 }).toBuffer();
    return { buffer: out, mimeType: 'image/jpeg' };
  } catch (_) {
    return { buffer, mimeType: mt };
  }
}

async function sharpAnalysis(buffer) {
  const sharp = await getSharp();
  if (!sharp) {
    return { width: 0, height: 0, channels: 0, aspectRatio: 1, imageAngle: 'unknown' };
  }
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const aspectRatio = width && height ? width / height : 1;
  let imageAngle = 'unknown';
  if (aspectRatio >= 1.2) imageAngle = 'top-down';
  else if (aspectRatio <= 0.85) imageAngle = 'side';
  else if (aspectRatio > 0.9 && aspectRatio < 1.15) imageAngle = 'angled';
  return {
    width,
    height,
    channels: meta.channels || 0,
    aspectRatio,
    imageAngle,
  };
}

const SCALE_ANCHOR_HINTS = {
  AGR_002: 'Identify individual sugarcane stalks or fibrous pieces. Typical stalk diameter is 2–5 cm; use this as your visual ruler. Do NOT guess pile volume directly.',
  AGR_001: 'Identify stalks, straw strands, or a hand if visible. Straw diameter ~0.3–0.5 cm; hand width ~9 cm. Use one as your visual ruler.',
  AGR_003: 'Identify corn stalks or cobs. Stalk diameter ~2–3 cm, cob length ~15–20 cm. Use as visual ruler.',
  COCO_SHL: 'Identify coconut shell fragments. Typical piece ~5–10 cm. Use as visual ruler.',
  DEFAULT: 'Identify the smallest visible repeated unit (stalks, pieces, or a hand ~9 cm) and state its real-world size in cm. Use it as your visual ruler.',
};

function getScaleAnchorHint(wasteTypeId) {
  return SCALE_ANCHOR_HINTS[wasteTypeId] || SCALE_ANCHOR_HINTS.DEFAULT;
}

/**
 * Structured schema for weight estimation.
 *
 * Forcing the model to emit its scale reference and the three measured
 * dimensions BEFORE the weight is what makes the estimate stable: it cannot
 * jump straight to a guessed number, and the server can re-derive the volume
 * from the dimensions to catch arithmetic errors.
 */
const WEIGHT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sceneScale: {
      type: 'STRING',
      enum: ['handful', 'tabletop', 'sack_or_crate', 'small_heap', 'large_pile', 'truckload'],
    },
    scaleReference: { type: 'STRING', description: 'The visible object used as a ruler' },
    scaleReferenceRealSizeCm: { type: 'NUMBER' },
    widthCm: { type: 'NUMBER' },
    lengthCm: { type: 'NUMBER' },
    depthCm: { type: 'NUMBER' },
    geometryAssumed: {
      type: 'STRING',
      enum: ['box', 'cone', 'cylinder', 'dome', 'irregular_heap'],
    },
    fillFactor: { type: 'NUMBER', description: '0.3-0.9 fraction of the bounding shape actually filled' },
    estimatedVolumeCubicMetres: { type: 'NUMBER' },
    estimatedWeightKg: { type: 'NUMBER' },
    confidencePercent: { type: 'NUMBER' },
    materialMatchesDeclaredType: { type: 'BOOLEAN' },
    reasoning: { type: 'STRING', description: 'Show the actual arithmetic for each step' },
    warningFlags: { type: 'ARRAY', items: { type: 'STRING' } },
    improvementSuggestions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'sceneScale', 'scaleReference', 'scaleReferenceRealSizeCm', 'widthCm', 'lengthCm',
    'depthCm', 'geometryAssumed', 'fillFactor', 'estimatedVolumeCubicMetres',
    'estimatedWeightKg', 'confidencePercent', 'materialMatchesDeclaredType', 'reasoning',
  ],
};

/** Plausible weight band per scene scale, used to catch order-of-magnitude errors. */
const SCENE_SCALE_BANDS_KG = {
  handful: [0.01, 2],
  tabletop: [0.1, 8],
  sack_or_crate: [3, 80],
  small_heap: [30, 700],
  large_pile: [200, 6000],
  truckload: [1500, 40000],
};

function buildWeightPrompt(context) {
  return `You are a measurement expert estimating the mass of agricultural waste from ONE photograph.

CONTEXT
${JSON.stringify(context, null, 2)}

Follow every step in order. Do not skip ahead to a weight.

STEP 1 — CLASSIFY THE SCENE SCALE
Decide sceneScale from what is genuinely visible:
  handful        a sample held in one hand, under 1 kg
  tabletop       a bowl, plate or small sample on a surface, 0.2-8 kg
  sack_or_crate  a bag, sack or crate of material, 5-80 kg
  small_heap     a knee-high heap on the ground, 50-700 kg
  large_pile     a waist-high or taller yard pile, 300-6000 kg
  truckload      fills a trailer or truck bed, over 2000 kg
Use people, hands, vehicles, doorways, walls and tools as cues. Do NOT assume the sample is
small unless the photo actually shows a small sample, and do NOT assume a huge pile from a
close-up crop. Judge honestly from the framing.

STEP 2 — PICK A SCALE REFERENCE
Name ONE clearly visible object of known real size and give scaleReferenceRealSizeCm.
Useful anchors: adult hand width 9 cm, finger width 2 cm, whole coconut 15 cm, coconut shell
half 12 cm, brick 19 cm, standard sack 60 cm, car wheel 60 cm, adult height 170 cm,
doorway height 200 cm, straw stalk diameter 0.4 cm, sugarcane stalk diameter 3 cm,
maize cob 18 cm. If nothing reliable is visible, say so in scaleReference, choose the most
likely framing, and lower confidencePercent accordingly.

STEP 3 — MEASURE THE MATERIAL
Using that reference as a ruler, give widthCm, lengthCm and depthCm of the material itself
(not the whole photo). depthCm is the height of the heap or the depth of the container.

STEP 4 — COMPUTE VOLUME
Pick geometryAssumed and compute estimatedVolumeCubicMetres from your Step 3 dimensions,
converting cm to m by dividing by 100. Apply fillFactor (0.3-0.9) for how much of that
bounding shape the material actually occupies.
  box            V = w x l x d
  cone           V = (1/3) x pi x (w/2)^2 x d
  cylinder       V = pi x (w/2)^2 x d
  dome           V = (2/3) x pi x (w/2) x (l/2) x d
  irregular_heap V = w x l x d x 0.5

STEP 5 — APPLY DENSITY
estimatedWeightKg = estimatedVolumeCubicMetres x densityKgM3 x fillFactor, using the
densityKgM3 from CONTEXT. That density is a bulk density and already accounts for the air
gaps between pieces. Do the arithmetic carefully and show it in reasoning.

STEP 6 — SANITY CHECK
Confirm your weight sits inside the plausible band for the sceneScale you chose in Step 1.
If it does not, recheck Step 3 — the dimensions are usually the error. Never force the answer
to a preset value; correct the measurement instead.

Set materialMatchesDeclaredType to false if the visible material is clearly not the
wasteTypeLabel given in CONTEXT, and add a warning flag saying what you actually see.
Set confidencePercent honestly: 80+ only with a solid scale reference and a fully visible
pile; below 45 when the scale is guesswork or the material is cropped out of frame.`;
}

/** Recompute volume from the model's own dimensions, so bad arithmetic is caught. */
function volumeFromDimensions(widthCm, lengthCm, depthCm, geometry) {
  const w = Math.max(0, Number(widthCm) || 0) / 100;
  const l = Math.max(0, Number(lengthCm) || 0) / 100;
  const d = Math.max(0, Number(depthCm) || 0) / 100;
  if (!(w > 0 && l > 0 && d > 0)) return null;
  switch (geometry) {
    case 'cone':
      return (1 / 3) * Math.PI * (w / 2) * (l / 2) * d;
    case 'cylinder':
      return Math.PI * (w / 2) * (l / 2) * d;
    case 'dome':
      return (2 / 3) * Math.PI * (w / 2) * (l / 2) * d;
    case 'irregular_heap':
      return w * l * d * 0.5;
    case 'box':
    default:
      return w * l * d;
  }
}

/**
 * Validate and repair one Gemini sample.
 * Returns null when the sample is unusable.
 */
function normaliseSample(json, densityKgM3) {
  if (!json || typeof json !== 'object') return null;

  const geometry = String(json.geometryAssumed || 'irregular_heap');
  const fillFactor = Math.min(0.95, Math.max(0.2, Number(json.fillFactor) || 0.5));
  const modelWeight = Number(json.estimatedWeightKg);
  const modelVolume = Number(json.estimatedVolumeCubicMetres);

  // Prefer volume re-derived from the reported dimensions; the model's own
  // multiplication is the step it most often gets wrong.
  const derivedVolume = volumeFromDimensions(json.widthCm, json.lengthCm, json.depthCm, geometry);
  const volume = Number.isFinite(derivedVolume) && derivedVolume > 0
    ? derivedVolume
    : (Number.isFinite(modelVolume) && modelVolume > 0 ? modelVolume : null);

  let weightKg = null;
  let recomputed = false;
  if (volume) {
    const derivedWeight = volume * densityKgM3 * fillFactor;
    // Trust the model's number when it broadly agrees with the geometry; if it
    // is off by more than 3x, the arithmetic is wrong — use the derived value.
    if (Number.isFinite(modelWeight) && modelWeight > 0) {
      const ratio = derivedWeight > 0 ? modelWeight / derivedWeight : Infinity;
      if (ratio > 3 || ratio < 1 / 3) {
        weightKg = derivedWeight;
        recomputed = true;
      } else {
        weightKg = modelWeight;
      }
    } else {
      weightKg = derivedWeight;
      recomputed = true;
    }
  } else if (Number.isFinite(modelWeight) && modelWeight > 0) {
    weightKg = modelWeight;
  }

  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 1e6) return null;

  // Clamp into the plausible band for the scene the model itself identified.
  const scene = String(json.sceneScale || '');
  const band = SCENE_SCALE_BANDS_KG[scene];
  let clampedToBand = false;
  if (band) {
    const [lo, hi] = band;
    if (weightKg < lo) { weightKg = lo; clampedToBand = true; }
    else if (weightKg > hi) { weightKg = hi; clampedToBand = true; }
  }

  return {
    estimatedWeightKg: weightKg,
    estimatedVolumeCubicMetres: volume || weightKg / Math.max(1, densityKgM3),
    confidencePercent: Math.min(100, Math.max(0, Number(json.confidencePercent) || 60)),
    sceneScale: scene || 'unknown',
    scaleReference: String(json.scaleReference || 'none identified').slice(0, 160),
    scaleReferenceRealSizeCm: Number(json.scaleReferenceRealSizeCm) || null,
    dimensionsCm: {
      width: Number(json.widthCm) || null,
      length: Number(json.lengthCm) || null,
      depth: Number(json.depthCm) || null,
    },
    geometryAssumed: geometry,
    fillFactor,
    materialMatchesDeclaredType: json.materialMatchesDeclaredType !== false,
    reasoning: String(json.reasoning || '').slice(0, 2000),
    warningFlags: Array.isArray(json.warningFlags) ? json.warningFlags.map(String) : [],
    improvementSuggestions: Array.isArray(json.improvementSuggestions)
      ? json.improvementSuggestions.map(String)
      : [],
    recomputed,
    clampedToBand,
  };
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Run N independent passes and combine them by median.
 *
 * Self-consistency is what makes this trustworthy: any single pass can misjudge
 * the scale badly, but the median of several rarely does. The spread across
 * samples also gives an honest confidence signal and a real weight range.
 */
async function callGemini(imageBase64, mimeType, context) {
  if (!hasGeminiKey()) {
    console.warn('Gemini: GEMINI_API_KEY is not set in server/.env');
    return { result: null, noKey: true, errorMessage: null };
  }

  const densityKgM3 = Number(context.densityKgM3) || 120;
  const basePrompt = buildWeightPrompt(context);

  const runSample = async (index) => {
    const out = await geminiGenerateJson({
      parts: [
        imagePart(imageBase64, mimeType),
        // Vary the trailing line so identical prompts do not collapse to an
        // identical cached completion across samples.
        textPart(`${basePrompt}\n\n(independent analysis pass ${index + 1} of ${WEIGHT_SAMPLES})`),
      ],
      schema: WEIGHT_SCHEMA,
      temperature: 0.35,
      maxOutputTokens: 4096,
      timeoutMs: 90000,
      maxRetries: 1,
    });
    if (!out.ok) return { error: out.error };
    return { sample: normaliseSample(out.json, densityKgM3), model: out.model };
  };

  const settled = await Promise.all(
    Array.from({ length: WEIGHT_SAMPLES }, (_, i) => runSample(i).catch((e) => ({ error: e?.message || 'sample failed' }))),
  );

  const samples = settled.map((s) => s.sample).filter(Boolean);
  const errors = settled.map((s) => s.error).filter(Boolean);
  const modelUsed = settled.find((s) => s.model)?.model || null;

  if (samples.length === 0) {
    const message = errors[0] || 'Gemini returned no usable estimate';
    console.warn('Gemini weight estimation failed:', message);
    return { result: null, noKey: false, errorMessage: message };
  }

  const weights = samples.map((s) => s.estimatedWeightKg);
  const medianWeight = median(weights);
  // The sample closest to the median carries the reasoning we report, so the
  // explanation always matches the number shown.
  const representative = samples.reduce((best, s) =>
    Math.abs(s.estimatedWeightKg - medianWeight) < Math.abs(best.estimatedWeightKg - medianWeight) ? s : best,
  samples[0]);

  const lo = Math.min(...weights);
  const hi = Math.max(...weights);
  const spreadRatio = lo > 0 ? hi / lo : Infinity;

  // Agreement between samples is strong evidence; disagreement is a real warning.
  let confidence = median(samples.map((s) => s.confidencePercent));
  if (samples.length > 1) {
    if (spreadRatio <= 1.3) confidence = Math.min(95, confidence + 10);
    else if (spreadRatio <= 2) confidence = Math.min(90, confidence);
    else if (spreadRatio <= 4) confidence = Math.max(25, confidence - 20);
    else confidence = Math.max(15, confidence - 35);
  } else {
    confidence = Math.min(confidence, 60);
  }

  const warningFlags = [...new Set(samples.flatMap((s) => s.warningFlags))];
  const improvementSuggestions = [...new Set(samples.flatMap((s) => s.improvementSuggestions))];
  if (samples.length > 1 && spreadRatio > 2.5) {
    warningFlags.push(
      `AI passes disagreed (${lo.toFixed(1)}-${hi.toFixed(1)} kg) — scale is ambiguous in this photo.`,
    );
    improvementSuggestions.push('Include a known object (your hand, a sack or a brick) beside the material for scale.');
  }
  if (!representative.materialMatchesDeclaredType) {
    warningFlags.push('The material in the photo may not match the selected waste type.');
  }
  if (samples.length < WEIGHT_SAMPLES && errors.length) {
    improvementSuggestions.push(`${errors.length} of ${WEIGHT_SAMPLES} AI passes failed — estimate uses ${samples.length}.`);
  }

  return {
    result: {
      estimatedWeightKg: medianWeight,
      estimatedVolumeCubicMetres: representative.estimatedVolumeCubicMetres,
      confidencePercent: Math.round(confidence),
      // A real observed range beats a fixed +/-40% guess.
      weightRangeKg: samples.length > 1
        ? { min: lo, max: hi }
        : { min: medianWeight * 0.6, max: medianWeight * 1.5 },
      densityUsedKgM3: densityKgM3,
      geometryAssumed: representative.geometryAssumed,
      estimationMethod: `Gemini scale-anchored measurement (${representative.scaleReference}`
        + `${representative.scaleReferenceRealSizeCm ? ` ≈ ${representative.scaleReferenceRealSizeCm} cm` : ''})`
        + `, median of ${samples.length} pass${samples.length > 1 ? 'es' : ''}`,
      reasoning: representative.reasoning,
      sceneScale: representative.sceneScale,
      scaleReference: representative.scaleReference,
      dimensionsCm: representative.dimensionsCm,
      fillFactor: representative.fillFactor,
      sampleWeightsKg: weights,
      sampleCount: samples.length,
      agreementRatio: Number.isFinite(spreadRatio) ? Number(spreadRatio.toFixed(2)) : null,
      materialMatchesDeclaredType: representative.materialMatchesDeclaredType,
      warningFlags,
      improvementSuggestions,
      model: modelUsed,
    },
    noKey: false,
    errorMessage: null,
  };
}

export { testGeminiConnection } from './geminiClient.js';

export async function estimateWeightFromBuffer({
  buffer,
  mimeType,
  wasteTypeId,
  optionalReferenceObject,
  optionalMeasurement,
  unit = 'kg',
  userId = null,
  listingId = null,
}) {
  const start = Date.now();
  if (!buffer || buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(buffer?.length > MAX_IMAGE_SIZE_BYTES ? 'Image exceeds 10MB' : 'No image provided');
  }
  const visionBase64 = buffer.toString('base64');
  const { buffer: geminiBuffer, mimeType: geminiMime } = await resizeForGemini(buffer, mimeType);
  const geminiBase64 = geminiBuffer.toString('base64');

  // Cloud Vision only — a Gemini/AI Studio key is NOT valid here (Vision rejects
  // API keys outright with 401 CREDENTIALS_MISSING), so never pass it through.
  const visionApiKey = (
    (process.env.GOOGLE_VISION_API_KEY || '').trim() ||
    (process.env.GOOGLE_CLOUD_VISION_API_KEY || '').trim()
  );
  let getToken;
  if (!visionApiKey && (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) {
    const auth = new GoogleAuth({ scopes: GOOGLE_CLOUD_SCOPE });
    getToken = async () => {
      const client = await auth.getClient();
      const creds = await client.authorize();
      return creds.access_token;
    };
  }
  const visionEnabled = Boolean(visionApiKey || getToken);

  let visionResponse = {};
  let sharpResult = { width: 0, height: 0, channels: 0, aspectRatio: 1, imageAngle: 'unknown' };

  // allSettled, not all: a Vision failure must not discard the sharp metadata.
  // (Previously one rejected promise threw away the image dimensions, leaving
  // width/height at 1 and starving the estimator of context.)
  const [visionSettled, sharpSettled] = await Promise.allSettled([
    visionEnabled ? callVisionApi(visionBase64, visionApiKey, getToken) : Promise.resolve({}),
    sharpAnalysis(buffer),
  ]);
  if (visionSettled.status === 'fulfilled') {
    visionResponse = visionSettled.value || {};
  } else if (visionEnabled) {
    console.warn('Vision API error:', visionSettled.reason?.message || visionSettled.reason);
  }
  if (sharpSettled.status === 'fulfilled') {
    sharpResult = sharpSettled.value || sharpResult;
  } else {
    console.warn('Sharp metadata error:', sharpSettled.reason?.message || sharpSettled.reason);
  }

  const safeSearch = visionResponse.safeSearchAnnotation || {};
  const adult = String(safeSearch.adult || '').toUpperCase();
  const violence = String(safeSearch.violence || '').toUpperCase();
  if (adult === 'LIKELY' || adult === 'VERY_LIKELY' || violence === 'LIKELY' || violence === 'VERY_LIKELY') {
    throw new Error('Invalid image content');
  }

  const imageWidth = sharpResult.width || 1;
  const imageHeight = sharpResult.height || 1;
  const densityKgM3 = getDensityKgM3(wasteTypeId);
  const anchor = detectScaleAnchor(visionResponse, imageWidth, imageHeight);
  const hasWasteType = wasteTypeId && wasteTypeId !== 'DEFAULT';
  const userSelectedLabel = WASTE_TYPE_ID_TO_LABEL[wasteTypeId] || (wasteTypeId ? `Waste type ${wasteTypeId}` : null);
  const scaleAnchorLabel = anchor && (anchor.anchorType === 'hand' || anchor.anchorType === 'finger')
    ? (anchor.name === 'Hand' ? 'Human Hand' : anchor.name)
    : 'None';
  const isHandheld = scaleAnchorLabel !== 'None';

  const geminiContext = {
    wasteTypeId,
    wasteTypeLabel: userSelectedLabel,
    densityKgM3,
    scaleAnchorDetected: scaleAnchorLabel,
    isHandheld,
    scaleAnchorHint: getScaleAnchorHint(wasteTypeId),
    detectedLabels: (visionResponse.labelAnnotations || []).map((l) => l.description),
    detectedObjects: (visionResponse.localizedObjectAnnotations || []).map((o) => o.name),
    imageDimensions: { width: imageWidth, height: imageHeight },
    frameCoveragePercent: frameCoverageFromVision(visionResponse) ?? null,
  };

  let weightKg;
  let volumeM3;
  let volumeCm3;
  let geometryAssumed;
  let estimationMethod;
  let confidencePercent;
  let reasoning;
  let warningFlags = [];
  let improvementSuggestions = [];
  let geminiDetail = null;

  const { result: geminiResult, noKey: geminiNoKey, errorMessage: geminiError } = await callGemini(geminiBase64, geminiMime || mimeType || 'image/jpeg', geminiContext);

  if (geminiResult && Number.isFinite(geminiResult.estimatedWeightKg)) {
    weightKg = Number(geminiResult.estimatedWeightKg);
    volumeM3 = Number(geminiResult.estimatedVolumeCubicMetres) || weightKg / densityKgM3;
    volumeCm3 = volumeM3 * 1_000_000;
    // Only clamp when Vision actually saw a hand AND the model itself judged the
    // scene to be hand-scale. The previous code slammed any handheld result over
    // 0.5 kg down to a flat 0.025 kg, which destroyed otherwise good estimates.
    if (isHandheld && geminiResult.sceneScale === 'handful' && weightKg > HANDHELD_WEIGHT_CAP_KG) {
      warningFlags.push(`Capped to ${HANDHELD_WEIGHT_CAP_KG} kg — a hand-held sample cannot weigh more.`);
      weightKg = HANDHELD_WEIGHT_CAP_KG;
      volumeM3 = weightKg / densityKgM3;
      volumeCm3 = volumeM3 * 1_000_000;
    }
    geometryAssumed = String(geminiResult.geometryAssumed || 'unknown');
    estimationMethod = String(geminiResult.estimationMethod || 'Gemini AI').slice(0, 200);
    confidencePercent = Math.min(100, Math.max(0, Number(geminiResult.confidencePercent) || 70));
    reasoning = String(geminiResult.reasoning || '');
    warningFlags = [...warningFlags, ...(Array.isArray(geminiResult.warningFlags) ? geminiResult.warningFlags : [])];
    improvementSuggestions = Array.isArray(geminiResult.improvementSuggestions) ? geminiResult.improvementSuggestions : [];
    geminiDetail = {
      sceneScale: geminiResult.sceneScale,
      scaleReference: geminiResult.scaleReference,
      dimensionsCm: geminiResult.dimensionsCm,
      fillFactor: geminiResult.fillFactor,
      sampleWeightsKg: geminiResult.sampleWeightsKg,
      sampleCount: geminiResult.sampleCount,
      agreementRatio: geminiResult.agreementRatio,
      materialMatchesDeclaredType: geminiResult.materialMatchesDeclaredType,
      model: geminiResult.model,
      weightRangeKg: geminiResult.weightRangeKg,
    };
  } else {
    if (anchor && (anchor.anchorType === 'hand' || anchor.anchorType === 'finger')) {
      const pileWidthPx = anchor.handWidthPx * 1.0;
      const pileHeightPx = Math.max(anchor.handHeightPx * 0.6, anchor.handWidthPx * 0.4);
      const result = calculateWeightHandheld(
        anchor.handWidthPx,
        pileWidthPx,
        pileHeightPx,
        imageWidth,
        imageHeight,
        densityKgM3,
        anchor.anchorType,
      );
      weightKg = result.weightKg;
      volumeM3 = result.volumeM3;
      volumeCm3 = result.volumeCm3;
      geometryAssumed = 'semi-ellipsoid (handheld)';
      estimationMethod = `Scale anchor: ${scaleAnchorLabel} (9 cm). Semi-ellipsoid volume, density ${densityKgM3} kg/m³. (Gemini unavailable, fallback.)`;
      confidencePercent = 75;
      reasoning = `Hand detected. Fallback: reference width ${ANCHOR_WIDTH_CM[anchor.anchorType]} cm, volume ${(volumeCm3 / 1000).toFixed(2)} L. Weight = volume × ${densityKgM3} kg/m³.`;
      improvementSuggestions = geminiNoKey ? ['Add GEMINI_API_KEY to server .env for AI-powered estimates.'] : (geminiError ? [`Gemini: ${geminiError}`] : ['Gemini AI was unavailable; check API key and quota.']);
    } else {
      const coverage = frameCoverageFromVision(visionResponse) ?? 25;
      const result = calculateWeightMacro(coverage, densityKgM3);
      weightKg = result.weightKg;
      volumeM3 = result.volumeM3;
      volumeCm3 = result.volumeCm3;
      geometryAssumed = 'irregular heap';
      estimationMethod = `Macro mode (no hand). Frame coverage ${coverage}%, density ${densityKgM3} kg/m³. (Gemini unavailable, fallback.)`;
      confidencePercent = 45;
      reasoning = geminiNoKey
        ? 'No hand detected. Fallback from frame coverage and density. Add GEMINI_API_KEY to server .env for AI estimates.'
        : `No hand detected. Fallback from frame coverage and density. ${geminiError ? `Gemini: ${geminiError}` : 'Gemini AI was unavailable (check API key and quota).'}`;
      warningFlags = ['No scale anchor detected — confidence reduced.'];
      improvementSuggestions = ['Include your hand in the frame for handheld samples.', ...(geminiNoKey ? ['Set GEMINI_API_KEY in server/.env for Gemini AI estimates.'] : (geminiError ? [`Gemini: ${geminiError}`] : ['Check Gemini API key and quota.']))];
    }
  }

  // Prefer the range actually observed across AI passes over a fixed ±40% guess.
  const minKg = geminiDetail?.weightRangeKg?.min ?? weightKg * 0.6;
  const maxKg = geminiDetail?.weightRangeKg?.max ?? weightKg * 1.5;
  const estimatedWeightTonnes = weightKg / 1000;
  const wasteCreditPreview = (weightKg / 1000) * densityKgM3 * 0.001 * CARBON_FACTOR_KG_PER_TONNE * 10;
  const processingTimeMs = Date.now() - start;

  const dims = geminiDetail?.dimensionsCm || null;
  const anchorsUsed = [];
  if (scaleAnchorLabel !== 'None') anchorsUsed.push(`Scale Anchor: ${scaleAnchorLabel}`);
  if (geminiDetail?.scaleReference) anchorsUsed.push(`AI reference: ${geminiDetail.scaleReference}`);

  const estimation = {
    estimatedWeightKg: weightKg,
    estimatedWeightTonnes,
    confidencePercent,
    weightRangeKg: { min: minKg, max: maxKg },
    estimatedVolumeCubicMetres: volumeM3,
    volumeLiters: volumeM3 < 0.01 ? volumeM3 * 1000 : null,
    volumeMl: volumeM3 < 0.01 ? volumeM3 * 1_000_000 : null,
    densityUsedKgM3: densityKgM3,
    geometryAssumed,
    estimationMethod,
    anchorsUsed,
    materialConfidence: hasWasteType ? 'high' : 'medium',
    wasteTypeConfirmed: Boolean(hasWasteType),
    wasteTypeDetected: userSelectedLabel || 'Unknown',
    dimensionEstimatesMetres: dims
      ? {
        estimatedLength: dims.length ? dims.length / 100 : null,
        estimatedWidth: dims.width ? dims.width / 100 : null,
        estimatedHeight: dims.depth ? dims.depth / 100 : null,
      }
      : { estimatedLength: null, estimatedWidth: null, estimatedHeight: null },
    reasoning,
    warningFlags: warningFlags.length ? warningFlags : [],
    improvementSuggestions: improvementSuggestions.length ? improvementSuggestions : [],
    wasteCreditPreview: Math.round(wasteCreditPreview * 100) / 100,
    certificationStandard: CERTIFICATION_STANDARD,
    scaleAnchor: geminiDetail?.scaleReference || scaleAnchorLabel,
    isHandheld,
    imageAngle: sharpResult.imageAngle || 'unknown',
    // Diagnostics: how the number was reached and how much the passes agreed.
    aiSceneScale: geminiDetail?.sceneScale || null,
    aiSampleWeightsKg: geminiDetail?.sampleWeightsKg || null,
    aiSampleCount: geminiDetail?.sampleCount || 0,
    aiAgreementRatio: geminiDetail?.agreementRatio ?? null,
    aiModel: geminiDetail?.model || null,
    usedAi: Boolean(geminiDetail),
  };

  const imageAnalysis = {
    dominantColors: (visionResponse.imagePropertiesAnnotation?.dominantColors?.colors || []).slice(0, 5).map((c) => {
      const rgb = c.color || {};
      return `rgb(${rgb.red ?? 0},${rgb.green ?? 0},${rgb.blue ?? 0})`;
    }),
    detectedLabels: (visionResponse.labelAnnotations || []).map((l) => l.description),
    detectedObjects: (visionResponse.localizedObjectAnnotations || []).map((o) => o.name),
    frameCoveragePercent: frameCoverageFromVision(visionResponse) ?? 0,
    imageAngle: sharpResult.imageAngle || 'unknown',
    textFoundInImage: (visionResponse.textAnnotations || []).slice(0, 5).map((t) => t.description).filter(Boolean),
  };

  return {
    success: true,
    estimation,
    imageAnalysis,
    processingTimeMs,
    imageHash: imageHash(buffer),
  };
}
