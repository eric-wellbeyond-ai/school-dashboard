import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { parseEmailPayloads, getSampleEmails } from './services/parserService.js';

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

const TOKENS_PATH = path.join(__dirname, '.tokens.json');

function loadTokens() {
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
      console.log('Loaded saved Google OAuth tokens from .tokens.json');
      return data;
    } catch (e) {
      return null;
    }
  }
  return null;
}

function saveTokens(tokens) {
  try {
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
    console.log('Saved Google OAuth tokens to .tokens.json');
  } catch (e) {
    console.error('Failed to save tokens:', e.message);
  }
}

let oauth2Client = null;
let userTokens = loadTokens();

function getOAuthConfig() {
  dotenv.config();
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/^['"]|['"]$/g, '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/^['"]|['"]$/g, '').trim();
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`).replace(/^['"]|['"]$/g, '').trim();
  return { clientId, clientSecret, redirectUri };
}

function getOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  if (clientId && clientSecret) {
    if (!oauth2Client) {
      oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    }
  }
  return oauth2Client;
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
    userTokens = tokens;
    saveTokens(tokens);

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
app.get('/api/auth/status', (req, res) => {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  res.json({
    configured: Boolean(clientId && clientSecret),
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    clientId: clientId ? `${clientId.substring(0, 20)}...` : null,
    redirectUri: redirectUri,
    authenticated: Boolean(userTokens),
    scope: GMAIL_SCOPES
  });
});

/**
 * Route: Disconnect / Log out Google OAuth
 */
app.post('/api/auth/disconnect', (req, res) => {
  userTokens = null;
  if (oauth2Client) {
    oauth2Client.setCredentials({});
  }
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      fs.unlinkSync(TOKENS_PATH);
    } catch (e) {}
  }
  res.json({ success: true, message: 'Disconnected Google account' });
});

// ----------------------------------------------------
// Dashboard Sync Endpoint
// ----------------------------------------------------

/**
 * Route: /api/dashboard/sync
 * Calls the parserService to extract student tasks (Ben, Jade) and events
 * originating from Westlake Lutheran Academy or sportsYou.
 * Supports ?days=14 (default: last 2 weeks).
 */
app.get('/api/dashboard/sync', async (req, res) => {
  try {
    const days = parseInt(req.query.days || '14', 10);
    const mode = req.query.mode || 'auto'; // 'auto' | 'live' | 'demo'
    const client = getOAuth2Client();

    // If demo mode is explicitly requested, or if not authenticated
    if (mode === 'demo' || !userTokens || !client) {
      const sampleEmails = getSampleEmails();
      const parsedData = parseEmailPayloads(sampleEmails, { daysBack: days });

      return res.json({
        success: true,
        source: 'demo_archive',
        isLiveGmail: false,
        timeframe: `Last ${days} days`,
        message: `Extracted school communications from the last ${days} days for Ben and Jade (Westlake Lutheran Academy & sportsYou)`,
        syncedAt: new Date().toISOString(),
        tasks: parsedData.tasks,
        events: parsedData.events,
        emails: parsedData.emails,
        stats: parsedData.stats
      });
    }

    // Live Gmail API sync
    try {
      client.setCredentials(userTokens);
      const gmail = google.gmail({ version: 'v1', auth: client });

      const secondsCutoff = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
      const query = `(from:(westlake OR sportsyou) OR "Westlake Lutheran" OR sportsYou OR subject:(Westlake OR sportsYou OR Ben OR Jade)) after:${secondsCutoff}`;

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 50
      });

      const messages = listRes.data.messages || [];
      const fetchedEmails = [];

      for (const msg of messages.slice(0, 30)) {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });
        fetchedEmails.push(detail.data);
      }

      const parsed = parseEmailPayloads(fetchedEmails, { daysBack: days });

      return res.json({
        success: true,
        source: 'gmail_api',
        timeframe: `Last ${days} days`,
        syncedAt: new Date().toISOString(),
        tasks: parsed.tasks,
        events: parsed.events,
        emails: parsed.emails,
        stats: parsed.stats
      });
    } catch (gmailErr) {
      console.warn('Gmail API fetch failed, falling back to demo 2-week school data archive:', gmailErr.message);
      const sampleEmails = getSampleEmails();
      const parsedData = parseEmailPayloads(sampleEmails, { daysBack: days });

      return res.json({
        success: true,
        source: 'demo_archive',
        isLiveGmail: false,
        timeframe: `Last ${days} days`,
        message: `Extracted school communications from the last ${days} days for Ben and Jade (Westlake Lutheran Academy & sportsYou)`,
        syncedAt: new Date().toISOString(),
        tasks: parsedData.tasks,
        events: parsedData.events,
        emails: parsedData.emails,
        stats: parsedData.stats
      });
    }
  } catch (err) {
    console.error('Error during dashboard sync:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to sync dashboard inbox',
      message: err.message
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

app.listen(PORT, () => {
  console.log(`School Dashboard backend server running on http://localhost:${PORT}`);
});
