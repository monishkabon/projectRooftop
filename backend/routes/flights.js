// ─── routes/flights.js ──────────────────────────────────────────────
// Express router that exposes REST endpoints for the frontend
// to fetch transformed flight data from the in-memory cache.
// ─────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
  getMilitaryFeed,
  getEmergencySquawks,
  getLocalRadar,
  getFlightByHex,
  startLocalRadarPolling,
  searchMilitaryFeed,
  searchCivilianSquawks,
} from '../services/adsbService.js';
import SquawkEvent from '../models/SquawkEvent.js';

const router = Router();

// ─── GET /api/military ──────────────────────────────────────────────
// Returns all military-flagged aircraft from the /v2/mil feed.
router.get('/api/military', (req, res) => {
  const result = getMilitaryFeed();
  res.json(result);
});

// ─── GET /api/squawks ───────────────────────────────────────────────
// Returns emergency squawk aircraft split into military and civilian.
router.get('/api/squawks', (req, res) => {
  const result = getEmergencySquawks();
  res.json(result);
});

// ─── GET /api/radar/:lat/:lon/:dist ─────────────────────────────────
// Returns aircraft within `dist` nautical miles of the given lat/lon.
// On the first call, starts polling for this location.
router.get('/api/radar/:lat/:lon/:dist', async (req, res) => {
  const lat = parseFloat(req.params.lat);
  const lon = parseFloat(req.params.lon);
  const dist = parseFloat(req.params.dist);

  // Validate parameters
  if (isNaN(lat) || isNaN(lon) || isNaN(dist)) {
    return res.status(400).json({
      error: 'Invalid parameters. lat, lon, and dist must be numbers.',
    });
  }

  if (lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'lat must be between -90 and 90.' });
  }
  if (lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'lon must be between -180 and 180.' });
  }
  if (dist <= 0 || dist > 250) {
    return res.status(400).json({ error: 'dist must be between 1 and 250 nautical miles.' });
  }

  // Start/restart local radar polling for this location
  await startLocalRadarPolling(lat, lon, dist);

  const result = getLocalRadar();
  res.json(result);
});

// ─── GET /api/flights/:hex ──────────────────────────────────────────
// Returns full flight details for a single aircraft by ICAO hex.
router.get('/api/flights/:hex', (req, res) => {
  const { hex } = req.params;
  const flight = getFlightByHex(hex);

  if (flight) {
    res.json(flight);
  } else {
    res.status(404).json({
      error: 'Flight not found',
      hex,
      hint: 'The aircraft may not be in any active feed. Try fetching a radar or squawk feed first.',
    });
  }
});

// ─── GET /api/search/military ───────────────────────────────────────
// Search the live military feed cache by query string.
router.get('/api/search/military', (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) {
    return res.json({ data: [], total: 0 });
  }
  const result = searchMilitaryFeed(q);
  res.json(result);
});

// ─── GET /api/search/civilian ───────────────────────────────────────
// Search the live civilian squawks cache by query string.
router.get('/api/search/civilian', (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) {
    return res.json({ data: [], total: 0 });
  }
  const result = searchCivilianSquawks(q);
  res.json(result);
});

// ─── GET /api/search/history ────────────────────────────────────────
// Search historical squawk events in MongoDB by query string.
// Matches against callsign, aircraft, type, hex, squawkCode.
router.get('/api/search/history', async (req, res) => {
  const q = req.query.q || '';
  const category = req.query.category || '';
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

  if (!q.trim()) {
    return res.json({ data: [], total: 0 });
  }

  // If MongoDB is not connected, return empty results gracefully
  const mongoose = (await import('mongoose')).default;
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  try {
    const regex = new RegExp(q.trim(), 'i');

    const filter = {
      $or: [
        { callsign: regex },
        { aircraft: regex },
        { type: regex },
        { hex: regex },
        { squawkCode: regex },
      ],
    };

    if (category === 'military' || category === 'civilian') {
      filter.category = category;
    }

    const [data, total] = await Promise.all([
      SquawkEvent.find(filter).sort({ detectedAt: -1 }).limit(limit).lean(),
      SquawkEvent.countDocuments(filter),
    ]);

    res.json({ data, total });
  } catch (err) {
    console.error('[API] Search history error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ─── GET /api/history/squawks ───────────────────────────────────────
// Returns historical squawk events from MongoDB, split by category.
// Query params: ?days=30 (default 30), ?page=1, ?limit=50
router.get('/api/history/squawks', async (req, res) => {
  // If MongoDB is not connected, return empty results
  const mongoose = (await import('mongoose')).default;
  if (mongoose.connection.readyState !== 1) {
    return res.json({ military: [], civilian: [], totalMilitary: 0, totalCivilian: 0, page: 1, limit: 50, days: 30 });
  }

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [military, civilian, totalMilitary, totalCivilian] = await Promise.all([
      SquawkEvent.find({ category: 'military', detectedAt: { $gte: since } })
        .sort({ detectedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SquawkEvent.find({ category: 'civilian', detectedAt: { $gte: since } })
        .sort({ detectedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SquawkEvent.countDocuments({ category: 'military', detectedAt: { $gte: since } }),
      SquawkEvent.countDocuments({ category: 'civilian', detectedAt: { $gte: since } }),
    ]);

    res.json({
      military,
      civilian,
      totalMilitary,
      totalCivilian,
      page,
      limit,
      days,
    });
  } catch (err) {
    console.error('[API] History error:', err.message);
    res.status(500).json({ error: 'Failed to fetch squawk history' });
  }
});

export default router;
