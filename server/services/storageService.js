/**
 * storageService.js
 * 
 * Persistent store for School Dashboard data:
 * - Tasks (including user comments, priority, completed checks)
 * - Events (sports games, practices, chapel)
 * - Sync metadata (lastSyncedAt timestamp, stats)
 * 
 * Storage Backends:
 * 1. Local / Self-hosted: Persists to server/data/dashboard-data.json
 * 2. Vercel Serverless:
 *    - If Vercel KV environment variables (KV_REST_API_URL, KV_REST_API_TOKEN) are configured,
 *      stores and syncs globally in real-time across all devices via Redis KV.
 *    - Fallback: /tmp/dashboard-data.json for runtime persistence during active lambda instances.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'dashboard-data.json');

// In-memory cache for fast access
let memoryStore = null;

/**
 * Initialize storage directory and default file if needed
 */
function ensureStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      const bundledPath = path.join(__dirname, '..', 'data', 'dashboard-data.json');
      if (fs.existsSync(bundledPath)) {
        try {
          fs.writeFileSync(DATA_FILE, fs.readFileSync(bundledPath, 'utf-8'), 'utf-8');
          return;
        } catch (seedErr) {
          console.warn('[Storage] Could not seed from bundled data:', seedErr.message);
        }
      }
      const initial = {
        tasks: [],
        events: [],
        deletedEventKeys: [],
        lastSyncedAt: null,
        lastSyncStats: null,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('[Storage] Warning: Could not initialize local data file:', err.message);
  }
}

/**
 * Get current dashboard data
 */
export async function getDashboardData() {
  // If Vercel KV is configured in production
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const res = await fetch(`${process.env.KV_REST_API_URL}/get/school_dashboard_data`, {
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
        }
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.result) {
          const parsed = typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
          memoryStore = parsed;
          return parsed;
        }
      }
    } catch (kvErr) {
      console.warn('[Storage] Vercel KV read failed, falling back to local file:', kvErr.message);
    }
  }

  // Local file storage
  ensureStorage();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      memoryStore = JSON.parse(raw);
      return memoryStore;
    }
  } catch (err) {
    console.warn('[Storage] Failed to read data file, using memory store:', err.message);
  }

  return memoryStore || {
    tasks: [],
    events: [],
    deletedEventKeys: [],
    lastSyncedAt: null,
    lastSyncStats: null,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Save updated dashboard data (tasks, events, comments, deleted events, sync metadata)
 */
export async function saveDashboardData(data) {
  const current = (await getDashboardData()) || {};
  const updated = {
    tasks: data.tasks !== undefined ? data.tasks : current.tasks || [],
    events: data.events !== undefined ? data.events : current.events || [],
    deletedEventKeys: data.deletedEventKeys !== undefined ? data.deletedEventKeys : current.deletedEventKeys || [],
    lastSyncedAt: data.lastSyncedAt !== undefined ? data.lastSyncedAt : current.lastSyncedAt || null,
    lastSyncStats: data.lastSyncStats !== undefined ? data.lastSyncStats : current.lastSyncStats || null,
    updatedAt: new Date().toISOString()
  };

  memoryStore = updated;

  // Persist to Vercel KV if available
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(`${process.env.KV_REST_API_URL}/set/school_dashboard_data`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(updated))
      });
    } catch (kvErr) {
      console.warn('[Storage] Vercel KV write failed:', kvErr.message);
    }
  }

  // Persist to local JSON file
  ensureStorage();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Storage] Failed to write local data file:', err.message);
  }

  return updated;
}
