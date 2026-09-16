import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { parseEmailPayloads } from './services/parserService.js';
import { getDashboardData, saveDashboardData } from './services/storageService.js';
import {
  getBlackbaudSession,
  saveBlackbaudSession,
  verifyAndDiscoverProfiles,
  syncBlackbaudData
} from './services/blackbaudService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// CORS configuration for local React Vite development
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', `http://localhost:${PORT}`],
  credentials: true
}));

app.use(express.json());

// Google OAuth2 setup
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly'
];

const TOKENS_PATH = process.env.VERCEL ? '/tmp/.tokens.json' : path.join(__dirname, '.tokens.json');

let userTokens = null;

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

async function getUserTokens() {
  if (userTokens) return userTokens;

  // 1. Direct environment variable (ideal for Vercel deployment)
  if (process.env.GOOGLE_USER_TOKENS) {
    try {
      userTokens = JSON.parse(process.env.GOOGLE_USER_TOKENS);
      return userTokens;
    } catch (e) {
      console.warn('[Tokens] Failed to parse GOOGLE_USER_TOKENS env var');
    }
  }
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    userTokens = {
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      token_type: 'Bearer'
    };
    return userTokens;
  }

  // 2. Upstash Redis / Vercel KV store
  const { url: kvUrl, token: kvToken } = getKvConfig();
  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/google_user_tokens`, {
        headers: { Authorization: `Bearer ${kvToken}` }
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
            userTokens = parsed;
            return userTokens;
          }
        }
      }
    } catch (kvErr) {
      console.warn('[Tokens] Upstash/KV read failed:', kvErr.message);
    }
  }

  // 3. Local filesystem tokens file
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      userTokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
      return userTokens;
    } catch (e) {}
  }

  return null;
}

async function saveTokens(tokens) {
  userTokens = tokens;

  // Persist to Upstash / Vercel KV if configured
  const { url: kvUrl, token: kvToken } = getKvConfig();
  if (kvUrl && kvToken) {
    try {
      if (tokens) {
        await fetch(`${kvUrl}/set/google_user_tokens`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: typeof tokens === 'string' ? tokens : JSON.stringify(tokens)
        });
      } else {
        // Delete token on disconnect
        await fetch(`${kvUrl}/del/google_user_tokens`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${kvToken}` }
        });
      }
    } catch (kvErr) {
      console.warn('[Tokens] Upstash/KV write failed:', kvErr.message);
    }
  }

  // Persist to local filesystem
  try {
    if (tokens) {
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
    } else if (fs.existsSync(TOKENS_PATH)) {
      fs.unlinkSync(TOKENS_PATH);
    }
  } catch (e) {
    console.warn('[Tokens] Local file save failed:', e.message);
  }
}

let oauth2Client = null;

function getOAuthConfig() {
  dotenv.config();
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/^['"]|['"]$/g, '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/^['"]|['"]$/g, '').trim();
  const redirectUri = (
    process.env.GOOGLE_REDIRECT_URI || 
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/auth/google/callback` : `http://localhost:${PORT}/auth/google/callback`)
  ).replace(/^['"]|['"]$/g, '').trim();
  return { clientId, clientSecret, redirectUri };
}

function getOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  if (clientId && clientSecret) {
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }
  return null;
}

// ----------------------------------------------------
// OAuth2 Routes
// ----------------------------------------------------

/**
 * Route: Initiate Google OAuth2 login flow with Gmail readonly scope
 */
app.get(['/auth/google', '/api/auth/google'], (req, res) => {
  const { clientId, clientSecret } = getOAuthConfig();
  if (!clientId || !clientSecret) {
    return res.status(400).json({
      error: 'Google OAuth credentials not configured in environment variables.',
      message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file to enable live Gmail sync.'
    });
  }

  const client = getOAuth2Client();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent'
  });

  if (req.query.json === 'true') {
    return res.json({ authUrl });
  }

  res.redirect(authUrl);
});

/**
 * Route: Google OAuth2 callback handler
 */
app.get(['/auth/google/callback', '/api/auth/google/callback'], async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('Google OAuth error:', error);
    return res.redirect(`${FRONTEND_URL}?auth=error&message=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${FRONTEND_URL}?auth=missing_code`);
  }

  try {
    const client = getOAuth2Client();
    if (!client) {
      throw new Error('OAuth2 client not initialized. Check credentials in .env');
    }

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    await saveTokens(tokens);

    console.log('Google OAuth authentication successful');
    res.redirect(`${FRONTEND_URL}?auth=success`);
  } catch (err) {
    console.error('Failed to exchange authorization code for tokens:', err.message);
    res.redirect(`${FRONTEND_URL}?auth=failed&message=${encodeURIComponent(err.message)}`);
  }
});

/**
 * Route: Get Google OAuth authentication status
 */
app.get('/api/auth/status', async (req, res) => {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const tokens = await getUserTokens();
  res.json({
    configured: Boolean(clientId && clientSecret),
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    clientId: clientId ? `${clientId.substring(0, 20)}...` : null,
    redirectUri: redirectUri,
    authenticated: Boolean(tokens),
    scope: GMAIL_SCOPES
  });
});

/**
 * Route: Disconnect / Log out Google OAuth
 */
app.post('/api/auth/disconnect', async (req, res) => {
  await saveTokens(null);
  if (oauth2Client) {
    oauth2Client.setCredentials({});
  }
  res.json({ success: true, message: 'Disconnected Google account' });
});

// ----------------------------------------------------
// Blackbaud Portal (myschoolapp.com) Endpoints
// ----------------------------------------------------

/**
 * Route: GET /api/blackbaud/status
 * Returns connection status and discovered student IDs
 */
app.get('/api/blackbaud/status', async (req, res) => {
  try {
    const session = await getBlackbaudSession();
    const isConnected = Boolean(session && session.cookie);
    res.json({
      connected: isConnected,
      subdomain: session?.subdomain || 'westlakelutheran',
      students: session?.students || [],
      verifiedAt: session?.verifiedAt || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/blackbaud/connect
 * Connects and stores session cookie for westlakelutheran.myschoolapp.com
 */
app.post('/api/blackbaud/connect', async (req, res) => {
  try {
    const { cookie, benStudentId, jadeStudentId } = req.body;
    if (!cookie) {
      return res.status(400).json({ error: 'Session cookie or token is required' });
    }

    try {
      const discovered = await verifyAndDiscoverProfiles(cookie);
      if (benStudentId) discovered.benStudentId = benStudentId;
      if (jadeStudentId) discovered.jadeStudentId = jadeStudentId;
      await saveBlackbaudSession(discovered);
      res.json({ success: true, message: 'Connected to Blackbaud Portal successfully', data: discovered });
    } catch (verifyErr) {
      // Fallback: save session and manual student IDs
      const sessionObj = {
        cookie: cookie.trim(),
        subdomain: 'westlakelutheran',
        benStudentId: benStudentId || null,
        jadeStudentId: jadeStudentId || null,
        students: [
          { student: 'Ben', id: benStudentId },
          { student: 'Jade', id: jadeStudentId }
        ].filter(s => Boolean(s.id)),
        verifiedAt: new Date().toISOString()
      };
      await saveBlackbaudSession(sessionObj);
      res.json({ success: true, message: 'Saved Blackbaud session', data: sessionObj, note: verifyErr.message });
    }
  } catch (err) {
    console.error('Blackbaud connection failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/blackbaud/disconnect
 */
app.post('/api/blackbaud/disconnect', async (req, res) => {
  try {
    await saveBlackbaudSession(null);
    res.json({ success: true, message: 'Disconnected Blackbaud Portal' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Route: GET /api/blackbaud/sync
 * Syncs grades, missing assignments, and portal assignments
 */
app.get('/api/blackbaud/sync', async (req, res) => {
  try {
    const result = await syncBlackbaudData();
    
    // Save grades and missing assignments, and merge new portal assignments into dashboard tasks
    const stored = await getDashboardData();
    const existing = stored.tasks || [];
    const seenIds = new Set(existing.map(t => t.id));
    
    const newItems = (result.assignments || []).filter(a => !seenIds.has(a.id));
    const mergedTasks = newItems.length > 0 ? [...newItems, ...existing] : existing;

    await saveDashboardData({
      tasks: mergedTasks,
      grades: result.grades || stored.grades,
      missingAssignments: result.missingAssignments || stored.missingAssignments
    });

    res.json({
      ...result,
      tasks: mergedTasks
    });
  } catch (err) {
    console.error('Blackbaud sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Dashboard State Persistence Endpoints
// ----------------------------------------------------

/**
 * Route: GET /api/dashboard/state
 * Returns stored tasks, events, and last synced timestamp
 */
app.get('/api/dashboard/state', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data);
  } catch (err) {
    console.error('Failed to load dashboard state:', err);
    res.status(500).json({ error: 'Failed to load state' });
  }
});

/**
 * Route: POST /api/dashboard/state
 * Saves updated tasks, comments, and completions
 */
app.post('/api/dashboard/state', async (req, res) => {
  try {
    const { tasks, events, deletedEventKeys } = req.body;
    const existing = await getDashboardData();

    let updatedTasks = existing.tasks || [];
    if (Array.isArray(tasks) && tasks.length > 0) {
      const clientTaskMap = new Map(tasks.map(t => [t.id || t.title.toLowerCase(), t]));
      // Update existing tasks with client state (completion, comments)
      updatedTasks = updatedTasks.map(srvTask => {
        const clientTask = clientTaskMap.get(srvTask.id) || clientTaskMap.get(srvTask.title.toLowerCase());
        if (clientTask) {
          return {
            ...srvTask,
            completed: clientTask.completed !== undefined ? clientTask.completed : srvTask.completed,
            comments: clientTask.comments || srvTask.comments || []
          };
        }
        return srvTask;
      });

      // Also append any new user-added custom tasks
      for (const clientTask of tasks) {
        if (clientTask.id && clientTask.id.startsWith('task_custom_')) {
          if (!updatedTasks.some(t => t.id === clientTask.id)) {
            updatedTasks.unshift(clientTask);
          }
        }
      }
    }

    const updated = await saveDashboardData({
      tasks: updatedTasks,
      events: events !== undefined ? events : existing.events,
      deletedEventKeys: deletedEventKeys !== undefined ? deletedEventKeys : existing.deletedEventKeys
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Failed to save dashboard state:', err);
    res.status(500).json({ error: 'Failed to save state' });
  }
});

// ----------------------------------------------------
// Dashboard Sync Endpoint
// ----------------------------------------------------

/**
 * Route: /api/dashboard/sync
 * Pulls school emails from previous pull (up to 2 weeks maximum)
 * Supports ?mode=incremental|full
 */
app.get('/api/dashboard/sync', async (req, res) => {
  try {
    const client = getOAuth2Client();
    const tokens = await getUserTokens();

    // If not authenticated, return clear unauthenticated status
    if (!tokens || !client) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        source: 'unauthenticated',
        message: 'Google account is not connected. Click "Connect Gmail" to link your inbox and extract school assignments.',
        tasks: [],
        events: [],
        emails: [],
        stats: { totalProcessed: 0, matchedEmails: 0, tasksFound: 0, eventsFound: 0 }
      });
    }

    const storedData = await getDashboardData();
    const mode = req.query.mode || 'incremental'; // 'incremental' | 'full'
    const maxDays = parseInt(req.query.days || '14', 10);
    const twoWeeksAgoSeconds = Math.floor((Date.now() - maxDays * 24 * 60 * 60 * 1000) / 1000);

    // Incremental lookback: pull back to previous pull (with 1 hour buffer), capped at max 2 weeks
    let afterSeconds = twoWeeksAgoSeconds;
    if (mode !== 'full' && storedData.lastSyncedAt) {
      const prevSyncSeconds = Math.floor(new Date(storedData.lastSyncedAt).getTime() / 1000);
      afterSeconds = Math.max(prevSyncSeconds - 3600, twoWeeksAgoSeconds);
    }

    // Live Gmail API sync
    try {
      client.setCredentials(tokens);
      const gmail = google.gmail({ version: 'v1', auth: client });

      const query = `after:${afterSeconds} (from:westlakelutheran.org OR from:myschoolapp.com OR from:sportsyou.com OR "Westlake Lutheran" OR "sportsYou" OR "Blackbaud") -from:me`;
      console.log(`[Gmail Sync] Mode: ${mode} | Syncing after: ${afterSeconds} (${new Date(afterSeconds * 1000).toISOString()})`);

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 80
      });

      const messages = listRes.data.messages || [];
      console.log(`[Gmail Sync] Found ${messages.length} matching candidate messages.`);

      if (messages.length === 0) {
        const nowIso = new Date().toISOString();
        await saveDashboardData({ lastSyncedAt: nowIso });
        return res.json({
          success: true,
          source: 'gmail_api',
          isLiveGmail: true,
          timeframe: mode === 'full' ? `Last ${maxDays} days` : 'Since previous pull',
          message: `Inbox is up to date. No new school communications found since last sync.`,
          syncedAt: nowIso,
          tasks: storedData.tasks || [],
          events: storedData.events || [],
          emails: [],
          stats: { totalProcessed: 0, matchedEmails: 0, tasksFound: (storedData.tasks || []).length, eventsFound: (storedData.events || []).length }
        });
      }

      // Fetch message contents with safe pause to stay well within per-minute quota
      const fetchedEmails = [];
      const fetchLimit = Math.min(messages.length, 50);
      for (const msg of messages.slice(0, fetchLimit)) {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full'
          });
          fetchedEmails.push(detail.data);
          await new Promise(resolve => setTimeout(resolve, 45));
        } catch (msgErr) {
          console.warn(`[Gmail Sync] Error fetching email ${msg.id}:`, msgErr.message);
          if (msgErr.message && (msgErr.message.includes('Quota exceeded') || msgErr.message.includes('403'))) {
            console.warn('[Gmail Sync] Per-minute quota limit encountered, continuing with fetched emails so far.');
            break;
          }
        }
      }

      const parsed = parseEmailPayloads(fetchedEmails, { daysBack: maxDays });

      // Merge newly parsed tasks with existing stored tasks (preserving user checkmarks and comments)
      const existingTasks = storedData.tasks || [];
      const completedMap = new Map(existingTasks.map(t => [t.title.toLowerCase(), t.completed]));
      const commentsMap = new Map(existingTasks.map(t => [t.title.toLowerCase(), t.comments || []]));

      const newTasksByTitle = new Map();
      parsed.tasks.forEach(t => {
        const key = t.title.toLowerCase();
        newTasksByTitle.set(key, {
          ...t,
          completed: completedMap.has(key) ? completedMap.get(key) : false,
          comments: commentsMap.has(key) && commentsMap.get(key).length > 0 ? commentsMap.get(key) : (t.comments || [])
        });
      });

      const mergedTasks = [];
      const seenTitles = new Set();

      for (const [key, task] of newTasksByTitle.entries()) {
        seenTitles.add(key);
        mergedTasks.push(task);
      }

      for (const task of existingTasks) {
        const key = task.title.toLowerCase();
        if (!seenTitles.has(key)) {
          // Filter out obsolete unformatted bullet sentences or bad old regex captures
          if (key.includes('also, those of you') || key.includes('lease remember') || key.includes('synthetic')) {
            continue;
          }
          seenTitles.add(key);
          mergedTasks.push(task);
        }
      }

      // Merge events
      const existingEvents = storedData.events || [];
      const deletedEventKeys = new Set(
        (storedData.deletedEventKeys || []).map(k => String(k).toLowerCase())
      );

      // Build lookup for acknowledged events
      const acknowledgedMap = new Map();
      existingEvents.forEach(ev => {
        const key = (ev.id || `${ev.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date}`).toLowerCase();
        if (ev.acknowledged) {
          acknowledgedMap.set(key, {
            acknowledged: true,
            acknowledgedAt: ev.acknowledgedAt || null
          });
        }
      });

      const seenEvents = new Set();
      const mergedEvents = [];

      // Add existing events (unless deleted)
      for (const ev of existingEvents) {
        const key = (ev.id || `${ev.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date}`).toLowerCase();
        if (!deletedEventKeys.has(key) && !seenEvents.has(key)) {
          seenEvents.add(key);
          mergedEvents.push(ev);
        }
      }

      // Add newly parsed events (unless deleted or already present)
      for (const ev of parsed.events) {
        const key = (ev.id || `${ev.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date}`).toLowerCase();
        if (deletedEventKeys.has(key)) {
          continue;
        }
        if (!seenEvents.has(key)) {
          seenEvents.add(key);
          const ackInfo = acknowledgedMap.get(key);
          mergedEvents.push({
            ...ev,
            acknowledged: ackInfo ? ackInfo.acknowledged : false,
            acknowledgedAt: ackInfo ? ackInfo.acknowledgedAt : null
          });
        }
      }

      // Save merged state to persistent storage
      const nowIso = new Date().toISOString();
      const updatedStorage = await saveDashboardData({
        tasks: mergedTasks,
        events: mergedEvents,
        lastSyncedAt: nowIso,
        lastSyncStats: parsed.stats
      });

      return res.json({
        success: true,
        source: 'gmail_api',
        isLiveGmail: true,
        timeframe: mode === 'full' ? `Last ${maxDays} days` : 'Since previous pull',
        message: `Extracted ${parsed.tasks.length} new/updated assignments and ${parsed.events.length} schedule events.`,
        syncedAt: nowIso,
        tasks: updatedStorage.tasks,
        events: updatedStorage.events,
        emails: parsed.emails,
        stats: parsed.stats
      });
    } catch (gmailErr) {
      console.error('[Gmail Sync] Gmail API fetch failed:', gmailErr.message);
      return res.status(500).json({
        success: false,
        authenticated: true,
        source: 'gmail_api_error',
        message: `Gmail API error: ${gmailErr.message}`,
        tasks: storedData.tasks || [],
        events: storedData.events || [],
        emails: [],
        stats: { totalProcessed: 0, matchedEmails: 0, tasksFound: 0, eventsFound: 0 }
      });
    }
  } catch (err) {
    console.error('Error during dashboard sync:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to sync dashboard inbox',
      message: err.message,
      tasks: [],
      events: []
    });
  }
});

// Route: Get full email archive from the last 2 weeks
app.get('/api/dashboard/emails', (req, res) => {
  const days = parseInt(req.query.days || '14', 10);
  const sampleEmails = getSampleEmails();
  const parsedData = parseEmailPayloads(sampleEmails, { daysBack: days });
  res.json({
    timeframe: `Last ${days} days`,
    count: parsedData.emails.length,
    emails: parsedData.emails
  });
});

// Also support POST /api/dashboard/sync with optional custom email payloads
app.post('/api/dashboard/sync', (req, res) => {
  try {
    const payloads = req.body?.emails || getSampleEmails();
    const parsedData = parseEmailPayloads(payloads);

    res.json({
      success: true,
      source: req.body?.emails ? 'custom_payload' : 'sample_mode',
      syncedAt: new Date().toISOString(),
      tasks: parsedData.tasks,
      events: parsedData.events,
      stats: parsedData.stats
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'school-dashboard-server', port: PORT });
});

// Serve static frontend build if dist exists
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Redirect browser visits to the frontend React app (port 5173 in dev)
app.get('/', (req, res) => {
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(distPath, 'index.html'))) {
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  res.redirect(FRONTEND_URL);
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`School Dashboard backend server running on http://localhost:${PORT}`);
  });
}

export default app;
