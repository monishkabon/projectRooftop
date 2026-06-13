// ─── models/SquawkEvent.js ──────────────────────────────────────────
// Mongoose schema for persisted emergency squawk events.
// TTL index auto-deletes documents after 6 months (180 days).
// ─────────────────────────────────────────────────────────────────────

import mongoose from 'mongoose';

const squawkEventSchema = new mongoose.Schema({
  // Aircraft identification
  hex:             { type: String, required: true },   // ICAO hex e.g. 'ae0577'
  squawkCode:      { type: String, required: true },   // '7500' | '7600' | '7700'
  callsign:        { type: String, default: 'UNKNOWN' },
  type:            { type: String, default: 'UNKN' },  // ICAO type code
  aircraft:        { type: String, default: 'UNKNOWN' }, // Human-readable name

  // Flight data at time of detection
  altitude:        { type: String, default: 'N/A' },
  heading:         { type: String, default: '000' },
  latLong:         { type: String, default: 'N/A' },
  signalStrength:  { type: String, default: 'N/A' },
  status:          { type: String, default: 'UNKNOWN' },

  // Classification
  category:        { type: String, enum: ['military', 'civilian'], required: true },

  // Timestamps
  detectedAt:      { type: Date, required: true, default: Date.now },
  lastSeenAt:      { type: Date, required: true, default: Date.now },
});

// ─── Indexes ────────────────────────────────────────────────────────

// TTL index: auto-delete after 180 days (≈ 6 months)
squawkEventSchema.index({ detectedAt: 1 }, { expireAfterSeconds: 15552000 });

// Deduplication queries: find recent events by same aircraft + squawk
squawkEventSchema.index({ hex: 1, squawkCode: 1, detectedAt: -1 });

// History queries: fetch by category, newest first
squawkEventSchema.index({ category: 1, detectedAt: -1 });

const SquawkEvent = mongoose.model('SquawkEvent', squawkEventSchema);

export default SquawkEvent;
