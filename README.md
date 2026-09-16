# Westlake Lutheran Academy - School & Sports Dashboard

A full-stack Node.js and React dashboard application designed for families at Westlake Lutheran Academy. It parses school emails and sports updates (from Westlake Lutheran Academy and sportsYou) to extract student-specific assignments and schedules for **Ben** and **Jade**.

## Features

- **Inbox Sync & Parser Service**:
  - Connects to Google Gmail API using OAuth2 with `https://www.googleapis.com/auth/gmail.readonly` scope.
  - Automatically identifies emails originating from **Westlake Lutheran Academy** or **sportsYou**.
  - Extracts student-specific tasks and homework for **Ben** (High School) and **Jade** (Middle School).
  - Extracts upcoming events, games, practices, and chapel schedules.
  - Graceful fallback to rich sample school payload mode when offline or credentials are not yet configured.
- **Unified Parent Dashboard (React + Tailwind CSS)**:
  - **Top Bar**: With interactive "Sync Inbox" button and last sync indicators.
  - **Direct Launch Portals**: One-click launcher sidebar for:
    - Blackbaud Parent Portal (`https://westlakelutheran.myschoolapp.com`)
    - ClassLink SSO
    - sportsYou Athletics Portal
  - **Student View Toggles**: Instantly filter between **All Students**, **Ben**, and **Jade**.
  - **Assignment Checklist**: Interactive checklist with task completion toggles, subject tags, due dates, and quick add.
  - **Events & Sports Schedule Widget**: Chronological timeline of upcoming games, practices, chapel services, and school events with location and student tags.

## Project Structure

```text
├── server/
│   ├── index.js                  # Express backend & OAuth2 routes
│   └── services/
│       └── parserService.js      # Email parsing engine for tasks & events
├── src/
│   ├── App.jsx                   # React dashboard with Tailwind styling
│   ├── main.jsx                  # React DOM mount point
│   └── index.css                 # Tailwind CSS directives
├── index.html                    # HTML entry point
├── package.json                  # Dependencies & build scripts
├── vite.config.js                # Vite configuration with API proxy
├── tailwind.config.js            # Tailwind CSS configuration
└── postcss.config.js             # PostCSS plugins
```

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional for Live Gmail OAuth)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your Google Cloud credentials with Gmail API enabled:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=http://localhost:5001/auth/google/callback`

*(Note: The app will run in simulated school sample mode automatically if Google OAuth keys are not configured).*

### 3. Run Development Server
```bash
npm run dev
```
- Client runs at: `http://localhost:5173`
- Backend runs at: `http://localhost:5001`
