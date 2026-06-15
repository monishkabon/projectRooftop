// ─── services/adsbService.js ────────────────────────────────────────
// Polls ADSB.lol API v2 endpoints on a configurable interval,
// caches the latest results in-memory, and exposes getter methods
// that return transformed data.
// ─────────────────────────────────────────────────────────────────────

import axios from 'axios';
import mongoose from 'mongoose';
import {
  transformToSquawkEntry,
  transformToRadarBlip,
  transformToFlightDetail,
  isMilitary,
  lookupAircraftName,
  formatAltitude,
  formatRSSI,
  formatLatLon,
  deriveEmergencyStatus,
} from '../utils/transformers.js';
import SquawkEvent from '../models/SquawkEvent.js';

// ─── Configuration ──────────────────────────────────────────────────

const BASE_URL = 'https://api.adsb.lol/v2';

const ENDPOINTS = {
  military: `${BASE_URL}/mil`,
  squawks:  `${BASE_URL}/sqk/7500,7600,7700`,
  // localRadar is dynamic — built per-request
};

const axiosClient = axios.create({
  timeout: 25000,
  headers: {
    'Accept-Encoding': 'gzip',
    'Accept': 'application/json',
  },
});

// ─── In-Memory Cache ────────────────────────────────────────────────

const cache = {
  military: {
    raw: [],          // raw aircraft objects from /mil
    data: [],         // transformed SquawkEntry[]
    updatedAt: null,
  },
  squawks: {
    raw: [],          // raw aircraft objects from /sqk
    military: [],     // transformed SquawkEntry[] (dbFlags & 1)
    civilian: [],     // transformed SquawkEntry[] (not military)
    updatedAt: null,
  },
  localRadar: {
    raw: [],          // raw aircraft objects from /lat/lon/dist
    data: [],         // transformed RadarBlip[]
    params: null,     // { lat, lon, dist } last used
    updatedAt: null,
  },
};

// ─── Polling State ──────────────────────────────────────────────────

let pollingTimers = {
  military: null,
  squawks: null,
  localRadar: null,
};

let localRadarParams = null; // set by first /api/radar request

let isFetching = {
  military: false,
  squawks: false,
  localRadar: false,
};

// ─── Fetch + Transform Functions ────────────────────────────────────

async function fetchMilitary() {
  if (isFetching.military) return;
  isFetching.military = true;
  try {
    const res = await axiosClient.get(ENDPOINTS.military);
    const aircraft = res.data?.ac || [];
    cache.military.raw = aircraft;
    cache.military.data = aircraft.map(transformToSquawkEntry);
    cache.military.updatedAt = new Date().toISOString();
    console.log(`[ADSB] Military feed updated — ${aircraft.length} aircraft`);
  } catch (err) {
    console.error('[ADSB] Military feed error:', err.message);
    // Stale cache is preserved on error
  } finally {
    isFetching.military = false;
  }
}

async function fetchSquawks() {
  if (isFetching.squawks) return;
  isFetching.squawks = true;
  try {
    const res = await axiosClient.get(ENDPOINTS.squawks);
    const aircraft = res.data?.ac || [];
    cache.squawks.raw = aircraft;

    const milEntries = [];
    const civEntries = [];

    for (const ac of aircraft) {
      const entry = transformToSquawkEntry(ac);
      if (isMilitary(ac.dbFlags)) {
        milEntries.push(entry);
      } else {
        civEntries.push(entry);
      }
    }

    cache.squawks.military = milEntries;
    cache.squawks.civilian = civEntries;
    cache.squawks.updatedAt = new Date().toISOString();
    console.log(`[ADSB] Squawk feed updated — ${milEntries.length} mil, ${civEntries.length} civ`);

    // Persist to MongoDB (fire-and-forget)
    if (aircraft.length > 0) {
      persistSquawkEvents(aircraft).catch((e) =>
        console.error('[DB] Persist error:', e.message)
      );
    }
  } catch (err) {
    console.error('[ADSB] Squawk feed error:', err.message);
  } finally {
    isFetching.squawks = false;
  }
}

async function fetchLocalRadar(lat, lon, dist) {
  if (isFetching.localRadar) return;
  isFetching.localRadar = true;
  try {
    const url = `${BASE_URL}/lat/${lat}/lon/${lon}/dist/${dist}`;
    const res = await axiosClient.get(url);
    const aircraft = res.data?.ac || [];
    cache.localRadar.raw = aircraft;
    cache.localRadar.data = aircraft.map(transformToRadarBlip);
    cache.localRadar.params = { lat, lon, dist };
    cache.localRadar.updatedAt = new Date().toISOString();
    console.log(`[ADSB] Local radar updated — ${aircraft.length} aircraft within ${dist}nm of ${lat},${lon}`);
  } catch (err) {
    console.error('[ADSB] Local radar error:', err.message);
  } finally {
    isFetching.localRadar = false;
  }
}

// ─── Squawk Persistence ─────────────────────────────────────────────

/**
 * Persist emergency squawk events to MongoDB.
 * Deduplicates by hex + squawkCode within a 30-minute window:
 *   - If a matching recent event exists → update lastSeenAt
 *   - Otherwise → insert a new document
 */
async function persistSquawkEvents(rawAircraft) {
  // Skip if mongoose is not connected
  if (mongoose.connection.readyState !== 1) return;

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  let inserted = 0;
  let updated = 0;

  for (const ac of rawAircraft) {
    const hex = ac.hex;
    const squawkCode = ac.squawk;
    if (!hex || !squawkCode) continue;

    try {
      // Check for existing recent event
      const existing = await SquawkEvent.findOne({
        hex,
        squawkCode,
        detectedAt: { $gte: thirtyMinAgo },
      }).sort({ detectedAt: -1 });

      if (existing) {
        // Update lastSeenAt on the existing event
        existing.lastSeenAt = new Date();
        await existing.save();
        updated++;
      } else {
        // Insert new event
        await SquawkEvent.create({
          hex,
          squawkCode,
          callsign:       (ac.flight || 'UNKNOWN').trim(),
          type:            ac.t || 'UNKN',
          aircraft:        lookupAircraftName(ac.t),
          altitude:        formatAltitude(ac.alt_baro),
          heading:         String(Math.round(ac.track ?? ac.mag_heading ?? 0)).padStart(3, '0'),
          latLong:         formatLatLon(ac.lat, ac.lon),
          signalStrength:  formatRSSI(ac.rssi),
          status:          deriveEmergencyStatus(ac.squawk, ac.emergency),
          category:        isMilitary(ac.dbFlags) ? 'military' : 'civilian',
          detectedAt:      new Date(),
          lastSeenAt:      new Date(),
        });
        inserted++;
      }
    } catch (err) {
      console.error(`[DB] Error persisting ${hex}:`, err.message);
    }
  }

  if (inserted > 0 || updated > 0) {
    console.log(`[DB] Squawk events — ${inserted} new, ${updated} updated`);
  }
}

// ─── Polling Control ────────────────────────────────────────────────

/**
 * Start polling all feeds. Default interval is 5 seconds.
 */
export function startPolling() {
  const milInterval = parseInt(process.env.MILITARY_POLL_INTERVAL_MS, 10) || 30000;
  const civInterval = parseInt(process.env.POLL_INTERVAL_MS, 10) || 60000;
  console.log(`[ADSB] Starting polling. Military: ${milInterval}ms, Civilian/Squawks: ${civInterval}ms`);

  // Fetch immediately on boot
  fetchMilitary();
  fetchSquawks();

  // Set up recurring polls for military + squawks
  pollingTimers.military = setInterval(fetchMilitary, milInterval);
  pollingTimers.squawks = setInterval(fetchSquawks, civInterval);

  // Local radar only polls once params are known (first request sets them)
}

/**
 * Start or restart local radar polling with the given coordinates.
 */
export async function startLocalRadarPolling(lat, lon, dist) {
  const interval = parseInt(process.env.POLL_INTERVAL_MS, 10) || 60000;
  localRadarParams = { lat, lon, dist };

  // Clear any existing timer
  if (pollingTimers.localRadar) {
    clearInterval(pollingTimers.localRadar);
  }

  // Fetch immediately, then poll
  await fetchLocalRadar(lat, lon, dist);
  pollingTimers.localRadar = setInterval(() => {
    fetchLocalRadar(lat, lon, dist);
  }, interval);

  console.log(`[ADSB] Local radar polling started for ${lat},${lon} r=${dist}nm at ${interval}ms`);
}

/**
 * Stop all polling.
 */
export function stopPolling() {
  Object.values(pollingTimers).forEach((timer) => {
    if (timer) clearInterval(timer);
  });
  pollingTimers = { military: null, squawks: null, localRadar: null };
  console.log('[ADSB] Polling stopped');
}

// ─── Data Getters ───────────────────────────────────────────────────

export function getMilitaryFeed() {
  return {
    data: cache.military.data,
    total: cache.military.data.length,
    updatedAt: cache.military.updatedAt,
  };
}

/**
 * Search the cached military feed by query string.
 * Matches against callsign, type, squawkCode, and id (hex).
 */
export function searchMilitaryFeed(query) {
  const q = query.toLowerCase().trim();
  if (!q) return { data: [], total: 0 };

  const results = cache.military.data.filter((entry) => {
    return (
      entry.callsign?.toLowerCase().includes(q) ||
      entry.type?.toLowerCase().includes(q) ||
      entry.squawkCode?.includes(q) ||
      entry.id?.toLowerCase().includes(q) ||
      entry.altitude?.toLowerCase().includes(q) ||
      entry.heading?.includes(q)
    );
  });

  return {
    data: results,
    total: results.length,
    updatedAt: cache.military.updatedAt,
  };
}

/**
 * Search the cached civilian squawks feed by query string.
 */
export function searchCivilianSquawks(query) {
  const q = query.toLowerCase().trim();
  if (!q) return { data: [], total: 0 };

  const results = cache.squawks.civilian.filter((entry) => {
    return (
      entry.callsign?.toLowerCase().includes(q) ||
      entry.type?.toLowerCase().includes(q) ||
      entry.squawkCode?.includes(q) ||
      entry.id?.toLowerCase().includes(q) ||
      entry.altitude?.toLowerCase().includes(q) ||
      entry.heading?.includes(q)
    );
  });

  return {
    data: results,
    total: results.length,
    updatedAt: cache.squawks.updatedAt,
  };
}

export function getEmergencySquawks() {
  return {
    military: cache.squawks.military,
    civilian: cache.squawks.civilian,
    totalMilitary: cache.squawks.military.length,
    totalCivilian: cache.squawks.civilian.length,
    updatedAt: cache.squawks.updatedAt,
  };
}

export function getLocalRadar() {
  return {
    data: cache.localRadar.data,
    total: cache.localRadar.data.length,
    params: cache.localRadar.params,
    updatedAt: cache.localRadar.updatedAt,
  };
}

/**
 * Search all cached raw aircraft arrays for a matching ICAO hex
 * and return a full flight detail object.
 */
export function getFlightByHex(hex) {
  const needle = hex.toLowerCase();

  // Search across all cached raw arrays
  const allRaw = [
    ...cache.military.raw,
    ...cache.squawks.raw,
    ...cache.localRadar.raw,
  ];

  // Deduplicate by hex (same aircraft may appear in multiple feeds)
  const seen = new Set();
  for (const ac of allRaw) {
    if (!seen.has(ac.hex) && ac.hex?.toLowerCase() === needle) {
      return transformToFlightDetail(ac);
    }
    seen.add(ac.hex);
  }

  return null;
}
