import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import flightsRouter from './routes/flights.js';
import { startPolling } from './services/adsbService.js';
import { connectDB } from './services/db.js';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ─── Mount API routes ───────────────────────────────────────────────
app.use(flightsRouter);

// ─── Health check ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Connect to MongoDB, then start server + polling ────────────────
async function boot() {
  await connectDB();

  app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    startPolling();
  });
}

boot();
