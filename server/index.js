import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { parseEmailPayloads } from './services/parserService.js';
import { getDashboardData, saveDashboardData } from './services/storageService.js';
import {
  verifyAndDiscoverProfiles,
  syncBlackbaudData,
  studentsFromContext
} from './services/blackbaudService.js';
import { runWithWlaSession } from './services/wlaContext.js';
import {
  SESSION_COOKIE,
  parseCookies,
  sessionCookieHeader,
  identifyUser,
  publicIdentity,
  stageLogin,
  takeClaim,
  createSession,
  getSession,
  deleteSession,
  filterPayloadForIdentity,
  mergeStudentWrite
} from './services/sessionStore.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// CORS: local dashboard plus myschoolapp so the bookmarklet can POST while
// the Westlake portal tab stays open.
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const cookies = parseCookies(req);
  const session = getSession(cookies[SESSION_COOKIE]);
  req.wla = session;
  runWithWlaSession(session, () => next());
});

function killMacWebview() {
  if (macWebviewProc) {
    try { macWebviewProc.kill('SIGTERM'); } catch {}
    macWebviewProc = null;
  }
  try {
    execSync('pkill -f mac_portal_agent.py', { stdio: 'ignore' });
  } catch {}
}

function isPythonAgent(req) {
  return /python-requests|python-urllib/i.test(req.headers['user-agent'] || '');
}

async function attachIdentifiedSession(discovered, req, res) {
  const identity = identifyUser(discovered);
  const record = { ...discovered, ...identity };
  const { claimToken } = stageLogin(record);
  const syncResult = await runWithWlaSession(record, () => syncBlackbaudData());
  if (!isPythonAgent(req)) {
    const id = createSession(record);
    res.setHeader('Set-Cookie', sessionCookieHeader(id));
  }
  return { record, claimToken, syncResult, identity: publicIdentity(record) };
}

async function mergeSyncIntoStore(result, identity) {
  const stored = await getDashboardData();
  const grades = { ...(stored.grades || {}) };
  const allowedKeys = new Set(identity?.allowedStudentKeys || Object.keys(result.grades || {}));
  for (const [key, rows] of Object.entries(result.grades || {})) {
    if (identity?.role !== 'student' || allowedKeys.has(key)) {
      grades[key] = rows;
    }
  }
  const keepMissing = identity?.role === 'student'
    ? (stored.missingAssignments || []).filter((m) => !allowedKeys.has(m.student))
    : [];
  const newMissing = (result.missingAssignments || []).filter((m) => (
    identity?.role !== 'student' || allowedKeys.has(m.student)
  ));
  const existing = stored.tasks || [];
  const seenIds = new Set(existing.map((t) => t.id));
  const newItems = (result.assignments || []).filter((a) => !seenIds.has(a.id));
  const mergedTasks = newItems.length > 0 ? [...newItems, ...existing] : existing;
  await saveDashboardData({
    grades,
    missingAssignments: [...keepMissing, ...newMissing],
    tasks: mergedTasks,
    lastSyncedAt: result.lastSyncedAt || new Date().toISOString()
  });
  return filterPayloadForIdentity({
    ...stored,
    grades,
    missingAssignments: [...keepMissing, ...newMissing],
    tasks: mergedTasks,
    lastSyncedAt: result.lastSyncedAt
  }, identity);
}
const SCHOOL_APP_ROOT = path.resolve(__dirname, '..', '..');
const MAC_AGENT = path.join(SCHOOL_APP_ROOT, 'mac_portal_agent.py');
const MAC_WEBVIEW_LOCAL = `http://127.0.0.1:${process.env.MAC_WEBVIEW_PORT || '5055'}`;
let macWebviewProc = null;

async function macWebviewHealth(url = MAC_WEBVIEW_LOCAL) {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

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
 * Route: GET /api/blackbaud/mac-webview
 * Status of the Mac Chromium login window. Does not start Chrome.
 */
app.get('/api/blackbaud/mac-webview', async (req, res) => {
  const port = Number(process.env.MAC_WEBVIEW_PORT || 5055);
  const up = await macWebviewHealth();
  const payload = {
    port,
    running: up,
    canStart: !process.env.VERCEL,
    posted: false,
    tokenValid: false,
    homeReady: false,
    claimToken: null,
    students: [],
    gradeCount: 0
  };
  if (up) {
    try {
      const agentRes = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(1500)
      });
      if (agentRes.ok) {
        const agent = await agentRes.json();
        payload.posted = Boolean(agent.posted);
        payload.tokenValid = Boolean(agent.tokenValid);
        payload.homeReady = Boolean(agent.homeReady);
        payload.claimToken = agent.claimToken || null;
        payload.url = agent.url || '';
        payload.students = agent.students || [];
        payload.gradeCount = Number(agent.gradeCount || 0);
        payload.error = agent.error || null;
      }
    } catch {}
  }
  res.json(payload);
});

app.post('/api/blackbaud/mac-webview/start', async (req, res) => {
  if (process.env.VERCEL) {
    return res.status(400).json({
      error: 'Mac webview only runs with the local dashboard on this Mac.'
    });
  }
  if (!fs.existsSync(MAC_AGENT)) {
    return res.status(500).json({ error: `Missing ${MAC_AGENT}` });
  }
  killMacWebview();
  await new Promise((resolve) => setTimeout(resolve, 400));
  try {
    const profile = path.join(__dirname, `.playwright-login-${Date.now()}`);
    macWebviewProc = spawn('python3', [MAC_AGENT], {
      cwd: SCHOOL_APP_ROOT,
      env: {
        ...process.env,
        DASHBOARD_API: 'http://127.0.0.1:5001',
        MAC_WEBVIEW_PROFILE: profile
      },
      stdio: 'inherit'
    });
    macWebviewProc.on('exit', (code) => {
      console.warn('[Mac webview] exited', code);
      macWebviewProc = null;
    });
    res.json({ ok: true, running: false, starting: true, port: Number(process.env.MAC_WEBVIEW_PORT || 5055) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Route: GET /api/blackbaud/status
 * Returns connection status and discovered student IDs
 */
app.get('/api/blackbaud/status', async (req, res) => {
  try {
    res.json(publicIdentity(req.wla));
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
    const { cookie, benStudentId, jadeStudentId, homeUrl } = req.body;
    if (!cookie) {
      return res.status(400).json({ error: 'Session cookie or token is required' });
    }

    try {
      const discovered = await verifyAndDiscoverProfiles(cookie, { homeUrl });
      if (benStudentId) discovered.benStudentId = benStudentId;
      if (jadeStudentId) discovered.jadeStudentId = jadeStudentId;
      const attached = await attachIdentifiedSession(discovered, req, res);
      if (attached.syncResult?.connected) {
        await mergeSyncIntoStore(attached.syncResult, attached.record);
      }
      res.json({
        success: true,
        message: 'Connected to Blackbaud Portal successfully',
        claimToken: attached.claimToken,
        data: attached.identity,
        grades: attached.syncResult?.grades || {},
        students: attached.identity.students
      });
    } catch (verifyErr) {
      return res.status(401).json({
        success: false,
        error: verifyErr.message || 'Blackbaud session token t is not valid.'
      });
    }
  } catch (err) {
    console.error('Blackbaud connection failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/blackbaud/claim', async (req, res) => {
  try {
    const record = takeClaim(req.body?.claimToken);
    if (!record?.cookie) {
      return res.status(401).json({ success: false, error: 'Sign-in expired. Use Log in with Blackbaud again.' });
    }
    const id = createSession(record);
    res.setHeader('Set-Cookie', sessionCookieHeader(id));
    res.json({ success: true, data: publicIdentity(record) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/blackbaud/ingest
 * Bookmarklet posts grades fetched in the still-open myschoolapp tab.
 */
app.post('/api/blackbaud/ingest', async (req, res) => {
  try {
    const { cookie, context, students: postedStudents, grades } = req.body || {};
    const mappedGrades = {
      Ben: Array.isArray(grades?.Ben) ? grades.Ben : [],
      Jade: Array.isArray(grades?.Jade) ? grades.Jade : []
    };
    Object.entries(grades || {}).forEach(([key, rows]) => {
      if (key === 'Ben' || key === 'Jade') return;
      if (Array.isArray(rows) && rows.length) mappedGrades[key] = rows;
    });

    const hasRows = Object.values(mappedGrades).some((rows) => Array.isArray(rows) && rows.length > 0);
    if (!hasRows) {
      return res.status(400).json({
        success: false,
        error: 'No course grades were found on this portal session.'
      });
    }

    const students = Array.isArray(postedStudents) && postedStudents.length
      ? postedStudents
      : studentsFromContext(context || {});

    await saveDashboardData({
      grades: mappedGrades,
      lastSyncedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Ingested portal grades',
      data: { students, grades: mappedGrades }
    });
  } catch (err) {
    console.error('Blackbaud ingest failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/blackbaud/disconnect
 */
app.post('/api/blackbaud/disconnect', async (req, res) => {
  try {
    const cookies = parseCookies(req);
    deleteSession(cookies[SESSION_COOKIE]);
    res.setHeader('Set-Cookie', sessionCookieHeader('', { clear: true }));
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
    if (!result.connected) {
      return res.json(result);
    }
    const identity = req.wla || result;
    const filtered = await mergeSyncIntoStore(result, identity);
    res.json({
      ...result,
      ...filtered,
      connected: result.connected
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
    res.json(filterPayloadForIdentity(data, req.wla));
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
    const identity = req.wla;

    if (identity?.role === 'student') {
      const merged = mergeStudentWrite(existing, { tasks, events, deletedEventKeys }, identity);
      const updated = await saveDashboardData(merged);
      return res.json({ success: true, data: filterPayloadForIdentity(updated, identity) });
    }

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
        return res.json(filterPayloadForIdentity({
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
        }, req.wla));
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

      // Create lookup map of newly parsed events to enrich existing events
      const newlyParsedMap = new Map();
      for (const ev of parsed.events) {
        const key = (ev.id || `${ev.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date}`).toLowerCase();
        newlyParsedMap.set(key, ev);
      }

      // Add existing events (unless deleted), enriched with any new metadata
      for (const ev of existingEvents) {
        const key = (ev.id || `${ev.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date}`).toLowerCase();
        if (!deletedEventKeys.has(key) && !seenEvents.has(key)) {
          seenEvents.add(key);
          const newlyParsed = newlyParsedMap.get(key);
          mergedEvents.push({
            ...ev,
            emailId: ev.emailId || (newlyParsed ? newlyParsed.emailId : undefined),
            emailFrom: ev.emailFrom || (newlyParsed ? newlyParsed.emailFrom : undefined),
            rawEmailFrom: ev.rawEmailFrom || (newlyParsed ? newlyParsed.rawEmailFrom : undefined),
            emailSubject: ev.emailSubject || (newlyParsed ? newlyParsed.emailSubject : undefined),
            emailDate: ev.emailDate || (newlyParsed ? newlyParsed.emailDate : undefined),
            emailBody: ev.emailBody || (newlyParsed ? newlyParsed.emailBody : undefined)
          });
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

      return res.json(filterPayloadForIdentity({
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
      }, req.wla));
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`School Dashboard backend server running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
