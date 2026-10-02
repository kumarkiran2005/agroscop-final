// server/routes/cropVision.js
// Detect crop type from an image using Google Cloud Vision

import express from 'express';
import { detectCropFromBase64 } from '../services/cropVisionService.js';

const router = express.Router();

function toClientMessage(rawMessage) {
  const msg = String(rawMessage || '');
  if (/request entity too large|payload too large/i.test(msg)) {
    return 'Image is too large. Please upload/capture a smaller image and try again.';
  }
  if (/billing/i.test(msg)) {
    return 'Google Vision billing is not enabled for this project. Enable billing, then retry.';
  }
  if (/has not been used|is disabled|vision.googleapis.com/i.test(msg)) {
    return 'Google Vision API is not enabled for this project. Enable Vision API in Google Cloud Console, then retry.';
  }
  if (/GEMINI_API_KEY is not set|GOOGLE_VISION_API_KEY|GOOGLE_APPLICATION_CREDENTIALS/i.test(msg)) {
    return 'Set GEMINI_API_KEY in server/.env and restart the server, then retry.';
  }
  if (/API key not valid|API_KEY_INVALID|401|UNAUTHENTICATED/i.test(msg)) {
    return 'The Gemini API key was rejected. Check GEMINI_API_KEY in server/.env.';
  }
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return 'Gemini quota reached. Please wait a moment and try again.';
  }
  if (/timed out|timeout/i.test(msg)) {
    return 'Detection timed out. Please try again with a smaller or clearer photo.';
  }
  return msg || 'Crop detection failed';
}

router.post('/detect-crop', async (req, res) => {
  try {
    const { imageBase64, filenameHint, mimeType } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 is required',
      });
    }

    // Accept a full data URL as well as bare base64.
    const dataUrlMatch = imageBase64.match(/^data:([^;,]+);base64,(.*)$/s);
    const cleanBase64 = dataUrlMatch ? dataUrlMatch[2] : imageBase64;
    const detectedMime = dataUrlMatch ? dataUrlMatch[1] : (mimeType || 'image/jpeg');

    const result = await detectCropFromBase64(cleanBase64, filenameHint || null, detectedMime);

    if (!result.cropType) {
      return res.json({
        success: false,
        cropType: null,
        labels: result.labels,
        message: 'No supported crop type detected in image.',
      });
    }

    return res.json({
      success: true,
      cropType: result.cropType,
      labels: result.labels,
      confidence: result.confidence ?? null,
      source: result.source || null,
      isAgriculturalWaste: result.isAgriculturalWaste !== false,
    });
  } catch (error) {
    const raw = error?.message || 'Vision detection failed';
    console.error('cropVision detect-crop error:', raw);
    return res.status(500).json({
      success: false,
      error: toClientMessage(raw),
    });
  }
});

export default router;
