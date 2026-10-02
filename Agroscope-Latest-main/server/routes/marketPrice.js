/**
 * Controller: MarketPrice
 * REST API. Validates input, calls Service, returns DTOs.
 * GET /live: Tavily + DeepSeek live price (server/services/liveMarketPrice.js).
 */
import express from 'express';
import * as marketPriceService from '../services/marketPriceService.js';
import {
  getLiveMarketPrice,
  getLiveMarketPriceFallback,
  getLiveMarketPricesBulk,
} from '../services/liveMarketPrice.js';
import { getLiveMarketForecast } from '../services/liveMarketForecast.js';
import { getSellNowHold } from '../services/liveSellNowHold.js';
import { asyncHandler } from '../utils/errorHandler.js';
import { requireString, requireNumber, ValidationError } from '../utils/validation.js';

const router = express.Router();

/**
 * GET /api/market-price/live?wasteType=&city=&quantityTons=
 * Live market price: Tavily search → DeepSeek extraction. Cached 6h. Always 200 with fallback on error.
 */
router.get('/live', async (req, res) => {
  const wasteType = (req.query.wasteType && String(req.query.wasteType).trim()) || 'paddy_husk';
  const city = (req.query.city && String(req.query.city).trim()) || 'Chennai';
  const quantityTons = Math.max(0, Number(req.query.quantityTons) || 1);
  // wait=1 blocks until a fresh price is fetched. Default is non-blocking: a
  // cached or reference price comes back at once and the client polls.
  const waitForFresh = req.query.wait === '1' || req.query.wait === 'true';
  try {
    const data = await getLiveMarketPrice(wasteType, city, quantityTons, { waitForFresh });
    return res.status(200).json(data);
  } catch (err) {
    console.warn('GET /api/market-price/live error:', err?.message || err);
    try {
      const fallback = getLiveMarketPriceFallback(wasteType, city, quantityTons);
      return res.status(200).json(fallback);
    } catch (fallbackErr) {
      console.warn('GET /api/market-price/live fallback error:', fallbackErr?.message || fallbackErr);
      return res.status(200).json({
        pricePerKg: 2,
        priceRange: { min: 1.2, max: 2.8 },
        trend: 'stable',
        confidence: 'low',
        source: 'Offline estimate',
        lastUpdated: new Date().toISOString().slice(0, 10),
        carbonValuePerTon: 340,
        totalLotValue: quantityTons * 2000,
      });
    }
  }
});

/**
 * GET /api/market-price/live-bulk?wasteTypes=a,b,c&city=&quantityTons=
 *
 * One request for the whole Live Prices grid. Answers immediately from cache;
 * crops that are not cached yet come back with pending:true and are fetched in
 * the background, so the page renders at once instead of opening one request
 * per crop. Poll again while pendingCount > 0.
 */
router.get('/live-bulk', async (req, res) => {
  const raw = String(req.query.wasteTypes || '').trim();
  const wasteTypes = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const city = (req.query.city && String(req.query.city).trim()) || 'Chennai';
  const quantityTons = Math.max(0, Number(req.query.quantityTons) || 1);

  if (!wasteTypes.length) {
    return res.status(200).json({ city, prices: [], pendingCount: 0 });
  }
  if (wasteTypes.length > 100) {
    return res.status(400).json({ error: 'Too many wasteTypes (max 100)' });
  }

  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
  try {
    const data = await getLiveMarketPricesBulk(wasteTypes, city, quantityTons, { forceRefresh });
    return res.status(200).json(data);
  } catch (err) {
    console.warn('GET /api/market-price/live-bulk error:', err?.message || err);
    const prices = wasteTypes.map((wasteType) => ({
      wasteType,
      ...getLiveMarketPriceFallback(wasteType, city, quantityTons),
      cached: false,
      pending: false,
    }));
    return res.status(200).json({ city, prices, pendingCount: 0 });
  }
});

/**
 * GET /api/market-price/forecast?wasteType=&city=
 * 30-day forecast by period (1-5, 6-10, ... 26-30 days). Tavily + DeepSeek.
 */
router.get('/forecast', async (req, res) => {
  const wasteType = (req.query.wasteType && String(req.query.wasteType).trim()) || 'paddy_husk';
  const city = (req.query.city && String(req.query.city).trim()) || 'Chennai';
  try {
    const data = await getLiveMarketForecast(wasteType, city);
    return res.status(200).json(data);
  } catch (err) {
    console.warn('GET /api/market-price/forecast error:', err.message);
    const data = {
      periods: [
        { period: '1-5 days', minPrice: 1.8, maxPrice: 2.4, trend: 'stable' },
        { period: '6-10 days', minPrice: 1.85, maxPrice: 2.5, trend: 'rising' },
        { period: '11-15 days', minPrice: 1.9, maxPrice: 2.55, trend: 'rising' },
        { period: '16-20 days', minPrice: 1.88, maxPrice: 2.52, trend: 'stable' },
        { period: '21-25 days', minPrice: 1.92, maxPrice: 2.6, trend: 'rising' },
        { period: '26-30 days', minPrice: 1.95, maxPrice: 2.65, trend: 'rising' },
      ],
    };
    return res.status(200).json(data);
  }
});

/**
 * GET /api/market-price/sell-now-hold?wasteType=&city=
 * Sell Now vs Hold recommendation + chart data. Tavily + DeepSeek.
 */
router.get('/sell-now-hold', async (req, res) => {
  const wasteType = (req.query.wasteType && String(req.query.wasteType).trim()) || 'paddy_husk';
  const city = (req.query.city && String(req.query.city).trim()) || 'Chennai';
  try {
    const data = await getSellNowHold(wasteType, city);
    return res.status(200).json(data);
  } catch (err) {
    console.warn('GET /api/market-price/sell-now-hold error:', err.message);
    const data = {
      recommendation: 'sell_now',
      confidence: 72,
      reason: 'Current prices are strong; lock in now.',
      chartData: [
        { label: 'Day 1', value: 2.0, type: 'actual' },
        { label: 'Day 5', value: 2.1, type: 'actual' },
        { label: 'Day 7', value: 2.15, type: 'projected' },
        { label: 'Day 10', value: 2.2, type: 'projected' },
        { label: 'Day 14', value: 2.25, type: 'projected' },
      ],
    };
    return res.status(200).json(data);
  }
});

/**
 * POST /api/market-price
 * Save or update price. Body: MarketPriceRequest (wasteType, state, avgPricePerKg, source).
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const wasteType = requireString(req.body.wasteType, 'wasteType', 1);
    const state = requireString(req.body.state, 'state', 1);
    const avgPricePerKg = requireNumber(req.body.avgPricePerKg, 'avgPricePerKg', 0);
    const source = requireString(req.body.source ?? '', 'source', 0);
    const request = { wasteType, state, avgPricePerKg, source: source || 'Admin - Jan 2026' };
    const data = await marketPriceService.saveOrUpdatePrice(request);
    res.status(200).json(data);
  })
);

/**
 * GET /api/market-price?wasteType=&state= (or location=)
 * Get market price by wasteType and state. 404 if not found.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const wasteType = requireString(req.query.wasteType, 'wasteType', 1);
    const stateOrLocation = (req.query.state ?? req.query.location ?? '').toString().trim();
    if (!stateOrLocation) throw new ValidationError('state or location is required');
    const data = await marketPriceService.getMarketPrice(wasteType, stateOrLocation);
    res.status(200).json(data);
  })
);

/**
 * GET /api/market-price/compare?wasteType=&state=&userPrice=
 * Query params: wasteType, state (or location), userPrice.
 * Returns PriceComparisonResponse or { status: "NOT_CONFIGURED" }.
 */
router.get(
  '/compare',
  asyncHandler(async (req, res) => {
    const wasteType = (req.query.wasteType && String(req.query.wasteType).trim()) || '';
    const stateOrLocation = (req.query.state || req.query.location || '').toString().trim();
    const userPriceRaw = req.query.userPrice;
    const userPrice = requireNumber(userPriceRaw, 'userPrice', 0);
    if (!wasteType) throw new ValidationError('wasteType is required');
    try {
      const data = await marketPriceService.comparePrice(wasteType, stateOrLocation, userPrice);
      res.status(200).json(data);
    } catch (err) {
      // DB disconnected or any server error: return NOT_CONFIGURED so UI can show a message
      res.status(200).json({ status: 'NOT_CONFIGURED' });
    }
  })
);

export default router;
