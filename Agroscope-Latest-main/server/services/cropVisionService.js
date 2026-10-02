// server/services/cropVisionService.js
// Detect crop type from an image. Gemini is the primary detector; Google Cloud
// Vision label detection is used only when a real Vision credential is present
// (Vision rejects plain API keys, so a Gemini key alone can never drive it).

import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';
import { geminiGenerateJson, imagePart, textPart, hasGeminiKey } from './geminiClient.js';

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const GOOGLE_CLOUD_SCOPE = ['https://www.googleapis.com/auth/cloud-platform'];
const MAX_LABEL_RESULTS = 10;

// International agricultural waste types — match Vision API labels to our crop types (order: more specific first).
const CROP_LABEL_RULES = [
  { cropType: 'Coconut Shells', keywords: ['coconut', 'coconut shell', 'coconut husk', 'coco', 'coco shell', 'nut shell', 'shell'] },
  { cropType: 'Paddy Husk', keywords: ['paddy', 'rice paddy', 'rice field', 'rice plant', 'rice', 'husk', 'rice husk'] },
  { cropType: 'Rice Straw', keywords: ['rice straw', 'rice stalk'] },
  { cropType: 'Rice Husk', keywords: ['rice husk', 'rice hull'] },
  { cropType: 'Wheat Straw', keywords: ['wheat', 'wheat field', 'wheat straw', 'straw', 'hay', 'grain field'] },
  { cropType: 'Corn Stalks', keywords: ['corn', 'maize', 'corn field', 'corn stalk', 'maize field', 'stalk'] },
  { cropType: 'Maize Cob', keywords: ['corn cob', 'maize cob', 'cob'] },
  { cropType: 'Barley Straw', keywords: ['barley', 'barley straw'] },
  { cropType: 'Oat Straw', keywords: ['oat', 'oat straw', 'oats'] },
  { cropType: 'Sugarcane Bagasse', keywords: ['sugarcane', 'sugar cane', 'bagasse'] },
  { cropType: 'Groundnut Shell', keywords: ['groundnut', 'peanut', 'peanut shell', 'nut shell'] },
  { cropType: 'Cotton Stalk', keywords: ['cotton', 'cotton stalk', 'cotton plant'] },
  { cropType: 'Mustard Stalk', keywords: ['mustard', 'mustard plant', 'mustard stalk'] },
  { cropType: 'Soybean Stalk', keywords: ['soybean', 'soya', 'soy bean'] },
  { cropType: 'Sunflower Stalk', keywords: ['sunflower', 'sunflower stalk'] },
  { cropType: 'Palm Empty Fruit Bunch', keywords: ['palm', 'oil palm', 'efb', 'fruit bunch', 'palm oil'] },
  { cropType: 'Coffee Husk', keywords: ['coffee', 'coffee husk', 'coffee bean'] },
  { cropType: 'Tea Waste', keywords: ['tea', 'tea plant', 'tea leaf'] },
  { cropType: 'Banana Waste', keywords: ['banana', 'banana plant', 'banana peel'] },
  { cropType: 'Mango Waste', keywords: ['mango', 'mango peel', 'mango seed'] },
  { cropType: 'Vegetable Waste', keywords: ['vegetable', 'veg', 'leafy vegetable'] },
  { cropType: 'Fruit Waste', keywords: ['fruit', 'fruit waste'] },
  { cropType: 'Jute Stalk', keywords: ['jute', 'jute plant', 'jute stalk'] },
  { cropType: 'Castor Stalk', keywords: ['castor', 'castor bean', 'castor plant'] },
  { cropType: 'Sesame Stalk', keywords: ['sesame', 'sesame seed', 'sesame plant'] },
  { cropType: 'Potato Vine', keywords: ['potato', 'potato plant', 'potato vine'] },
  { cropType: 'Tomato Waste', keywords: ['tomato', 'tomato plant', 'tomato vine'] },
  { cropType: 'Gram / Chickpea Stalk', keywords: ['chickpea', 'gram', 'chana', 'garbanzo'] },
  { cropType: 'Tur / Pigeon Pea Stalk', keywords: ['pigeon pea', 'tur', 'arhar', 'toor', 'cajanus'] },
  { cropType: 'Oilseed Waste', keywords: ['oilseed', 'oil seed'] },
  { cropType: 'Brewery Spent Grains', keywords: ['brewery', 'spent grain', 'barley grain', 'malt'] },
  { cropType: 'Sorghum Stalk', keywords: ['sorghum', 'sorghum stalk', 'jowar'] },
  { cropType: 'Rye Straw', keywords: ['rye', 'rye straw', 'rye grain'] },
  { cropType: 'Millet Straw', keywords: ['millet', 'millet straw', 'bajra', 'finger millet'] },
  { cropType: 'Lentil Stalk', keywords: ['lentil', 'lentil plant', 'masoor'] },
  { cropType: 'Cowpea / Black-Eyed Pea Stalk', keywords: ['cowpea', 'black-eyed pea', 'black eyed pea', 'lobia'] },
  { cropType: 'Bean Stalk', keywords: ['bean', 'bean plant', 'bean stalk', 'green bean'] },
  { cropType: 'Rapeseed / Canola Stalk', keywords: ['rapeseed', 'canola', 'mustard oil'] },
  { cropType: 'Olive Pomace', keywords: ['olive', 'olive pomace', 'olive oil'] },
  { cropType: 'Cocoa Pod Husk', keywords: ['cocoa', 'cacao', 'cocoa pod', 'chocolate'] },
  { cropType: 'Tobacco Stalk', keywords: ['tobacco', 'tobacco plant', 'tobacco stalk'] },
  { cropType: 'Hemp Stalk', keywords: ['hemp', 'hemp plant', 'cannabis'] },
  { cropType: 'Cassava Peel / Residue', keywords: ['cassava', 'tapioca', 'manioc', 'yuca'] },
  { cropType: 'Citrus Waste', keywords: ['citrus', 'orange', 'lemon', 'lime', 'grapefruit', 'citrus fruit'] },
  { cropType: 'Grape Pomace', keywords: ['grape', 'grape pomace', 'vineyard', 'wine'] },
  { cropType: 'Almond Shell', keywords: ['almond', 'almond shell', 'almond nut'] },
  { cropType: 'Cashew Shell', keywords: ['cashew', 'cashew shell', 'cashew nut'] },
  { cropType: 'Pea Stalk', keywords: ['pea', 'pea plant', 'pea stalk', 'green pea'] },
  { cropType: 'Other Agricultural Waste', keywords: ['agricultural', 'crop', 'farm', 'residue', 'biomass', 'organic waste'] },
];

const CROP_TYPE_LIST = CROP_LABEL_RULES.map((r) => r.cropType);

function buildVisionBody(imageBase64) {
  return {
    requests: [
      {
        image: { content: imageBase64 },
        features: [{ type: 'LABEL_DETECTION', maxResults: MAX_LABEL_RESULTS }],
      },
    ],
  };
}

async function parseVisionJson(res) {
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    const message = json?.error?.message || `Vision API error (${res.status})`;
    throw new Error(message);
  }
  return json;
}

async function callVisionWithApiKey(imageBase64, apiKey) {
  const url = `${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildVisionBody(imageBase64)),
  });
  return parseVisionJson(res);
}

async function callVisionWithServiceAccount(imageBase64) {
  const auth = new GoogleAuth({ scopes: GOOGLE_CLOUD_SCOPE });
  const client = await auth.getClient();
  const creds = await client.authorize();
  const token = creds?.access_token;
  if (!token) {
    throw new Error('Could not get access token from GOOGLE_APPLICATION_CREDENTIALS');
  }
  const res = await fetch(VISION_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildVisionBody(imageBase64)),
  });
  return parseVisionJson(res);
}

function mapLabelsToCrop(labelTexts) {
  let matchedCrop = null;
  for (const rule of CROP_LABEL_RULES) {
    const found = rule.keywords.some((kw) =>
      labelTexts.some((label) => label.includes(kw.toLowerCase())),
    );
    if (found) {
      matchedCrop = rule.cropType;
      break;
    }
  }
  return matchedCrop;
}

/** Map filename hints to crop type when Vision has no match. */
function mapFilenameToCrop(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const lower = filename.toLowerCase().replace(/\.[^/.]+$/, '').replace(/[-_\s]+/g, ' ');
  if (lower.includes('coco') || lower.includes('coconut')) return 'Coconut Shells';
  if (lower.includes('rice husk') || lower.includes('ricehusk')) return 'Rice Husk';
  if (lower.includes('rice straw')) return 'Rice Straw';
  if (lower.includes('paddy') || lower.includes('rice')) return 'Paddy Husk';
  if (lower.includes('wheat')) return 'Wheat Straw';
  if (lower.includes('barley')) return 'Barley Straw';
  if (lower.includes('oat')) return 'Oat Straw';
  if (lower.includes('corn') || lower.includes('maize')) return lower.includes('cob') ? 'Maize Cob' : 'Corn Stalks';
  if (lower.includes('sugarcane') || lower.includes('bagasse')) return 'Sugarcane Bagasse';
  if (lower.includes('groundnut') || lower.includes('peanut')) return 'Groundnut Shell';
  if (lower.includes('cotton')) return 'Cotton Stalk';
  if (lower.includes('mustard')) return 'Mustard Stalk';
  if (lower.includes('soybean') || lower.includes('soya')) return 'Soybean Stalk';
  if (lower.includes('sunflower')) return 'Sunflower Stalk';
  if (lower.includes('palm') && (lower.includes('efb') || lower.includes('fruit'))) return 'Palm Empty Fruit Bunch';
  if (lower.includes('coffee')) return 'Coffee Husk';
  if (lower.includes('tea')) return 'Tea Waste';
  if (lower.includes('banana')) return 'Banana Waste';
  if (lower.includes('mango')) return 'Mango Waste';
  if (lower.includes('vegetable') || lower.includes('veg ')) return 'Vegetable Waste';
  if (lower.includes('fruit')) return 'Fruit Waste';
  if (lower.includes('jute')) return 'Jute Stalk';
  if (lower.includes('castor')) return 'Castor Stalk';
  if (lower.includes('sesame')) return 'Sesame Stalk';
  if (lower.includes('potato')) return 'Potato Vine';
  if (lower.includes('tomato')) return 'Tomato Waste';
  if (lower.includes('chickpea') || lower.includes('gram ') || lower.includes('chana')) return 'Gram / Chickpea Stalk';
  if (lower.includes('pigeon pea') || lower.includes('tur ') || lower.includes('arhar')) return 'Tur / Pigeon Pea Stalk';
  if (lower.includes('oilseed')) return 'Oilseed Waste';
  if (lower.includes('brewery') || lower.includes('spent grain')) return 'Brewery Spent Grains';
  if (lower.includes('sorghum') || lower.includes('jowar')) return 'Sorghum Stalk';
  if (lower.includes('rye')) return 'Rye Straw';
  if (lower.includes('millet') || lower.includes('bajra')) return 'Millet Straw';
  if (lower.includes('lentil') || lower.includes('masoor')) return 'Lentil Stalk';
  if (lower.includes('cowpea') || lower.includes('black eyed') || lower.includes('lobia')) return 'Cowpea / Black-Eyed Pea Stalk';
  if (lower.includes('bean')) return 'Bean Stalk';
  if (lower.includes('rapeseed') || lower.includes('canola')) return 'Rapeseed / Canola Stalk';
  if (lower.includes('olive')) return 'Olive Pomace';
  if (lower.includes('cocoa') || lower.includes('cacao')) return 'Cocoa Pod Husk';
  if (lower.includes('tobacco')) return 'Tobacco Stalk';
  if (lower.includes('hemp')) return 'Hemp Stalk';
  if (lower.includes('cassava') || lower.includes('tapioca')) return 'Cassava Peel / Residue';
  if (lower.includes('citrus') || lower.includes('orange') || lower.includes('lemon') || lower.includes('grapefruit')) return 'Citrus Waste';
  if (lower.includes('grape') || lower.includes('pomace')) return 'Grape Pomace';
  if (lower.includes('almond')) return 'Almond Shell';
  if (lower.includes('cashew')) return 'Cashew Shell';
  if (lower.includes('pea ')) return 'Pea Stalk';
  return null;
}

/**
 * Response schema for crop detection. `cropType` is an enum, so the model can
 * only ever return a label the UI already knows — no fuzzy string matching, no
 * hallucinated crop names.
 */
const CROP_DETECTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    cropType: { type: 'STRING', enum: CROP_TYPE_LIST },
    confidence: { type: 'NUMBER', description: '0-100 confidence in the chosen label' },
    visibleLabels: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Up to 5 short descriptions of what is actually visible',
    },
    isAgriculturalWaste: { type: 'BOOLEAN' },
  },
  required: ['cropType', 'confidence', 'visibleLabels', 'isAgriculturalWaste'],
};

const CROP_PROMPT = `You identify agricultural crop waste and residue from a photograph.

Look carefully at the image and pick the single best-matching crop waste type from the allowed list.

Rules:
- Judge from what you actually SEE. Identify the plant material by its shape, colour and texture.
- Set isAgriculturalWaste to false if the photo shows something that is not crop waste or residue
  (a person, a pet, a building, a vehicle, packaged food, an empty scene). Still pick the closest
  list entry, but report low confidence so the app can ask for a better photo.
- confidence should reflect genuine visual certainty: 90+ only when the material is unmistakable,
  50-80 when plausible but partly obscured, below 40 when you are mostly guessing.
- visibleLabels must describe what is genuinely in the frame (e.g. "brown fibrous husks",
  "split coconut shells", "stacked dry stalks").
- Use "Other Agricultural Waste" when it is clearly crop waste but matches no specific entry.`;

/**
 * Detect crop type using Gemini. This is the primary detector — Cloud Vision
 * cannot run on an API key, so for most deployments this is the only path.
 */
async function detectCropViaGemini(imageBase64, filenameHint, mimeType = 'image/jpeg') {
  if (!hasGeminiKey()) {
    return { cropType: null, labels: [], source: 'gemini', error: 'GEMINI_API_KEY is not set in server/.env' };
  }

  const hintLine = filenameHint
    ? `\n\nThe uploaded file is named "${filenameHint}". Treat this as a weak hint only — trust the image over the filename if they disagree.`
    : '';

  const out = await geminiGenerateJson({
    parts: [imagePart(imageBase64, mimeType), textPart(CROP_PROMPT + hintLine)],
    schema: CROP_DETECTION_SCHEMA,
    temperature: 0.1,
    maxOutputTokens: 2048,
    timeoutMs: 45000,
  });

  if (!out.ok) {
    return { cropType: null, labels: [], source: 'gemini', error: out.error };
  }

  const { cropType, confidence, visibleLabels, isAgriculturalWaste } = out.json;
  // The enum guarantees membership, but verify rather than trust.
  const matched = CROP_TYPE_LIST.find((c) => c === cropType)
    || CROP_TYPE_LIST.find((c) => c.toLowerCase() === String(cropType || '').toLowerCase());

  return {
    cropType: matched || mapFilenameToCrop(filenameHint),
    labels: Array.isArray(visibleLabels) ? visibleLabels.slice(0, 5) : [],
    confidence: Math.min(100, Math.max(0, Number(confidence) || 0)),
    isAgriculturalWaste: isAgriculturalWaste !== false,
    source: 'gemini',
    model: out.model,
  };
}

export async function detectCropFromBase64(imageBase64, filenameHint = null, mimeType = 'image/jpeg') {
  const visionApiKey = (process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_CLOUD_VISION_API_KEY || '').trim();
  const hasServiceAccount = Boolean((process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim());
  const geminiAvailable = hasGeminiKey();

  if (!geminiAvailable && !visionApiKey && !hasServiceAccount) {
    throw new Error('Set GEMINI_API_KEY in server/.env for crop detection.');
  }

  let labelTexts = [];
  let matchedCrop = null;
  let confidence = null;
  let source = null;
  let isAgriculturalWaste = true;
  let geminiError = null;

  // Gemini first: it reasons about the material directly instead of keyword
  // matching generic Vision labels, so it is both more accurate and the only
  // path that works with an AI Studio key.
  if (geminiAvailable) {
    const geminiResult = await detectCropViaGemini(imageBase64, filenameHint || null, mimeType);
    if (geminiResult.cropType) {
      matchedCrop = geminiResult.cropType;
      labelTexts = geminiResult.labels || [];
      confidence = geminiResult.confidence ?? null;
      isAgriculturalWaste = geminiResult.isAgriculturalWaste !== false;
      source = 'gemini';
    } else {
      geminiError = geminiResult.error || null;
    }
  }

  // Cloud Vision label detection as a secondary signal, only with real credentials.
  if (!matchedCrop && (visionApiKey || hasServiceAccount)) {
    let json = null;
    if (visionApiKey) {
      try {
        json = await callVisionWithApiKey(imageBase64, visionApiKey);
      } catch (_) { /* try service account next */ }
    }
    if (!json && hasServiceAccount) {
      try {
        json = await callVisionWithServiceAccount(imageBase64);
      } catch (_) { /* fall through to filename hint */ }
    }
    if (json) {
      const labels = json?.responses?.[0]?.labelAnnotations || [];
      labelTexts = labels.map((l) => String(l.description || '').toLowerCase());
      matchedCrop = mapLabelsToCrop(labelTexts);
      if (matchedCrop) source = 'vision';
    }
  }

  if (!matchedCrop && filenameHint) {
    matchedCrop = mapFilenameToCrop(filenameHint);
    if (matchedCrop) {
      source = 'filename';
      confidence = 30;
    }
  }

  // Nothing matched and Gemini itself errored — surface the real reason so the
  // client shows "check your key/quota" instead of "no crop detected".
  if (!matchedCrop && geminiError) {
    throw new Error(geminiError);
  }

  return {
    cropType: matchedCrop,
    labels: labelTexts,
    confidence,
    source,
    isAgriculturalWaste,
  };
}
