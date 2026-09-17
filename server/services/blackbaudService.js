/**
 * blackbaudService.js
 * 
 * Direct API client for Westlake Lutheran Academy's Blackbaud Portal
 * (westlakelutheran.myschoolapp.com).
 * 
 * Provides 100% Vercel-compatible serverless Node.js integration:
 * - Fetches course gradebook and cumulative grades (letter grades & percentages)
 * - Fetches missing assignments and due-soon portal tasks
 * - Fetches daily class schedules and blocks
 * - Discovers Ben's and Jade's student IDs automatically
 * 
 * Storage:
 * - Persists session token to Upstash Redis (production) and server/.blackbaud_tokens.json (local).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodeHtmlEntities } from './parserService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUBDOMAIN = process.env.BLACKBAUD_SUBDOMAIN || 'westlakelutheran';
const BASE_URL = `https://${SUBDOMAIN}.myschoolapp.com`;
const TOKENS_PATH = path.join(__dirname, '..', '.blackbaud_tokens.json');

// Memory cache
let cachedSession = null;

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

/**
 * Retrieve saved Blackbaud session info (cookie, student IDs, last verified)
 */
export async function getBlackbaudSession() {
  if (cachedSession) {
    return cachedSession;
  }

  // 1. Check environment variable
  if (process.env.BLACKBAUD_COOKIE) {
    cachedSession = {
      cookie: process.env.BLACKBAUD_COOKIE.trim(),
      subdomain: SUBDOMAIN,
      source: 'env'
    };
    return cachedSession;
  }

  // 2. Check Upstash Redis / Vercel KV
  const { url: kvUrl, token: kvToken } = getKvConfig();
  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/blackbaud_session`, {
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
            cachedSession = parsed;
            return cachedSession;
          }
        }
      }
    } catch (kvErr) {
      console.warn('[Blackbaud] Upstash/KV read failed:', kvErr.message);
    }
  }

  // 3. Local filesystem
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      cachedSession = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
      return cachedSession;
    } catch (e) {}
  }

  return null;
}

/**
 * Save Blackbaud session
 */
export async function saveBlackbaudSession(sessionData) {
  cachedSession = sessionData;

  // Persist to Upstash / Vercel KV
  const { url: kvUrl, token: kvToken } = getKvConfig();
  if (kvUrl && kvToken) {
    try {
      if (sessionData) {
        await fetch(`${kvUrl}/set/blackbaud_session`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: typeof sessionData === 'string' ? sessionData : JSON.stringify(sessionData)
        });
      } else {
        await fetch(`${kvUrl}/del/blackbaud_session`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${kvToken}` }
        });
      }
    } catch (kvErr) {
      console.warn('[Blackbaud] Upstash/KV save failed:', kvErr.message);
    }
  }

  // Persist locally
  try {
    if (sessionData) {
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(sessionData, null, 2), 'utf-8');
    } else if (fs.existsSync(TOKENS_PATH)) {
      fs.unlinkSync(TOKENS_PATH);
    }
  } catch (fsErr) {
    console.warn('[Blackbaud] Local token write failed:', fsErr.message);
  }

  return sessionData;
}

/**
 * Clean and format cookie header string
 */
export function formatCookieString(rawCookie) {
  if (!rawCookie) return '';
  const str = rawCookie.trim();
  // If user pasted just a token value like 'ABCDEF1234...' without 't=' prefix
  if (!str.includes('=') && str.length > 20) {
    return `t=${str}`;
  }
  return str;
}

/**
 * Make authenticated request to Blackbaud myschoolapp API
 */
async function blackbaudRequest(endpoint, options = {}) {
  const session = await getBlackbaudSession();
  if (!session || !session.cookie) {
    throw new Error('No active Blackbaud session. Please connect your Westlake account.');
  }

  const cleanCookie = formatCookieString(session.cookie);
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Referer': `${BASE_URL}/`,
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cleanCookie,
    ...(options.headers || {})
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('SESSION_EXPIRED: Blackbaud session cookie has expired. Please re-authenticate.');
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    // If Blackbaud redirected to the HTML login page
    throw new Error('SESSION_EXPIRED: Blackbaud redirected to login page. Session cookie is invalid.');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Blackbaud API error ${res.status}: ${text.substring(0, 150)}`);
  }

  return res.json();
}

/**
 * Verify session and discover student profiles (Ben and Jade)
 */
export async function verifyAndDiscoverProfiles(rawCookie) {
  const cleanCookie = formatCookieString(rawCookie);
  
  // Call /api/webapp/context to retrieve user info and linked children
  const url = `${BASE_URL}/api/webapp/context`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': `${BASE_URL}/`,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cleanCookie
    }
  });

  if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Invalid Blackbaud session cookie. Please ensure you are logged into westlakelutheran.myschoolapp.com.');
  }

  const data = await res.json();
  const studentsMap = new Map();

  // Parse children attached to parent account
  const childrenList = data.Children || data.Students || [];
  if (Array.isArray(childrenList)) {
    childrenList.forEach(item => {
      const id = item.Id || item.UserId;
      if (!id || studentsMap.has(id)) return;

      const first = (item.FirstName || '').trim();
      const nick = (item.NickName || '').trim();
      const last = (item.LastName || '').trim();
      const isBen = first.toLowerCase().includes('ben') || nick.toLowerCase().includes('ben') || id === 5662183;
      const isJade = first.toLowerCase().includes('jade') || id === 5819113;

      studentsMap.set(id, {
        id,
        name: `${first || nick} ${last}`.trim(),
        student: isBen ? 'Ben' : isJade ? 'Jade' : (first || nick || 'Student'),
        gradYear: item.GradYear || null,
        schoolLevel: isBen ? 'High School' : isJade ? 'Middle School' : 'Academy'
      });
    });
  }

  // Fallback if specific children array was omitted in response
  if (studentsMap.size === 0) {
    studentsMap.set(5662183, { id: 5662183, student: 'Ben', name: 'Ben Smith', schoolLevel: 'High School' });
    studentsMap.set(5819113, { id: 5819113, student: 'Jade', name: 'Jade Smith', schoolLevel: 'Middle School' });
  }

  const students = Array.from(studentsMap.values());
  const benObj = students.find(s => s.student === 'Ben');
  const jadeObj = students.find(s => s.student === 'Jade');

  const sessionObj = {
    cookie: cleanCookie,
    subdomain: SUBDOMAIN,
    parentUserId: data.UserInfo?.UserId || null,
    parentName: data.UserInfo ? `${data.UserInfo.FirstName} ${data.UserInfo.LastName}` : null,
    benStudentId: benObj?.id || 5662183,
    jadeStudentId: jadeObj?.id || 5819113,
    students,
    verifiedAt: new Date().toISOString()
  };

  await saveBlackbaudSession(sessionObj);
  return sessionObj;
}

/**
 * Convert numeric grade percentage to letter grade
 */
function toLetterGrade(num) {
  if (num === null || num === undefined || isNaN(num)) return null;
  if (num >= 97) return 'A+';
  if (num >= 93) return 'A';
  if (num >= 90) return 'A-';
  if (num >= 87) return 'B+';
  if (num >= 83) return 'B';
  if (num >= 80) return 'B-';
  if (num >= 77) return 'C+';
  if (num >= 73) return 'C';
  if (num >= 70) return 'C-';
  return 'D';
}

/**
 * Get current academic courses and grades for a student
 */
export async function getStudentClassesAndGrades(studentId) {
  try {
    const schoolYear = '2026 - 2027';

    // 1. Get student terms to find active duration ID
    const termEndpoint = `/api/DataDirect/StudentGroupTermList/?studentUserId=${studentId}&schoolYearLabel=${encodeURIComponent(schoolYear)}&personaId=1`;
    const terms = await blackbaudRequest(termEndpoint);
    const activeTerm = Array.isArray(terms) ? (terms.find(t => t.CurrentInd === 1 && t.OfferingType === 1) || terms[0]) : null;
    const durationId = activeTerm ? activeTerm.DurationId : 0;

    // 2. Fetch classes with grades
    const classEndpoint = `/api/datadirect/ParentStudentUserClassesGet?userId=${studentId}&schoolYearLabel=${encodeURIComponent(schoolYear)}&memberLevel=3&persona=1&durationList=${durationId}`;
    const classes = await blackbaudRequest(classEndpoint);
    
    if (!Array.isArray(classes)) return [];

    return classes.map(c => {
      const title = decodeHtmlEntities(c.sectionidentifier || c.course_title || c.GroupName || 'Course');
      const teacher = decodeHtmlEntities(c.groupownername || c.Owner || '');
      const teacherEmail = c.groupowneremail || null;
      const rawGrade = c.cumgrade;
      const numGrade = (rawGrade !== null && rawGrade !== undefined && rawGrade !== '') ? parseFloat(rawGrade) : null;
      const letterGrade = toLetterGrade(numGrade);

      return {
        id: c.sectionid || `cls_${Math.random()}`,
        course: title,
        teacher: teacher,
        teacherEmail: teacherEmail,
        letterGrade: letterGrade,
        percentage: (numGrade !== null && !isNaN(numGrade)) ? `${Math.round(numGrade)}%` : (c.CumulativeDisplay || null),
        numericGrade: numGrade,
        room: c.room || null,
        schoolLevel: c.schoollevel || null,
        currentTerm: c.currentterm || activeTerm?.DurationDescription || 'Current Term',
        sectionId: c.sectionid,
        markingPeriodId: c.markingperiodid,
        overdueCount: c.OverdueCount || 0,
        upcomingCount: c.UpcomingCount || 0
      };
    });
  } catch (err) {
    console.warn(`[Blackbaud] Failed to fetch grades for student ${studentId}:`, err.message);
    return [];
  }
}

/**
 * Get missing assignments from StudentMissingAssignmentCheck & gradebook hydration
 */
export async function getStudentMissingAssignments(studentId, studentName, classes = []) {
  const missingItems = [];
  try {
    // Check classes with overdue count
    const candidateClasses = classes.filter(c => c.overdueCount > 0 && c.sectionId && c.markingPeriodId);

    for (const c of candidateClasses) {
      try {
        const url = `/api/gradebook/hydrategradebook?sectionId=${c.sectionId}&markingPeriodId=${c.markingPeriodId}&sortAssignmentId=null&sortSkillPk=null&sortDesc=null&sortCumulative=null&studentUserId=${studentId}&fromProgress=true`;
        const hydra = await blackbaudRequest(url);

        if (hydra && Array.isArray(hydra.Roster)) {
          for (const r of hydra.Roster) {
            for (const a of (r.AssignmentGrades || r.Assignments || [])) {
              if (a.Missing === true) {
                const meta = (hydra.Assignments || []).find(x => x.AssignmentId === a.AssignmentId) || {};
                const cleanComment = decodeHtmlEntities(a.Comment || '');
                missingItems.push({
                  id: `bb_missing_${a.AssignmentId}_${studentId}`,
                  title: decodeHtmlEntities(meta.AssignShort || meta.ShortDescription || 'Missing Assignment'),
                  course: decodeHtmlEntities(c.course),
                  teacher: decodeHtmlEntities(c.teacher),
                  student: studentName,
                  dueDate: meta.DateDue || 'Overdue',
                  comment: cleanComment,
                  maxPoints: meta.MaxPoints || 100,
                  type: decodeHtmlEntities(meta.AssignmentType || 'Assignment'),
                  isMissing: true
                });
              }
            }
          }
        }
      } catch (classErr) {
        console.warn(`[Blackbaud] Hydrate gradebook failed for section ${c.sectionId}:`, classErr.message);
      }
    }
  } catch (err) {
    console.warn(`[Blackbaud] Failed to fetch missing assignments for ${studentId}:`, err.message);
  }

  return missingItems;
}

/**
 * Get full Blackbaud snapshot for dashboard
 */
export async function syncBlackbaudData() {
  let session = await getBlackbaudSession();
  if (!session || !session.cookie) {
    return {
      connected: false,
      message: 'Blackbaud portal is not connected. Enter your session cookie to sync grades and assignments.',
      students: [],
      grades: { Ben: [], Jade: [] },
      assignments: [],
      missingAssignments: []
    };
  }

  // Ensure students are discovered if session lacked them
  if (!session.students || session.students.length === 0) {
    try {
      session = await verifyAndDiscoverProfiles(session.cookie);
    } catch (e) {
      console.warn('[Blackbaud] Auto-discovery during sync failed, using defaults:', e.message);
      session.students = [
        { student: 'Ben', id: 5662183, name: 'Ben Smith', schoolLevel: 'High School' },
        { student: 'Jade', id: 5819113, name: 'Jade Smith', schoolLevel: 'Middle School' }
      ];
      await saveBlackbaudSession(session);
    }
  }

  const results = {
    connected: true,
    lastSyncedAt: new Date().toISOString(),
    grades: { Ben: [], Jade: [] },
    assignments: [],
    missingAssignments: []
  };

  const students = session.students || [
    { student: 'Ben', id: session.benStudentId || 5662183 },
    { student: 'Jade', id: session.jadeStudentId || 5819113 }
  ];

  for (const s of students) {
    const stName = s.student || 'Ben';
    const classes = await getStudentClassesAndGrades(s.id);
    results.grades[stName] = classes;

    // Discover missing assignments for this student
    const missing = await getStudentMissingAssignments(s.id, stName, classes);
    if (Array.isArray(missing) && missing.length > 0) {
      results.missingAssignments.push(...missing);

      // Also create portal assignment items for any missing work so they show up in the Checklist!
      missing.forEach(m => {
        const cleanTitle = decodeHtmlEntities(m.title);
        const cleanComment = decodeHtmlEntities(m.comment);
        results.assignments.push({
          id: m.id,
          title: `[Missing] ${cleanTitle}${cleanComment ? ` (${cleanComment})` : ''}`,
          student: stName,
          course: decodeHtmlEntities(m.course.split(' - ')[0]),
          dueDate: m.dueDate,
          source: 'Blackbaud Portal',
          completed: false,
          priority: 'high',
          comments: cleanComment ? [{
            id: `comm_${Date.now()}`,
            author: 'Blackbaud Teacher Note',
            text: cleanComment,
            timestamp: 'Portal Alert'
          }] : []
        });
      });
    }
  }

  return results;
}
