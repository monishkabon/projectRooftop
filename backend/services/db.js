// ─── services/db.js ─────────────────────────────────────────────────
// Mongoose connection module. Connects to MongoDB Atlas (or local)
// using the MONGO_URI environment variable.
// ─────────────────────────────────────────────────────────────────────

import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[DB] MONGO_URI is not set in .env — skipping database connection');
    return false;
  }

  try {
    await mongoose.connect(uri);
    console.log('[DB] Connected to MongoDB');
    return true;
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    return false;
  }
}
