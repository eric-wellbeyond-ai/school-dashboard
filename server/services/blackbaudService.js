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
import { currentWlaSession } from './wlaContext.js';
import { identifyUser, BEN_ID, JADE_ID } from './sessionStore.js';

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
  const live = currentWlaSession();
  if (live?.cookie) return live;
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
  const session = options.session || await getBlackbaudSession();
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
 * Map a Blackbaud user/child record onto Ben / Jade / first name.
 */
export function labelStudent(item = {}) {
  const id = item.id || item.Id || item.UserId;
  const first = String(item.FirstName || item.first || '').trim();
  const nick = String(item.NickName || item.nick || '').trim();
  if (id === 5662183 || /ben/i.test(first) || /ben/i.test(nick)) return 'Ben';
  if (id === 5819113 || /jade/i.test(first) || /jade/i.test(nick)) return 'Jade';
  return first || nick || 'Student';
}

/**
 * Parent sessions expose Children[]; student sessions are UserInfo only.
 */
export function studentsFromContext(data = {}) {
  const studentsMap = new Map();
  const childrenList = data.Children || data.Students || [];
  if (Array.isArray(childrenList)) {
    childrenList.forEach((item) => {
      const id = item.Id || item.UserId;
      if (!id || id < 1 || studentsMap.has(id)) return;
      const first = (item.FirstName || '').trim();
      const nick = (item.NickName || '').trim();
      const last = (item.LastName || '').trim();
      const student = labelStudent(item);
      studentsMap.set(id, {
        id,
        name: `${first || nick} ${last}`.trim(),
        student,
        gradYear: item.GradYear || null,
        schoolLevel: student === 'Ben' ? 'High School' : student === 'Jade' ? 'Middle School' : 'Academy'
      });
    });
  }

  const ui = data.UserInfo || {};
  const userId = ui.UserId || ui.Id;
  if (studentsMap.size === 0 && userId && userId > 0) {
    const student = labelStudent(ui);
    studentsMap.set(userId, {
      id: userId,
      name: `${ui.FirstName || ''} ${ui.LastName || ''}`.trim(),
      student,
      schoolLevel: student === 'Ben' ? 'High School' : student === 'Jade' ? 'Middle School' : 'Academy'
    });
  }

  return Array.from(studentsMap.values());
}

export function accountFromContext(data = {}, status = {}, homeUrl = '') {
  const ui = data.UserInfo || {};
  const children = Array.isArray(data.Children) ? data.Children : [];
  const personas = Array.isArray(data.Personas) ? data.Personas : [];
  const url = String(homeUrl || '').toLowerCase();
  const personaNames = personas.map((p) => String(p.Name || p.description || p.Id || '')).join(' ');

  let role = 'parent';
  if (url.includes('/app/student')) role = 'student';
  else if (url.includes('/app/parent')) role = 'parent';
  else if (children.length > 0) role = 'parent';
  else if (/student/i.test(personaNames) && !/parent/i.test(personaNames)) role = 'student';
  else if (children.length === 0 && (ui.UserId || status.UserId)) role = 'student';

  const personaId = role === 'student' ? 2 : 1;
  const accountName = `${ui.FirstName || ''} ${ui.LastName || ''}`.trim()
    || status.FirstName
    || null;

  return {
    role,
    personaId,
    userId: ui.UserId || status.UserId || null,
    accountName,
    parentName: role === 'parent' ? accountName : null
  };
}

/**
 * Verify session and discover parent or student profiles
 */
export async function verifyAndDiscoverProfiles(rawCookie, options = {}) {
  const cleanCookie = formatCookieString(rawCookie);
  const homeUrl = options.homeUrl || '';

  const statusRes = await fetch(`${BASE_URL}/api/webapp/userstatus`, {
    headers: {
      'Accept': 'application/json',
      'Referer': `${BASE_URL}/`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Cookie': cleanCookie
    }
  });
  if (!statusRes.ok || (statusRes.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Invalid Blackbaud session cookie. Please ensure you are logged into westlakelutheran.myschoolapp.com.');
  }
  const status = await statusRes.json();
  if (status.TokenValid === false || !(status.UserId > 0)) {
    throw new Error('Blackbaud session token t is not valid. Stay on the signed-in portal tab and use the bookmarklet again.');
  }

  const url = `${BASE_URL}/api/webapp/context`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': `${BASE_URL}/`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Cookie': cleanCookie
    }
  });

  if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Invalid Blackbaud session cookie. Please ensure you are logged into westlakelutheran.myschoolapp.com.');
  }

  const data = await res.json();
  const students = studentsFromContext(data);
  if (!students.length) {
    throw new Error('Logged in, but no student or parent profile was found on this session.');
  }

  const account = accountFromContext(data, status, homeUrl);
  const benObj = students.find(s => s.student === 'Ben');
  const jadeObj = students.find(s => s.student === 'Jade');

  const sessionObj = {
    cookie: cleanCookie,
    subdomain: SUBDOMAIN,
    source: 'cookie',
    role: account.role,
    personaId: account.personaId,
    userId: account.userId,
    accountName: account.accountName,
    parentUserId: account.role === 'parent' ? account.userId : null,
    parentName: account.parentName,
    homeUrl: homeUrl || null,
    benStudentId: benObj?.id || null,
    jadeStudentId: jadeObj?.id || null,
    students,
    verifiedAt: new Date().toISOString()
  };

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
export async function getStudentClassesAndGrades(studentId, personaId = 1) {
  const schoolYear = '2026 - 2027';
  const personas = personaId === 2 ? [2, 1] : [1, 2];

  try {
    for (const persona of personas) {
      const termEndpoint = `/api/DataDirect/StudentGroupTermList/?studentUserId=${studentId}&schoolYearLabel=${encodeURIComponent(schoolYear)}&personaId=${persona}`;
      const terms = await blackbaudRequest(termEndpoint);
      const activeTerm = Array.isArray(terms) ? (terms.find(t => t.CurrentInd === 1 && t.OfferingType === 1) || terms[0]) : null;
      const durationId = activeTerm ? activeTerm.DurationId : 0;

      const classEndpoint = `/api/datadirect/ParentStudentUserClassesGet?userId=${studentId}&schoolYearLabel=${encodeURIComponent(schoolYear)}&memberLevel=3&persona=${persona}&durationList=${durationId}`;
      const classes = await blackbaudRequest(classEndpoint);
      if (!Array.isArray(classes) || classes.length === 0) continue;

      return classes.map((c) => {
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
    }
    return [];
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
  if (!session || (!session.cookie && session.source !== 'bookmarklet')) {
    return {
      connected: false,
      message: 'Blackbaud portal is not connected. Enter your session cookie to sync grades and assignments.',
      students: [],
      grades: null,
      assignments: [],
      missingAssignments: []
    };
  }

  if (!session.cookie && session.source === 'bookmarklet') {
    return {
      connected: true,
      message: 'Re-run the bookmarklet from a signed-in Westlake tab to refresh grades.',
      students: session.students || [],
      grades: null,
      assignments: [],
      missingAssignments: []
    };
  }

  if (!session.students || session.students.length === 0) {
    try {
      session = await verifyAndDiscoverProfiles(session.cookie);
    } catch (e) {
      console.warn('[Blackbaud] Auto-discovery during sync failed:', e.message);
      return {
        connected: false,
        message: e.message,
        students: [],
        grades: null,
        assignments: [],
        missingAssignments: []
      };
    }
  }

  const identity = session.userKey ? session : identifyUser(session);
  let students = session.students || [];
  if (identity.userKey === 'eric' || identity.userKey === 'stefani') {
    const byId = new Map(students.map((s) => [s.id, s]));
    if (!byId.has(BEN_ID)) students = [...students, { id: BEN_ID, student: 'Ben', name: 'Ben' }];
    if (!byId.has(JADE_ID)) students = [...students, { id: JADE_ID, student: 'Jade', name: 'Jade' }];
  }
  const allowedIds = new Set(identity.allowedStudentIds || students.map((s) => s.id));
  students = students.filter((s) => allowedIds.has(s.id));

  const results = {
    connected: true,
    lastSyncedAt: new Date().toISOString(),
    students,
    role: identity.role,
    userKey: identity.userKey,
    displayName: identity.displayName,
    accountName: identity.accountName || session.accountName,
    allowedStudentKeys: identity.allowedStudentKeys,
    grades: {},
    assignments: [],
    missingAssignments: []
  };

  for (const s of students) {
    const stName = s.student || 'Ben';
    const classes = await getStudentClassesAndGrades(
      s.id,
      session.personaId || (identity.role === 'student' ? 2 : 1)
    );
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

  const gradeCount = Object.values(results.grades).reduce(
    (n, rows) => n + (Array.isArray(rows) ? rows.length : 0),
    0
  );
  if (gradeCount === 0) {
    results.grades = null;
    results.message = 'Could not read course grades with this session.';
  }

  return results;
}
