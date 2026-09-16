import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly'
];

let oauth2Client = null;
let userTokens = null;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

// ----------------------------------------------------
// OAuth2 Routes
// ----------------------------------------------------

/**
 * Route: Initiate Google OAuth2 login flow with Gmail readonly scope
 */
app.get(['/auth/google', '/api/auth/google'], (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({
      error: 'Google OAuth credentials not configured in environment variables.',
      message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file to enable live Gmail sync.'
    });
  }

  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
  }

  const authUrl = oauth2Client.generateAuthUrl({
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
    if (!oauth2Client) {
      oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI
      );
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    userTokens = tokens;

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
  res.json({
    configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    hasClientId: Boolean(GOOGLE_CLIENT_ID),
    hasClientSecret: Boolean(GOOGLE_CLIENT_SECRET),
    clientId: GOOGLE_CLIENT_ID ? `${GOOGLE_CLIENT_ID.substring(0, 20)}...` : null,
    redirectUri: GOOGLE_REDIRECT_URI,
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
  res.json({ success: true, message: 'Disconnected Google account' });
});

// ----------------------------------------------------
// Dashboard Sync Endpoint
// ----------------------------------------------------

/**
 * Route: /api/dashboard/sync
 * Calls the parserService to extract student tasks (Ben, Jade) and events
 * originating from Westlake Lutheran Academy or sportsYou.
 */
app.get('/api/dashboard/sync', async (req, res) => {
  try {
    // If authenticated with Gmail API, fetch real emails
    if (userTokens && oauth2Client) {
      try {
        oauth2Client.setCredentials(userTokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Search emails from Westlake or sportsYou
        const query = 'from:(westlake OR sportsyou) OR "Westlake Lutheran" OR sportsYou';
        const listRes = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 25
        });

        const messages = listRes.data.messages || [];
        const fetchedEmails = [];

        for (const msg of messages.slice(0, 15)) {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full'
          });
          fetchedEmails.push(detail.data);
        }

        const parsed = parseEmailPayloads(fetchedEmails);

        return res.json({
          success: true,
          source: 'gmail_api',
          syncedAt: new Date().toISOString(),
          tasks: parsed.tasks,
          events: parsed.events,
          stats: parsed.stats
        });
      } catch (gmailErr) {
        console.warn('Gmail API fetch failed or expired, falling back to sample school data:', gmailErr.message);
      }
    }

    // Default fallback: parse sample school & sports payloads through parserService
    const sampleEmails = getSampleEmails();
    const parsedData = parseEmailPayloads(sampleEmails);

    return res.json({
      success: true,
      source: 'sample_mode',
      isLiveGmail: false,
      message: 'Synced school communications for Ben and Jade from Westlake Lutheran Academy and sportsYou',
      syncedAt: new Date().toISOString(),
      tasks: parsedData.tasks,
      events: parsedData.events,
      stats: parsedData.stats
    });
  } catch (err) {
    console.error('Error during dashboard sync:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to sync dashboard inbox',
      message: err.message
    });
  }
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

// Serve frontend build if in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`School Dashboard backend server running on http://localhost:${PORT}`);
});
