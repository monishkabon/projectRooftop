import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import flightsRouter from './routes/flights.js';
import { startPolling } from './services/adsbService.js';
import { connectDB } from './services/db.js';

const app = express();
const port = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// ─── Mount API routes ───────────────────────────────────────────────
app.use(flightsRouter);

// ─── Health check ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Serve Frontend ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
