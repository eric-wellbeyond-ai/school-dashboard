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
import { decodeHtmlEntities } from './parserService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'dashboard-data.json');

// In-memory cache for fast access
let memoryStore = null;

function cleanDeep(obj) {
  if (typeof obj === 'string') {
    return decodeHtmlEntities(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = cleanDeep(v);
    }
    return res;
  }
  return obj;
}

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

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

/**
 * Get current dashboard data
 */
export async function getDashboardData() {
  // If Upstash Redis / Vercel KV is configured
  const { url: kvUrl, token: kvToken } = getKvConfig();
  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/school_dashboard_data`, {
        headers: {
          Authorization: `Bearer ${kvToken}`
        }
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.result) {
          let parsed = json.result;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch (e) {}
          }
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch (e) {}
          }
          if (parsed && typeof parsed === 'object') {
            memoryStore = cleanDeep(parsed);
            return memoryStore;
          }
        }
      }
    } catch (kvErr) {
      console.warn('[Storage] Upstash/KV read failed, falling back to local file:', kvErr.message);
    }
  }

  // Local file storage / Seed initial data
  ensureStorage();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      memoryStore = cleanDeep(JSON.parse(raw));

      // Auto-seed Upstash if it was empty on first startup!
      if (kvUrl && kvToken && memoryStore && memoryStore.tasks && memoryStore.tasks.length > 0) {
        fetch(`${kvUrl}/set/school_dashboard_data`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(memoryStore)
        }).catch(() => {});
      }

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
  const rawUpdated = {
    tasks: data.tasks !== undefined ? data.tasks : current.tasks || [],
    events: data.events !== undefined ? data.events : current.events || [],
    deletedEventKeys: data.deletedEventKeys !== undefined ? data.deletedEventKeys : current.deletedEventKeys || [],
    grades: data.grades !== undefined ? data.grades : current.grades || { Ben: [], Jade: [] },
    missingAssignments: data.missingAssignments !== undefined ? data.missingAssignments : current.missingAssignments || [],
    lastSyncedAt: data.lastSyncedAt !== undefined ? data.lastSyncedAt : current.lastSyncedAt || null,
    lastSyncStats: data.lastSyncStats !== undefined ? data.lastSyncStats : current.lastSyncStats || null,
    updatedAt: new Date().toISOString()
  };

  const updated = cleanDeep(rawUpdated);
  memoryStore = updated;

  // Persist to Upstash / Vercel KV if available
  const { url: kvUrl, token: kvToken } = getKvConfig();
  if (kvUrl && kvToken) {
    try {
      await fetch(`${kvUrl}/set/school_dashboard_data`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        },
        body: typeof updated === 'string' ? updated : JSON.stringify(updated)
      });
    } catch (kvErr) {
      console.warn('[Storage] Upstash/KV write failed:', kvErr.message);
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
