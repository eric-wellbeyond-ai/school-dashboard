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
import {
  parsePortalDate,
  toDateKey,
  classifyAssignment,
  formatAssignmentDate,
  isAssignmentGraded
} from '../../src/lib/assignmentBuckets.js';
import { assignmentPercent } from '../../src/lib/gradeColors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUBDOMAIN = process.env.BLACKBAUD_SUBDOMAIN || 'westlakelutheran';
const BASE_URL = `https://${SUBDOMAIN}.myschoolapp.com`;
const CDN_HOST = 'https://bbk12e1-cdn.myschoolcdn.com';
const SCHOOL_FTP_PREFIX = '/ftpimages/2274/user';
const TOKENS_PATH = path.join(__dirname, '..', '.blackbaud_tokens.json');
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

function isAllowedPhotoHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'myschoolapp.com'
    || host.endsWith('.myschoolapp.com')
    || host === 'myschoolcdn.com'
    || host.endsWith('.myschoolcdn.com');
}

export function isAllowedPhotoUrl(raw, base = BASE_URL) {
  if (!raw) return false;
  try {
    const u = new URL(String(raw), base);
    return (u.protocol === 'https:' || u.protocol === 'http:') && isAllowedPhotoHost(u.hostname);
  } catch {
    return false;
  }
}

export function toCdnPhotoUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    return isAllowedPhotoUrl(raw) ? raw : null;
  }
  if (/FileAccess\.aspx/i.test(raw) || raw.startsWith('/podium/')) {
    const abs = raw.startsWith('http') ? raw : `${BASE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`;
    return isAllowedPhotoUrl(abs) ? abs : null;
  }
  if (raw.startsWith('/ftpimages/')) return `${CDN_HOST}${raw}`;
  if (raw.startsWith('/')) return `${CDN_HOST}${raw}`;
  return `${CDN_HOST}${SCHOOL_FTP_PREFIX}/${raw.replace(/^\/+/, '')}`;
}

export function dashboardPhotoSrc(absUrl) {
  if (!absUrl) return null;
  try {
    const u = new URL(absUrl, BASE_URL);
    if (!isAllowedPhotoHost(u.hostname)) return null;
    if (/fileaccess/i.test(u.pathname) || /profilephoto/i.test(u.pathname)) {
      return `/api/blackbaud/photo?url=${encodeURIComponent(u.href)}`;
    }
    return u.href;
  } catch {
    return absUrl;
  }
}

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

export function isSessionExpiredError(err) {
  const msg = String(err?.message || '');
  return /SESSION_EXPIRED|session cookie has expired|token t is not valid|Invalid Blackbaud session|redirected to login/i.test(msg);
}

export function sessionExpiredPayload(message) {
  return {
    connected: false,
    needsReauth: true,
    message: message || 'Blackbaud session expired. Sign in again with Log in with Blackbaud.',
    students: [],
    grades: null,
    assignments: [],
    missingAssignments: []
  };
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
        photoUrl: profilePhotoUrl(item),
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
      photoUrl: profilePhotoUrl(ui),
      schoolLevel: student === 'Ben' ? 'High School' : student === 'Jade' ? 'Middle School' : 'Academy'
    });
  }

  return Array.from(studentsMap.values());
}

export function profilePhotoUrl(ui = {}) {
  const photo = ui.ProfilePhoto || ui.profilePhoto || {};
  const candidates = [
    photo.ThumbFilenameUrl,
    photo.ThumbFilenameEditedUrl,
    photo.LargeFilenameUrl,
    photo.LargeFilenameEditedUrl,
    photo.ThumbFilename,
    photo.LargeFilename,
    ui.ThumbFilenameUrl,
    ui.LargeFilenameUrl,
    ui.PhotoUrl,
    ui.LargePhotoUrl,
    ui.ProfilePicture,
    ui.photoUrl,
    ui.ThumbFilename,
    ui.LargeFilename,
    ui.groupownerphoto,
    ui.ProfilePhotoFile?.Attachment
  ];
  for (const candidate of candidates) {
    const abs = toCdnPhotoUrl(candidate);
    if (abs) return dashboardPhotoSrc(abs);
  }
  return null;
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
  const firstName = (ui.FirstName || '').trim() || null;
  const lastName = (ui.LastName || '').trim() || null;
  const nickName = (ui.NickName || '').trim() || null;
  const accountName = `${firstName || ''} ${lastName || ''}`.trim()
    || status.FirstName
    || null;

  return {
    role,
    personaId,
    userId: ui.UserId || status.UserId || null,
    firstName,
    lastName,
    nickName,
    email: ui.Email || null,
    photoUrl: profilePhotoUrl(ui),
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
    firstName: account.firstName,
    lastName: account.lastName,
    nickName: account.nickName,
    email: account.email,
    photoUrl: account.photoUrl,
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

      const mapped = classes.map((c) => {
        const title = decodeHtmlEntities(c.sectionidentifier || c.course_title || c.GroupName || 'Course');
        const teacher = decodeHtmlEntities(c.groupownername || c.Owner || '');
        const teacherEmail = c.groupowneremail || null;
        const teacherUserId = c.groupownerid || c.OwnerId || c.ownerid || null;
        const teacherPhoto = profilePhotoUrl(c);
        const rawGrade = c.cumgrade;
        const numGrade = (rawGrade !== null && rawGrade !== undefined && rawGrade !== '') ? parseFloat(rawGrade) : null;
        const letterGrade = toLetterGrade(numGrade);

        const photoRel = c.photofilenameurl || c.ThumbFilenameUrl || c.largefilenameurl || c.CoursePhoto || null;
        return {
          id: c.sectionid || `cls_${Math.random()}`,
          course: title,
          teacher: teacher,
          teacherEmail: teacherEmail,
          teacherUserId,
          teacherPhoto,
          teacherImage: teacherPhoto,
          letterGrade: letterGrade,
          percentage: (numGrade !== null && !isNaN(numGrade)) ? `${Math.round(numGrade)}%` : (c.CumulativeDisplay || null),
          numericGrade: numGrade,
          room: c.room || null,
          schoolLevel: c.schoollevel || null,
          currentTerm: c.currentterm || activeTerm?.DurationDescription || 'Current Term',
          sectionId: c.sectionid,
          leadSectionId: c.leadsectionid || c.LeadSectionId || c.sectionid,
          associationId: c.associationid || c.AssociationId || null,
          markingPeriodId: c.markingperiodid,
          coursePhoto: photoRel ? toCdnPhotoUrl(photoRel) : null,
          overdueCount: c.OverdueCount || 0,
          upcomingCount: c.UpcomingCount || 0
        };
      });
      const missingIds = [...new Set(
        mapped.filter((c) => !c.teacherPhoto && c.teacherUserId).map((c) => c.teacherUserId)
      )];
      if (missingIds.length) {
        const extra = await hydrateTeacherPhotos(missingIds);
        for (const course of mapped) {
          if (course.teacherPhoto || !course.teacherUserId) continue;
          const photo = extra.get(Number(course.teacherUserId)) || extra.get(course.teacherUserId) || null;
          if (photo) {
            course.teacherPhoto = photo;
            course.teacherImage = photo;
          }
        }
      }
      return mapped;
    }
    return [];
  } catch (err) {
    if (isSessionExpiredError(err)) throw err;
    console.warn(`[Blackbaud] Failed to fetch grades for student ${studentId}:`, err.message);
    return [];
  }
}

function shortCourseName(title) {
  const clean = decodeHtmlEntities(title || '');
  return clean.split(' - ')[0].trim() || clean;
}

function mapHydrateAssignment(meta, grade, course, studentId, studentName, now) {
  const assignedAt = parsePortalDate(meta.SortDateAssigned || meta.DateAssigned);
  const dueAt = parsePortalDate(meta.SortDateDue || meta.DateDue);
  const title = decodeHtmlEntities(meta.AssignShort || meta.AbbrDescription || meta.ShortDescription || 'Assignment');
  const comment = decodeHtmlEntities(grade.Comment || '');
  const pointsRaw = grade.PointsEarned ?? grade.pointsEarned;
  const points = (typeof pointsRaw === 'number' && !Number.isNaN(pointsRaw))
    ? pointsRaw
    : (Number.isFinite(Number(pointsRaw)) && String(pointsRaw).trim() !== '' ? Number(pointsRaw) : null);
  const maxPoints = meta.MaxPoints || grade.MaxPoints || null;
  const percent = assignmentPercent(points, maxPoints);
  const graded = isAssignmentGraded({
    ...grade,
    pointsEarned: points,
    maxPoints,
    letter: grade.Letter || grade.letter
  });
  const status = classifyAssignment({ assignedAt, dueAt, done: graded, graded, now });
  return {
    id: `bb_${meta.AssignmentId || grade.AssignmentId}_${studentId}`,
    assignmentId: meta.AssignmentId || grade.AssignmentId,
    title,
    course: shortCourseName(course.course),
    courseId: course.id || course.sectionId,
    sectionId: course.sectionId,
    teacher: decodeHtmlEntities(course.teacher || ''),
    teacherEmail: course.teacherEmail || null,
    teacherPhoto: course.teacherPhoto || course.teacherImage || null,
    student: studentName,
    studentPhoto: course.studentPhoto || null,
    type: decodeHtmlEntities(meta.AssignmentType || grade.AssignmentType || 'Assignment'),
    assignedDate: assignedAt ? formatAssignmentDate(assignedAt) : '',
    dueDate: dueAt ? formatAssignmentDate(dueAt) : '',
    assignedDateISO: toDateKey(assignedAt),
    dueDateISO: toDateKey(dueAt),
    status,
    done: graded,
    completed: graded,
    graded,
    isMissing: grade.Missing === true,
    late: grade.Late === true,
    incomplete: grade.Incomplete === true,
    exempt: grade.Exempt === true,
    dropped: grade.Dropped === true,
    pointsEarned: points,
    maxPoints,
    percent,
    percentage: percent,
    comment,
    source: 'Blackbaud',
    priority: status === 'overdue' ? 'high' : status === 'dueSoon' ? 'medium' : 'low'
  };
}

/**
 * Full assignment list from each published gradebook (parent Assignment2 APIs 403).
 */
export async function getStudentAssignments(studentId, studentName, classes = []) {
  const now = new Date();
  const candidateClasses = classes.filter((c) => c.sectionId && c.markingPeriodId);
  const batches = await Promise.all(candidateClasses.map(async (course) => {
    try {
      const url = `/api/gradebook/hydrategradebook?sectionId=${course.sectionId}&markingPeriodId=${course.markingPeriodId}&sortAssignmentId=null&sortSkillPk=null&sortDesc=null&sortCumulative=null&studentUserId=${studentId}&fromProgress=true`;
      const hydra = await blackbaudRequest(url);
      const roster = (hydra.Roster || []).find((r) => r.StudentUserId === studentId)
        || (hydra.Roster || [])[0];
      const gradesById = new Map((roster?.AssignmentGrades || []).map((g) => [g.AssignmentId, g]));
      return (hydra.Assignments || []).map((meta) => {
        const grade = gradesById.get(meta.AssignmentId) || {};
        if (grade.Dropped === true) return null;
        return mapHydrateAssignment(meta, grade, course, studentId, studentName, now);
      }).filter(Boolean);
    } catch (classErr) {
      if (isSessionExpiredError(classErr)) throw classErr;
      console.warn(`[Blackbaud] Hydrate gradebook failed for section ${course.sectionId}:`, classErr.message);
      return [];
    }
  }));
  return batches.flat();
}

export async function getAssignmentDetail(assignmentId) {
  const data = await blackbaudRequest(`/api/assignment2/read/${encodeURIComponent(assignmentId)}/?format=json`);
  const link = Array.isArray(data.SectionLinks) ? data.SectionLinks[0] : {};
  return {
    assignmentId: data.AssignmentId,
    longDescription: decodeHtmlEntities(data.LongDescription || ''),
    shortDescription: decodeHtmlEntities(data.ShortDescription || ''),
    type: decodeHtmlEntities(data.AssignmentType || ''),
    maxPoints: data.MaxPoints ?? null,
    dropbox: Boolean(data.DropboxInd),
    onPaper: Boolean(data.OnPaperSubmission),
    assignedDateRaw: link.AssignmentDate || data.DefaultDateAssigned || null,
    dueDateRaw: link.DueDate || data.DefaultDateDue || null
  };
}

export async function getStudentMissingAssignments(studentId, studentName, classes = []) {
  const items = await getStudentAssignments(studentId, studentName, classes);
  return items.filter((a) => a.isMissing);
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

  try {
    const ctx = await blackbaudRequest('/api/webapp/context');
    const account = accountFromContext(ctx, {}, session.homeUrl);
    session.firstName = account.firstName;
    session.lastName = account.lastName;
    session.nickName = account.nickName;
    session.email = account.email;
    session.photoUrl = account.photoUrl;
    if (account.accountName) session.accountName = account.accountName;
    const fromCtx = studentsFromContext(ctx);
    const photoById = new Map(fromCtx.map((s) => [Number(s.id), s.photoUrl]));
    students = students.map((s) => ({
      ...s,
      photoUrl: s.photoUrl || photoById.get(Number(s.id)) || null
    }));
    for (const s of fromCtx) {
      if (allowedIds.has(s.id) && !students.some((row) => Number(row.id) === Number(s.id))) {
        students.push(s);
      }
    }
  } catch (err) {
    console.warn('[Blackbaud] Profile refresh failed:', err.message);
  }

  const stillMissingPhotos = students.filter((s) => s.id && !s.photoUrl).map((s) => s.id);
  if (stillMissingPhotos.length) {
    const extra = await hydrateTeacherPhotos(stillMissingPhotos);
    students = students.map((s) => ({
      ...s,
      photoUrl: s.photoUrl || extra.get(Number(s.id)) || extra.get(s.id) || null
    }));
  }
  session.students = students;

  const results = {
    connected: true,
    lastSyncedAt: new Date().toISOString(),
    students,
    role: identity.role,
    userKey: identity.userKey,
    displayName: identity.displayName,
    accountName: identity.accountName || session.accountName,
    firstName: session.firstName || identity.firstName || null,
    lastName: session.lastName || identity.lastName || null,
    nickName: session.nickName || null,
    email: session.email || null,
    photoUrl: session.photoUrl || null,
    userId: session.userId || identity.userId || null,
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
    const withPhotos = classes.map((c) => ({
      ...c,
      studentPhoto: s.photoUrl || null
    }));
    results.grades[stName] = withPhotos;

    const items = await getStudentAssignments(s.id, stName, withPhotos);
    results.assignments.push(...items);
    results.missingAssignments.push(...items.filter((a) => a.isMissing));
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

async function blackbaudRequestSoft(endpoint, options = {}) {
  const session = options.session || await getBlackbaudSession();
  if (!session?.cookie) {
    return { ok: false, status: 401, forbidden: true, expired: true, data: null };
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

  let res;
  try {
    res = await fetch(url, { method: 'GET', headers });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  }

  if (res.status === 401) {
    return { ok: false, status: 401, expired: true, data: null };
  }
  if (res.status === 403) {
    return { ok: false, status: 403, forbidden: true, data: null };
  }

  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, forbidden: res.status === 403, data: null, html: contentType.includes('text/html') ? raw : null };
  }
  if (contentType.includes('application/json') || /^\s*[\[{]/.test(raw)) {
    try {
      return { ok: true, status: res.status, data: JSON.parse(raw) };
    } catch {
      /* fall through and try HTML posts */
    }
  }
  if (raw && (contentType.includes('text/html') || /bb-tile|bulletin|LongText|BriefDescription/i.test(raw))) {
    return { ok: true, status: res.status, data: null, html: raw };
  }
  return { ok: false, status: res.status, data: null };
}

function firstRecord(data) {
  if (Array.isArray(data)) return data[0] || null;
  if (data && typeof data === 'object') return data;
  return null;
}

const LIST_KEYS = [
  'Items', 'items', 'topics', 'Topics', 'posts', 'Posts',
  'bulletin', 'Bulletin', 'BulletinBoardContent', 'bulletinBoardContent',
  'content', 'Content', 'ContentList', 'value', 'data', 'results', 'Results',
  'Discussions', 'discussions', 'Discussion', 'threads', 'Threads',
  'messages', 'Messages', 'Entries', 'entries',
  'NewsItem', 'NewsItems', 'news', 'News',
  'MessageList', 'Conversation', 'Announcements', 'announcements'
];

const CONTENT_TYPE_TITLES = /^(News|Text|Links?|Announcement|Widget|Downloads?|Events?)$/i;
const FLAG_DESCRIPTION = /^(yes|no)$/i;

function looksLikeRecord(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  return Boolean(
    item.Headline || item.Title || item.Name || item.Subject
    || item.LongDescription || item.Description || item.Body || item.Message
    || item.ContentItemId || item.ContentId || item.DiscussionId || item.TopicID
    || item.ShortDescription || item.ContentName || item.Preview
  );
}

function asList(data) {
  if (data == null) return [];
  if (Array.isArray(data)) {
    if (data.length && Array.isArray(data[0])) return data.flatMap((entry) => asList(entry));
    return data.filter((item) => item != null);
  }
  if (typeof data !== 'object') return [];
  for (const key of LIST_KEYS) {
    if (Array.isArray(data[key]) && data[key].length) return asList(data[key]);
  }
  for (const val of Object.values(data)) {
    if (!Array.isArray(val) || val.length === 0) continue;
    const nested = asList(val);
    if (nested.some((item) => looksLikeRecord(item))) return nested;
  }
  if (looksLikeRecord(data)) return [data];
  return [];
}

function pickText(...values) {
  for (const value of values) {
    const text = decodeHtmlEntities(String(value || '').trim());
    if (text) return text;
  }
  return '';
}

function formatDisplayDate(value) {
  if (value == null || value === '') return null;
  const raw = String(value);
  const ms = raw.match(/\/Date\((-?\d+)/);
  const d = ms ? new Date(Number(ms[1])) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function itemDedupeKey(item) {
  return String(
    item.ContentItemId || item.ContentId || item.DiscussionId || item.TopicID
    || item.Id || item.Headline || item.Title || item.Name || ''
  );
}

async function collectLists(urls) {
  let forbidden = false;
  let expired = false;
  const items = [];
  const seen = new Set();
  for (const url of urls) {
    const result = await blackbaudRequestSoft(url);
    if (result.forbidden) forbidden = true;
    if (result.expired) expired = true;
    if (!result.ok || result.data == null) continue;
    for (const item of asList(result.data)) {
      const key = itemDedupeKey(item) || JSON.stringify(item).slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return { items, forbidden, expired, ok: items.length > 0 };
}

function normalizeBulletinItem(item, index) {
  const title = pickText(
    item.Headline,
    item.Name,
    item.Title,
    item.Subject,
    item.ShortDescription,
    item.BriefDescription,
    item.ContentName
  );
  const body = pickText(
    item.LongDescription,
    item.Description,
    item.LongText,
    item.Body,
    item.Message,
    item.HtmlContent,
    item.ContentBody,
    item.RichText,
    item.Comment,
    item.AlbumDescription,
    item.ShortDescription
  );
  return {
    id: item.ContentItemId || item.ContentId || item.Id || `bb_${index}`,
    title: title || (body ? 'Class post' : ''),
    body: body && body !== title ? body : (title ? '' : body),
    date: formatDisplayDate(item.PublishDate || item.CreateDate || item.Date || item.DatePosted),
    author: pickText(
      item.CreateName,
      item.Author,
      item.AuthorName,
      item.ModifyName,
      item.PostedBy,
      item.OwnerName,
      item.UserName
    ) || null,
    url: item.Url || null
  };
}

function normalizeTopic(item, index) {
  return {
    id: item.TopicID || item.TopicIndexID || item.Id || `topic_${index}`,
    title: pickText(item.Name, item.Title, item.TopicName) || 'Topic',
    description: pickText(item.Description, item.LongDescription, item.ShortDescription),
    publishDate: formatDisplayDate(item.PublishDate || item.Date),
    thumbUrl: item.ThumbFilename
      ? (String(item.ThumbFilename).startsWith('http')
        ? item.ThumbFilename
        : `https://bbk12e1-cdn.myschoolcdn.com${item.ThumbFilename}`)
      : null
  };
}

function normalizeDiscussion(item, index) {
  return {
    id: item.DiscussionId || item.ThreadId || item.Id || `disc_${index}`,
    title: pickText(item.Name, item.Title, item.Subject, item.Headline) || 'Discussion',
    description: pickText(item.Description, item.Preview, item.Body, item.Message, item.LatestPost, item.LastPost),
    author: pickText(item.Author, item.AuthorName, item.CreateName, item.UserName, item.PostedBy) || null,
    publishDate: formatDisplayDate(item.PublishDate || item.Date || item.CreateDate || item.LastPostDate)
  };
}

async function firstOk(urls) {
  let forbidden = false;
  let expired = false;
  for (const url of urls) {
    const result = await blackbaudRequestSoft(url);
    if (result.ok && result.data != null) {
      return { ...result, forbidden, expired };
    }
    if (result.forbidden) forbidden = true;
    if (result.expired) expired = true;
  }
  return { ok: false, data: null, forbidden, expired };
}

export async function fetchUserPhotoUrl(userId) {
  if (!userId) return null;
  const hit = await blackbaudRequestSoft(`/api/user/${encodeURIComponent(userId)}?format=json`);
  const rec = firstRecord(hit.data);
  return profilePhotoUrl(rec || {});
}

async function hydrateTeacherPhotos(userIds = []) {
  const map = new Map();
  await Promise.all(userIds.map(async (id) => {
    try {
      const url = await fetchUserPhotoUrl(id);
      if (url) map.set(Number(id), url);
    } catch (err) {
      console.warn(`[Blackbaud] Teacher photo hydrate failed for ${id}:`, err.message);
    }
  }));
  return map;
}

export async function fetchProfilePhoto(userId) {
  const session = await getBlackbaudSession();
  if (!session?.cookie || !userId) return null;
  const headers = {
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Referer': `${BASE_URL}/`,
    'Cookie': formatCookieString(session.cookie)
  };
  const cdnUrl = await fetchUserPhotoUrl(userId);
  const targets = [
    cdnUrl,
    `${BASE_URL}/api/user/profilephoto?userId=${encodeURIComponent(userId)}`
  ].filter(Boolean);
  for (const url of targets) {
    const img = await fetch(url, { headers, redirect: 'manual' });
    if (img.status >= 300 && img.status < 400) {
      const loc = img.headers.get('location');
      if (!loc) continue;
      const next = new URL(loc, url).href;
      if (!isAllowedPhotoUrl(next)) continue;
      const followed = await fetch(next, { headers });
      if (!followed.ok) continue;
      const contentType = followed.headers.get('content-type') || 'image/jpeg';
      if (contentType.includes('text/html')) continue;
      const buf = Buffer.from(await followed.arrayBuffer());
      if (!buf.length || buf.length > PHOTO_MAX_BYTES) continue;
      return { buf, contentType };
    }
    if (!img.ok) continue;
    const contentType = img.headers.get('content-type') || 'image/jpeg';
    if (contentType.includes('text/html')) continue;
    if (contentType.includes('application/json')) continue;
    const buf = Buffer.from(await img.arrayBuffer());
    if (!buf.length || buf.length > PHOTO_MAX_BYTES) continue;
    return { buf, contentType };
  }
  return null;
}

export async function fetchPhotoByUrl(rawUrl) {
  const session = await getBlackbaudSession();
  if (!session?.cookie || !rawUrl) return null;
  if (!isAllowedPhotoUrl(rawUrl)) return null;
  const headers = {
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Referer': `${BASE_URL}/`,
    'Cookie': formatCookieString(session.cookie)
  };

  let current = new URL(String(rawUrl), BASE_URL).href;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!isAllowedPhotoUrl(current)) return null;
    const res = await fetch(current, { headers, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (contentType.includes('text/html') || contentType.includes('application/json')) return null;
    if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > PHOTO_MAX_BYTES) return null;
    return { buf, contentType: contentType.startsWith('image/') ? contentType : 'image/jpeg' };
  }
  return null;
}

/**
 * Class bulletin, topics, and teacher contact. Parent assignment2/class APIs often 403.
 */
export async function getClassPage({ sectionId, leadSectionId, associationId, teacherUserId } = {}) {
  const sid = encodeURIComponent(sectionId);
  const infoHit = await firstOk([
    `/api/datadirect/SectionInfoView?format=json&sectionId=${sid}&associationId=${encodeURIComponent(associationId || 1)}`,
    `/api/datadirect/SectionInfoView?format=json&sectionId=${sid}&associationId=1`,
    `/api/datadirect/SectionInfoView?format=json&sectionId=${sid}&associationId=9`,
    `/api/datadirect/SectionInfoView?format=json&sectionId=${sid}`
  ]);
  const info = firstRecord(infoHit.data);
  const assoc = info?.AssociationId || associationId || 1;
  const lead = info?.LeadSectionId || leadSectionId || sectionId;
  const leadEnc = encodeURIComponent(lead);

  const [bulletinHit, topicsHit, discussionHit, assignmentHit, teacherHit] = await Promise.all([
    collectLists([
      `/api/datadirect/BulletinBoardContentGet?format=json&sectionId=${sid}&associationId=${assoc}&pendingInd=false`,
      `/api/datadirect/BulletinBoardContentGet?format=json&sectionId=${leadEnc}&associationId=${assoc}&pendingInd=false`,
      `/api/datadirect/BulletinBoardContentGet?format=json&sectionId=${sid}&associationId=1&pendingInd=false`,
      `/api/datadirect/BulletinBoardContentGet?format=json&sectionId=${sid}&associationId=9&pendingInd=false`,
      `/api/class/bulletinboard/${sid}`,
      `/api/class/bulletinboard/${leadEnc}`
    ]),
    collectLists([
      `/api/datadirect/sectiontopicsget/${leadEnc}?format=json&active=true&future=false&expired=false&sharedTopics=true`,
      `/api/datadirect/sectiontopicsget/${sid}?format=json&active=true&future=false&expired=false&sharedTopics=true`,
      `/api/datadirect/GroupPossibleTopicsGet?leadSectionId=${leadEnc}&durationId=${encodeURIComponent(info?.DurationId || 0)}&active=true&future=false&expired=false`,
      `/api/datadirect/GroupPossibleTopicsGet?leadSectionId=${sid}&durationId=0`
    ]),
    collectLists([
      `/api/discussion/discussionboardget/?format=json&sectionId=${sid}`,
      `/api/discussion/discussionboardget/?format=json&sectionId=${leadEnc}`,
      `/api/discussion/GetDiscussionBoard?format=json&sectionId=${sid}`,
      `/api/discussion/GetDiscussionBoard?format=json&sectionId=${leadEnc}`
    ]),
    firstOk([
      `/api/assignment2/forsection/${sid}/?format=json`
    ]),
    teacherUserId
      ? blackbaudRequestSoft(`/api/user/${encodeURIComponent(teacherUserId)}?format=json`)
      : Promise.resolve({ ok: false, data: null })
  ]);

  const bulletin = bulletinHit.items.map(normalizeBulletinItem).filter((item) => item.title || item.body);
  const discussions = discussionHit.items.map(normalizeDiscussion);
  if (info?.Description) {
    const intro = pickText(info.Description, info.CourseTopic);
    if (intro && !bulletin.some((item) => item.body === intro)) {
      bulletin.unshift({
        id: 'section-intro',
        title: 'Class overview',
        body: intro,
        date: formatDisplayDate(info.StartDate) || null,
        author: pickText(info.Teacher) || null,
        url: null
      });
    }
  }
  for (const thread of discussions) {
    if (!(thread.title || thread.description)) continue;
    if (bulletin.some((post) => post.id === thread.id || (post.title === thread.title && post.body === thread.description))) {
      continue;
    }
    bulletin.push({
      id: thread.id,
      title: thread.title,
      body: thread.description,
      date: thread.publishDate,
      author: thread.author,
      url: null
    });
  }

  const topics = topicsHit.items.map(normalizeTopic);
  if (discussions.length && !topics.length) {
    topics.push(...discussions.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      publishDate: d.publishDate,
      thumbUrl: null
    })));
  }

  const teacherUser = firstRecord(teacherHit.data) || {};
  const teacherName = pickText(
    `${teacherUser.FirstName || ''} ${teacherUser.LastName || ''}`.trim(),
    teacherUser.NickName
  );
  const teacherPhotoCdn = profilePhotoUrl(teacherUser);
  const teacherPhoto = teacherPhotoCdn || (teacherUserId ? `/api/blackbaud/profile-photo/${teacherUserId}` : null);

  return {
    sectionId: Number(sectionId) || sectionId,
    leadSectionId: lead,
    associationId: assoc,
    room: info?.Room || null,
    duration: info?.Duration || null,
    description: pickText(info?.Description) || null,
    teacher: {
      name: teacherName || null,
      email: teacherUser.Email || null,
      userId: teacherUser.UserId || teacherUserId || null,
      photoUrl: teacherPhoto
    },
    bulletin,
    topics,
    discussions,
    forbidden: {
      bulletin: Boolean((bulletinHit.forbidden || discussionHit.forbidden) && bulletin.length === 0),
      topics: Boolean(topicsHit.forbidden && topics.length === 0),
      assignments: Boolean(assignmentHit.forbidden)
    },
    expired: Boolean(infoHit.expired || bulletinHit.expired || topicsHit.expired),
    portalUrl: `${BASE_URL}/app/parent#academicclass/${sectionId}/bulletinboard`
  };
}
