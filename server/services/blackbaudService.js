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
 * - Portal cookie `t` lives only on the request's ALS `wlaContext` / HttpOnly `wla_session`.
 * - Never a process-global cachedSession or shared KV `blackbaud_session`.
 */

import { decodeHtmlEntities } from './parserService.js';
import { currentWlaSession } from './wlaContext.js';
import { identifyUser, BEN_ID, JADE_ID } from './sessionStore.js';
import {
  parsePortalDate,
  parseDueDate,
  toDateKey,
  classifyAssignment,
  formatAssignmentDate,
  isAssignmentGraded,
  isZeroCreditMissing,
  isPortalMissingFlag
} from '../../src/lib/assignmentBuckets.js';
import { assignmentPercent } from '../../src/lib/gradeColors.js';

const SUBDOMAIN = process.env.BLACKBAUD_SUBDOMAIN || 'westlakelutheran';
const BASE_URL = `https://${SUBDOMAIN}.myschoolapp.com`;
const CDN_HOST = 'https://bbk12e1-cdn.myschoolcdn.com';
const SCHOOL_FTP_PREFIX = '/ftpimages/2274/user';
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

export function isPlaceholderPhoto(url, extra = '') {
  const raw = String(url || '').trim();
  const hint = String(extra || '').trim();
  if (!raw || raw === '?' || raw === '#' || raw === 'undefined' || raw === 'null') return true;
  if (hint === '?' || hint === '??') return true;
  const hay = `${raw} ${hint}`.toLowerCase();
  if (/question[_\s-]?mark|no[_-]?photo|nophoto|no[_-]?image|placeholder|missing[_-]?image|unknown[_-]?user|default[_-]?user|large_user\.|small_user\.|ftpimages\/0\/|-2147483648/i.test(hay)) {
    return true;
  }
  try {
    const u = new URL(raw, BASE_URL);
    const file = decodeURIComponent((u.pathname.split('/').pop() || '').split('?')[0]);
    if (file === '?' || file === '.' || file === '') return true;
  } catch {
    return true;
  }
  return false;
}

export function dashboardPhotoSrc(absUrl) {
  if (!absUrl || isPlaceholderPhoto(absUrl)) return null;
  try {
    const u = new URL(absUrl, BASE_URL);
    if (!isAllowedPhotoHost(u.hostname)) return null;
    return `/api/blackbaud/photo?url=${encodeURIComponent(u.href)}`;
  } catch {
    return null;
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic)$/i;
const SKIP_TOPIC_CONTENT_IDS = new Set([405, 407, 408]);
const COVER_IMAGE_CONTENT_ID = 404;
const COVER_BRIEF_CONTENT_ID = 406;

export function proxiedPhotoSrc(absUrl) {
  if (!absUrl || isPlaceholderPhoto(absUrl)) return null;
  try {
    const u = new URL(String(absUrl), BASE_URL);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !isAllowedPhotoHost(u.hostname)) {
      return null;
    }
    return `/api/blackbaud/photo?url=${encodeURIComponent(u.href)}`;
  } catch {
    return null;
  }
}

function rewriteHtmlPhotos(html) {
  return String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    const src = htmlAttr(tag, 'src');
    const alt = htmlAttr(tag, 'alt');
    const abs = resolvePortalUrl(src);
    if (!abs || isPlaceholderPhoto(abs, alt)) return '';
    const proxied = dashboardPhotoSrc(abs) || proxiedPhotoSrc(abs);
    if (!proxied) return '';
    let next = tag;
    if (/\bsrc\s*=/i.test(next)) {
      next = next.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `src="${proxied}"`);
    } else {
      next = next.replace(/<img\b/i, `<img src="${proxied}"`);
    }
    if (!/\bdata-original\s*=/i.test(next)) {
      next = next.replace(/<img\b/i, `<img data-original="${abs}"`);
    }
    return next;
  });
}

function resolvePortalUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || /^(javascript|data|vbscript):/i.test(raw)) return null;
  try {
    return new URL(raw, BASE_URL).href;
  } catch {
    return null;
  }
}

function isImageRef(url, filename = '') {
  const target = `${filename || ''} ${url || ''}`.split('?')[0].toLowerCase();
  return IMAGE_EXT.test(target);
}

function joinPortalFile(filePath, fileName) {
  const name = fileName && typeof fileName === 'string' ? fileName.trim() : '';
  const pathPart = filePath && typeof filePath === 'string' ? filePath.trim() : '';
  if (name && /^https?:\/\//i.test(name)) return resolvePortalUrl(name);
  if (pathPart && /^https?:\/\//i.test(pathPart) && !name) return resolvePortalUrl(pathPart);
  if (pathPart && name) {
    const combined = pathPart.endsWith('/') ? `${pathPart}${name}` : `${pathPart}/${name}`;
    return resolvePortalUrl(combined);
  }
  if (name) {
    if (name.startsWith('/')) return resolvePortalUrl(name);
    if (/^download_/i.test(name)) return resolvePortalUrl(`/ftpimages/2274/download/${name}`);
    return resolvePortalUrl(`/ftpimages/2274/photo/${name}`);
  }
  if (pathPart) return resolvePortalUrl(pathPart);
  return null;
}

function htmlAttr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(tag || '').match(re);
  return match ? (match[1] || match[2] || match[3] || '').trim() : '';
}

/**
 * Request-scoped Blackbaud session (cookie `t`) from ALS. Never a process global.
 */
export async function getBlackbaudSession() {
  const live = currentWlaSession();
  if (live?.cookie) return live;
  return null;
}

/** Harvested portal cookie `t` from a session cookie header. SKY tokens are not `t`. */
export function portalTFromCookie(raw) {
  const str = String(raw || '').trim();
  if (!str) return '';
  const named = str.match(/(?:^|;\s*)t=([^;]+)/i);
  if (named?.[1]) return named[1].trim();
  if (!str.includes('=') && str.length > 20) return str;
  return '';
}

/**
 * Cookie header for myschoolapp. Always includes harvested `t` when present.
 */
export function formatCookieString(rawCookie) {
  const t = portalTFromCookie(rawCookie);
  return t ? `t=${t}` : '';
}

function portalCookieHeader(session) {
  const cookie = formatCookieString(session?.cookie);
  return portalTFromCookie(cookie) ? cookie : '';
}

/**
 * Make authenticated request to Blackbaud myschoolapp API
 */
async function blackbaudRequest(endpoint, options = {}) {
  const session = options.session || await getBlackbaudSession();
  const cleanCookie = portalCookieHeader(session);
  if (!cleanCookie) {
    throw new Error('SESSION_EXPIRED: No harvested Blackbaud session cookie t on this request.');
  }

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
          coursePhoto: photoRel ? dashboardPhotoSrc(toCdnPhotoUrl(photoRel) || photoRel) : null,
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
  const dueAt = parseDueDate(meta.SortDateDue || meta.DateDue);
  const createdAt = parsePortalDate(
    meta.DateCreated || meta.CreatedDate || meta.CreateDate || meta.InsertDate || grade.InsertDate
  );
  const title = decodeHtmlEntities(meta.AssignShort || meta.AbbrDescription || meta.ShortDescription || 'Assignment');
  const comment = decodeHtmlEntities(grade.Comment || '');
  const pointsRaw = grade.PointsEarned ?? grade.pointsEarned;
  const points = (typeof pointsRaw === 'number' && !Number.isNaN(pointsRaw))
    ? pointsRaw
    : (Number.isFinite(Number(pointsRaw)) && String(pointsRaw).trim() !== '' ? Number(pointsRaw) : null);
  const maxPoints = meta.MaxPoints || grade.MaxPoints || null;
  const percent = assignmentPercent(points, maxPoints);
  const gradeFields = {
    ...grade,
    pointsEarned: points,
    maxPoints,
    letter: grade.Letter || grade.letter
  };
  const portalMissing = isPortalMissingFlag(grade) || isPortalMissingFlag(meta);
  const zeroMissing = isZeroCreditMissing(gradeFields);
  const isMissing = portalMissing || zeroMissing;
  const graded = isAssignmentGraded(gradeFields);
  const status = classifyAssignment({
    assignedAt,
    dueAt,
    graded,
    isMissing,
    pointsEarned: points,
    maxPoints,
    letter: grade.Letter || grade.letter,
    grade: gradeFields,
    now
  });
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
    assignedDate: assignedAt
      ? formatAssignmentDate(assignedAt)
      : (createdAt ? formatAssignmentDate(createdAt) : ''),
    dueDate: dueAt ? formatAssignmentDate(dueAt) : '',
    assignedDateISO: toDateKey(assignedAt),
    dueDateISO: toDateKey(dueAt),
    createdDateISO: toDateKey(createdAt),
    status,
    done: graded && !isMissing,
    completed: graded && !isMissing,
    graded,
    isMissing,
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
    priority: status === 'overdue' || status === 'missing' ? 'high' : status === 'dueSoon' ? 'medium' : 'low'
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
export async function syncBlackbaudData(options = {}) {
  try {
    return await syncBlackbaudSnapshot(options);
  } catch (err) {
    if (isSessionExpiredError(err)) {
      return sessionExpiredPayload(err.message);
    }
    throw err;
  }
}

async function syncBlackbaudSnapshot(options = {}) {
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
      if (isSessionExpiredError(e)) {
        return sessionExpiredPayload(e.message);
      }
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
  if (identity.role === 'parent') {
    const byId = new Map(students.map((s) => [s.id, s]));
    if (!byId.has(BEN_ID)) students = [...students, { id: BEN_ID, student: 'Ben', name: 'Ben' }];
    if (!byId.has(JADE_ID)) students = [...students, { id: JADE_ID, student: 'Jade', name: 'Jade' }];
  }
  const allowedIds = new Set(identity.allowedStudentIds || students.map((s) => s.id));
  students = students.filter((s) => allowedIds.has(s.id));
  if (identity.role === 'student') {
    students = students.filter((s) => allowedIds.has(s.id));
  } else {
    const requestedKeys = Array.isArray(options.studentKeys)
      ? options.studentKeys.filter((k) => k === 'Ben' || k === 'Jade')
      : [];
    if (requestedKeys.length) {
      const want = new Set(requestedKeys);
      students = students.filter((s) => want.has(s.student));
    }
  }

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
        if (identity.role === 'student') continue;
        const requestedKeys = Array.isArray(options.studentKeys)
          ? options.studentKeys.filter((k) => k === 'Ben' || k === 'Jade')
          : [];
        if (requestedKeys.length && !requestedKeys.includes(s.student)) continue;
        students.push(s);
      }
    }
  } catch (err) {
    if (isSessionExpiredError(err)) {
      return sessionExpiredPayload(err.message);
    }
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
  const cleanCookie = portalCookieHeader(session);
  if (!cleanCookie) {
    return { ok: false, status: 401, forbidden: true, expired: true, data: null };
  }
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

function isFlagDescription(value) {
  return FLAG_DESCRIPTION.test(String(value || '').trim());
}

function attachmentsFromRecord(item) {
  if (!item || typeof item !== 'object') return [];
  const list = [];
  const push = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === 'object') list.push(value);
    else if (typeof value === 'string') list.push({ url: value });
  };
  push(item.Attachment);
  push(item.Attachments);
  push(item.Photos);
  push(item.DownloadItems);
  push(item.LinkItems);
  push(item.Files);
  push(item.PhotoList);
  if (item.DownloadUrl || item.FileName || item.Filename || item.FilePath || item.Thumbnail || item.ThumbFilename) {
    list.push({
      url: item.DownloadUrl || item.Attachment || item.FilenameUrl,
      DownloadUrl: item.DownloadUrl,
      FileName: item.FileName || item.Filename,
      FilePath: item.FilePath,
      FriendlyFileName: item.FriendlyFileName,
      Thumbnail: item.Thumbnail || item.ThumbFilename || item.ThumbFilenameUrl,
      Title: item.Description || item.ShortDescription || item.FriendlyFileName
    });
  }
  return list;
}

function extractRichContent(html, extra = {}) {
  const raw = String(html || '');
  const images = [];
  const files = [];
  const links = [];
  const seenImg = new Set();
  const seenFile = new Set();
  const seenLink = new Set();

  const pushImage = (url, alt = '', caption = '') => {
    const abs = resolvePortalUrl(url);
    if (!abs || !isAllowedPhotoUrl(abs) || isPlaceholderPhoto(abs, `${alt} ${caption}`)) return;
    const src = dashboardPhotoSrc(abs) || proxiedPhotoSrc(abs);
    if (!src || seenImg.has(src)) return;
    seenImg.add(src);
    images.push({
      src,
      alt: pickText(alt, caption) || '',
      caption: pickText(caption) || '',
      href: abs
    });
  };

  const pushFile = (url, name = '', note = '') => {
    const abs = resolvePortalUrl(url);
    if (!abs) return;
    const label = pickText(name) || abs;
    if (isAllowedPhotoUrl(abs) && isImageRef(abs, label)) {
      pushImage(abs, label, label);
      return;
    }
    if (seenFile.has(abs)) return;
    seenFile.add(abs);
    files.push({ name: label, url: abs, note: pickText(note) || '' });
  };

  const pushLink = (url, label = '') => {
    const abs = resolvePortalUrl(url);
    if (!abs) return;
    const key = abs.toLowerCase();
    if (seenLink.has(key) || seenFile.has(abs)) return;
    const name = pickText(label) || abs;
    if (isAllowedPhotoUrl(abs) && isImageRef(abs, name)) {
      pushImage(abs, name, name);
      return;
    }
    seenLink.add(key);
    links.push({ url: abs, label: name });
  };

  for (const match of raw.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    pushImage(htmlAttr(tag, 'src'), htmlAttr(tag, 'alt'));
  }
  for (const match of raw.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const inner = tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '');
    pushLink(htmlAttr(tag, 'href'), inner);
  }

  for (const att of extra.attachments || []) {
    const name = att.name || att.Title || att.Filename || att.FileName || att.FriendlyFileName || att.Caption || '';
    const note = att.note || att.LongDescription || att.Caption || '';
    const thumb = att.Thumbnail || att.ThumbFilename || att.ThumbFilenameUrl || att.ThumbFilePath
      || att.LargeFilenameUrl || att.CoverFilenameUrl || att.FilenameUrl;
    if (thumb) pushImage(joinPortalFile(null, thumb) || thumb, name, name);
    const abs = joinPortalFile(att.FilePath, att.FileName || att.Filename || att.DownloadUrl || att.url || att.Attachment);
    if (abs && isImageRef(abs, name)) pushImage(abs, name, name);
    else if (abs) pushFile(abs, name, note);
  }

  return {
    text: pickText(raw),
    images,
    files,
    links
  };
}

function mergeRich(target, next) {
  const seenImg = new Set((target.images || []).map((item) => item.src));
  const seenFile = new Set((target.files || []).map((item) => item.url));
  const seenLink = new Set((target.links || []).map((item) => item.url));
  for (const image of next.images || []) {
    if (!image?.src || seenImg.has(image.src)) continue;
    seenImg.add(image.src);
    target.images.push(image);
  }
  for (const file of next.files || []) {
    if (!file?.url || seenFile.has(file.url)) continue;
    seenFile.add(file.url);
    target.files.push(file);
  }
  for (const link of next.links || []) {
    if (!link?.url || seenLink.has(link.url) || seenFile.has(link.url)) continue;
    seenLink.add(link.url);
    target.links.push(link);
  }
  return target;
}

function normalizeBulletinItem(item, index) {
  if (!item || typeof item !== 'object') {
    return { id: `bb_${index}`, title: '', body: '', date: null, author: null, url: null, images: [], files: [], links: [] };
  }
  const desc = isFlagDescription(item.Description) ? '' : item.Description;
  const shortDesc = pickText(item.ShortDescription);
  const title = pickText(
    item.title,
    item.Headline,
    item.Title,
    item.Subject,
    shortDesc,
    desc && String(desc).replace(/<[^>]+>/g, '').trim().length < 90 ? desc : '',
    item.Name && !CONTENT_TYPE_TITLES.test(item.Name) ? item.Name : '',
    item.UrlDisplay
  );
  const html = [
    item.body,
    item.LongText,
    item.LongDescription,
    item.BriefDescription,
    item.Body,
    item.Message,
    item.HtmlContent,
    item.ContentBody,
    item.RichText,
    desc && pickText(desc) !== title ? desc : '',
    item.AlbumDescription
  ].filter((value) => value && typeof value === 'string').join('\n');
  const rich = extractRichContent(html, { attachments: attachmentsFromRecord(item) });
  const cover = item.LargeFilenameUrl || item.CoverFilenameUrl || item.FilenameUrl || item.LinkImageUrl || item.ThumbFilenameUrl;
  if (cover && String(cover).trim() && !isPlaceholderPhoto(cover, title)) {
    mergeRich(rich, extractRichContent('', { attachments: [{ url: cover, FileName: cover, Title: title }] }));
  }
  const url = item.Url || item.url || null;
  if (url && !rich.links.some((link) => link.url === url) && url !== rich.text) {
    rich.links.push({ url, label: pickText(item.UrlDisplay, shortDesc, title) || url });
  }
  const body = rich.text && rich.text !== title ? rich.text : (title ? '' : rich.text);
  return {
    id: item.AlbumID || item.LinkID || item.ItemID || item.EditableTextId || item.ContentItemId
      || item.DownloadID || item.ContentId || item.Id || `bb_${index}`,
    title: title || (body || rich.images.length || rich.files.length ? 'Class post' : ''),
    body,
    date: formatDisplayDate(
      item.PublishDate || item.PublishDateDisplay || item.CreateDate || item.Date || item.DatePosted || item.InsertDate
    ),
    author: pickText(
      item.CreateName,
      item.Author,
      item.AuthorName,
      item.ModifyName,
      item.PostedBy,
      item.OwnerName,
      item.UserName
    ) || null,
    url,
    images: rich.images,
    files: rich.files,
    links: rich.links.filter((link) => link.url !== url)
  };
}

async function fetchSectionBulletin(sectionId, leadSectionId) {
  const ids = [...new Set([leadSectionId, sectionId].filter(Boolean).map(String))];
  const kinds = ['news', 'text', 'announcement', 'link', 'download', 'media', 'photo'];
  const labels = [2, 1];
  let forbidden = false;
  let expired = false;
  const items = [];
  const seen = new Set();
  const used = [];

  const jobs = [];
  for (const id of ids) {
    for (const label of labels) {
      for (const kind of kinds) {
        jobs.push(`/api/${kind}/forsection/${encodeURIComponent(id)}/?format=json&contextLabelId=${label}`);
      }
    }
  }

  const hits = await Promise.all(jobs.map(async (url) => ({ url, hit: await blackbaudRequestSoft(url) })));
  for (const { url, hit } of hits) {
    if (hit.forbidden) forbidden = true;
    if (hit.expired) expired = true;
    const list = asList(hit.data);
    const htmlPosts = hit.html ? postsFromBulletinHtml(hit.html) : [];
    const combined = list.length ? list : htmlPosts;
    if (!combined.length) continue;
    let added = 0;
    combined.forEach((item, index) => {
      const mapped = normalizeBulletinItem(item, items.length + index);
      if (!(mapped.title || mapped.body || mapped.images?.length || mapped.files?.length)) return;
      const key = String(mapped.id || mapped.title);
      if (seen.has(key)) return;
      seen.add(key);
      items.push(mapped);
      added += 1;
    });
    if (added) used.push(url);
  }

  return { items, forbidden, expired, endpoints: used };
}

function postsFromBulletinHtml(html) {
  const posts = [];
  const tileRe = /<(?:div|article|section)[^>]*(?:bb-tile|bulletin-board|news-item|announcement)[^>]*>([\s\S]*?)<\/(?:div|article|section)>/gi;
  let match;
  let index = 0;
  while ((match = tileRe.exec(html)) && index < 40) {
    const chunk = match[1];
    const title = pickText(
      (chunk.match(/<(?:h[1-4]|header)[^>]*>([\s\S]*?)<\/(?:h[1-4]|header)>/i) || [])[1]
    );
    const rich = extractRichContent(chunk);
    const body = rich.text;
    if (title || (body && body.length > 12) || rich.images.length) {
      posts.push({
        id: `html_${index}`,
        title: title || 'Class post',
        body: body && body !== title ? body : '',
        date: null,
        author: null,
        url: null,
        images: rich.images,
        files: rich.files,
        links: rich.links
      });
    }
    index += 1;
  }
  return posts;
}

function normalizeTopic(item, index) {
  const html = item.Description || item.LongDescription || item.ShortDescription || '';
  const rich = extractRichContent(html);
  return {
    id: item.TopicID || item.TopicId || item.TopicIndexID || item.Id || `topic_${index}`,
    indexId: item.TopicIndexID || item.TopicIndexId || null,
    title: pickText(item.Name, item.Title, item.TopicName) || 'Topic',
    description: rich.text,
    publishDate: formatDisplayDate(item.PublishDate || item.Date),
    author: pickText(item.TopicAuthorShare, item.CreatedByUser) || null,
    thumbUrl: null,
    images: rich.images,
    files: rich.files,
    links: rich.links,
    blocks: [],
    assignments: []
  };
}

function topicContentEntry(entry) {
  const title = pickText(entry.ShortDescription, entry.Headline, entry.FriendlyFileName, entry.FileName);
  const rich = extractRichContent(
    [entry.LongDescription, entry.AlbumDescription, entry.BriefDescription, entry.Description].filter(Boolean).join('\n'),
    { attachments: attachmentsFromRecord(entry) }
  );
  const fileAbs = joinPortalFile(entry.FilePath, entry.FileName || entry.DownloadUrl);
  if (fileAbs && isImageRef(fileAbs, entry.FileName || entry.FriendlyFileName || title) && !isPlaceholderPhoto(fileAbs, title)) {
    const src = dashboardPhotoSrc(fileAbs) || proxiedPhotoSrc(fileAbs);
    if (src) {
      rich.images.unshift({
        src,
        alt: title || '',
        caption: title || '',
        note: rich.text,
        href: fileAbs
      });
    }
  } else if (fileAbs) {
    rich.files.unshift({
      name: pickText(entry.FriendlyFileName, title) || 'Attachment',
      url: fileAbs,
      note: rich.text
    });
  }
  if (entry.Url) {
    const abs = resolvePortalUrl(entry.Url);
    if (abs && !rich.links.some((link) => link.url === abs) && !rich.files.some((file) => file.url === abs)) {
      rich.links.unshift({ url: abs, label: title || abs });
    }
  }
  return { title, body: rich.text, images: rich.images, files: rich.files, links: rich.links };
}

async function hydrateTopic(item, index) {
  const topic = normalizeTopic(item, index);
  const topicId = item.TopicID || item.TopicId;
  const indexId = item.TopicIndexID || item.TopicIndexId;
  if (!topicId || !indexId) return topic;

  const contentHit = await blackbaudRequestSoft(
    `/api/datadirect/topiccontentget/${encodeURIComponent(topicId)}/?format=json&index_id=${encodeURIComponent(indexId)}&id=${encodeURIComponent(topicId)}`
  );
  for (const entry of asList(contentHit.data)) {
    const contentId = Number(entry.ContentId);
    if (SKIP_TOPIC_CONTENT_IDS.has(contentId)) continue;
    if (contentId === COVER_IMAGE_CONTENT_ID) {
      const mapped = topicContentEntry(entry);
      const live = (mapped.images || []).filter((image) => image?.src && !isPlaceholderPhoto(image.src, image.alt));
      if (live[0]?.src) {
        topic.thumbUrl = live[0].src;
        topic.imageUrl = live[0].src;
        mergeRich(topic, { images: live, files: [], links: [] });
      }
      continue;
    }
    if (contentId === COVER_BRIEF_CONTENT_ID) {
      const brief = extractRichContent(entry.LongDescription || entry.ShortDescription || '');
      if (brief.text && !topic.description) topic.description = brief.text;
      mergeRich(topic, brief);
      continue;
    }
    if (!entry.ContentItemId && !entry.FileName && !entry.Url && !entry.LongDescription) continue;
    const mapped = topicContentEntry(entry);
    mergeRich(topic, mapped);
    if (mapped.body && mapped.body !== topic.description && !mapped.images.length && !mapped.files.length) {
      topic.blocks.push({ title: mapped.title, body: mapped.body });
    }
  }

  topic.images = (topic.images || []).filter((image) => image?.src && !isPlaceholderPhoto(image.src, image.alt));
  if (!topic.thumbUrl && topic.images[0]?.src) topic.thumbUrl = topic.images[0].src;
  if (!topic.imageUrl) topic.imageUrl = topic.thumbUrl || null;
  return topic;
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
  const cookie = portalCookieHeader(session);
  if (!cookie || !userId) return null;
  const headers = {
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Referer': `${BASE_URL}/`,
    'Cookie': cookie
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
  const cookie = portalCookieHeader(session);
  if (!cookie || !rawUrl || isPlaceholderPhoto(rawUrl)) return null;
  if (!isAllowedPhotoUrl(rawUrl)) return null;
  const headers = {
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Referer': `${BASE_URL}/`,
    'Cookie': cookie
  };

  let current = new URL(String(rawUrl), BASE_URL).href;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!isAllowedPhotoUrl(current)) return null;
    const res = await fetch(current, { headers, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).href;
      if (isPlaceholderPhoto(current)) return null;
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
    fetchSectionBulletin(sectionId, lead),
    collectLists([
      `/api/datadirect/sectiontopicsget/${leadEnc}?format=json&active=true&future=false&expired=false&sharedTopics=true`,
      `/api/datadirect/sectiontopicsget/${sid}?format=json&active=true&future=false&expired=false&sharedTopics=true`
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

  const bulletin = [...(bulletinHit.items || [])];
  if (bulletin.length) {
    console.info(`[Blackbaud] Class ${sectionId} bulletin: ${bulletin.length} post(s) from ${bulletinHit.endpoints?.[0] || 'forsection'}`);
  }
  const discussions = discussionHit.items.map(normalizeDiscussion);
  if (info?.Description) {
    const introRich = extractRichContent(info.Description);
    const intro = introRich.text || pickText(info.CourseTopic);
    if (intro && !bulletin.some((item) => item.body === intro)) {
      bulletin.unshift({
        id: 'section-intro',
        title: 'Class overview',
        body: intro,
        date: formatDisplayDate(info.StartDate) || null,
        author: pickText(info.Teacher) || null,
        url: null,
        images: introRich.images,
        files: introRich.files,
        links: introRich.links
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
      url: null,
      images: [],
      files: [],
      links: []
    });
  }

  const topics = await Promise.all(topicsHit.items.map((item, index) => hydrateTopic(item, index)));
  if (topics.length) {
    console.info(`[Blackbaud] Class ${sectionId} topics: ${topics.length} from sectiontopicsget`);
  }
  if (discussions.length && !topics.length) {
    topics.push(...discussions.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      publishDate: d.publishDate,
      author: d.author,
      thumbUrl: null,
      images: [],
      files: [],
      links: [],
      blocks: [],
      assignments: []
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
    bulletinSource: bulletinHit.endpoints?.[0] || null,
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

function mmddyyyy(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function decodeParam(raw) {
  let value = String(raw || '');
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    } catch {
      break;
    }
  }
  return value;
}

function snippetFrom(text, max = 140) {
  const clean = pickText(text);
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
}

function studentFromOfficialNote(item = {}) {
  const id = Number(item.StudentUserId || item.StudentId || 0);
  if (id === BEN_ID) return 'Ben';
  if (id === JADE_ID) return 'Jade';
  const name = String(item.StudentName || '');
  if (/ben/i.test(name)) return 'Ben';
  if (/jade/i.test(name)) return 'Jade';
  return labelStudent({ id, FirstName: name });
}

const HS_AUDIENCE = /\b(high\s*school|upper\s*school|\bhs\b|9th|10th|11th|12th|grades?\s*9|freshman|sophomore|junior\s+class|senior\s+class)\b/i;
const MS_AUDIENCE = /\b(middle\s*school|junior\s*high|\bms\b|6th|7th|8th|grades?\s*[6-8])\b/i;

function audienceBlob(item = {}) {
  const groups = asList(item.GroupList).map((group) => (
    group?.Name || group?.GroupName || group?.Label || group?.Title || ''
  )).join(' ');
  return [
    item.GroupName,
    item.Category,
    item.NewsCategory,
    item.Audience,
    item.SchoolLevel,
    item.schoollevel,
    item.schoolLevel,
    item.Division,
    item.Level,
    item.Name,
    item.Title,
    item.Headline,
    item.BriefDescription,
    item.Description,
    item.LongDescription,
    item.Location,
    groups
  ].map((value) => pickText(value)).filter(Boolean).join(' ');
}

export function classifySchoolLevel(item = {}) {
  const tagged = pickText(item.SchoolLevel, item.schoollevel, item.schoolLevel, item.Audience, item.Category, item.GroupName);
  const taggedHs = tagged && HS_AUDIENCE.test(tagged);
  const taggedMs = tagged && MS_AUDIENCE.test(tagged);
  if (taggedHs && !taggedMs) return 'HS';
  if (taggedMs && !taggedHs) return 'MS';
  const text = audienceBlob(item);
  const hs = HS_AUDIENCE.test(text);
  const ms = MS_AUDIENCE.test(text);
  if (hs && !ms) return 'HS';
  if (ms && !hs) return 'MS';
  return 'All';
}

function htmlFromRecord(item = {}) {
  return [
    item.LongText,
    item.LongDescription,
    item.BriefDescription,
    item.Body,
    item.Message,
    item.HtmlContent,
    item.ContentBody,
    item.RichText,
    item.Comment,
    item.Description
  ].filter((value) => value && typeof value === 'string' && !isFlagDescription(value)).join('\n');
}

function articleMedia(item, html) {
  const rich = extractRichContent(html, { attachments: attachmentsFromRecord(item) });
  const cover = newsImageUrl(item);
  if (cover && !(rich.images || []).some((image) => image.src === cover)) {
    rich.images.unshift({
      src: cover,
      alt: pickText(item.Name, item.Headline, item.Title) || '',
      caption: '',
      href: cover
    });
  }
  rich.images = (rich.images || []).filter((image) => image?.src && !isPlaceholderPhoto(image.src, image.alt));
  return rich;
}

function normalizeOfficialNote(item, index) {
  const htmlRaw = htmlFromRecord(item);
  const rich = articleMedia(item, htmlRaw);
  const body = rich.text || pickText(item.Comment, item.LongDescription, item.Body);
  const title = pickText(
    item.SubjectLine,
    item.Title,
    item.CommentType,
    snippetFrom(body, 72)
  ) || 'Official note';
  return {
    id: String(item.CommentId || item.Id || `note_${index}`),
    kind: 'note',
    title,
    date: formatDisplayDate(item.CreatedDate || item.InsertDate || item.NoteDate) || pickText(item.CreatedDate, item.InsertDate),
    time: null,
    student: studentFromOfficialNote(item),
    studentUserId: Number(item.StudentUserId || item.StudentId || 0) || null,
    studentName: pickText(item.StudentName) || null,
    author: pickText(item.AuthorName, item.TeacherName) || null,
    course: pickText(item.CourseTitle) || null,
    type: pickText(item.CommentType) || 'Official note',
    source: 'Official Notes',
    snippet: snippetFrom(body),
    description: body,
    html: rewriteHtmlPhotos(htmlRaw),
    images: rich.images,
    files: rich.files,
    links: rich.links,
    viewed: item.Viewed !== false,
    imageUrl: rich.images[0]?.src || null,
    feed: 'notes'
  };
}

function officialNotesQuery() {
  const toDate = encodeURIComponent(mmddyyyy());
  return `format=json&currentInd=1&statusXml=&commentTypeXml=&fromDate=&toDate=${toDate}&searchText=`;
}

export async function fetchOfficialNotes() {
  const qs = officialNotesQuery();
  const listUrl = `/api/officialnote/InboxExternal/?${qs}`;
  const countUrl = `/api/officialnote/GetInboxCountsExternal/?${qs}`;
  const [listHit, countHit] = await Promise.all([
    blackbaudRequestSoft(listUrl),
    blackbaudRequestSoft(countUrl)
  ]);
  if (listHit.expired || countHit.expired) {
    return { connected: false, expired: true, notes: [], unreadCount: 0, endpoints: [listUrl, countUrl] };
  }
  const notes = asList(listHit.data).map((item, index) => normalizeOfficialNote(item, index))
    .filter((item) => item.title || item.description);
  const countRow = asList(countHit.data)[0] || {};
  const unreadCount = notes.filter((item) => item.viewed === false).length
    || Number(countRow.NumNewComments || 0)
    || 0;
  return {
    connected: true,
    notes,
    unreadCount,
    totalCount: Number(countRow.AcaCommentCount || notes.length) || notes.length,
    endpoints: [listUrl, countUrl]
  };
}

export async function fetchOfficialNoteDetail(rawId) {
  const id = decodeParam(rawId);
  if (!id) return null;
  const url = `/api/officialnote/InboxDetailExternal/?format=json&id=${encodeURIComponent(id)}`;
  const hit = await blackbaudRequestSoft(url);
  const item = asList(hit.data)[0] || (looksLikeRecord(hit.data) ? hit.data : null);
  if (!item) return null;
  return { ...normalizeOfficialNote(item, 0), id: String(rawId || item.CommentId || id) };
}

function newsImageUrl(item) {
  const raw = item?.LargeFilenameUrl || item?.ThumbFilenameUrl || item?.ZoomFilenameUrl
    || item?.PhotoList?.[0]?.LargeFilenameUrl || item?.PhotoList?.[0]?.ThumbFilenameUrl;
  if (isPlaceholderPhoto(raw, item?.ThumbFilename || item?.Filename || '')) return null;
  const abs = toCdnPhotoUrl(raw) || resolvePortalUrl(raw);
  if (!abs || isPlaceholderPhoto(abs)) return null;
  return dashboardPhotoSrc(abs);
}

function normalizeFeaturedNews(item, index) {
  const htmlRaw = htmlFromRecord(item);
  const rich = articleMedia(item, htmlRaw);
  const body = rich.text || pickText(item.LongDescription, item.BriefDescription, item.Description);
  return {
    id: String(item.Id || item.ContentItemId || `news_${index}`),
    kind: 'news',
    title: pickText(item.Name, item.Headline, item.Title) || 'School news',
    date: formatDisplayDate(item.PublishDate || item.PublishDateDisplay || item.FeatureDate)
      || pickText(item.PublishDateDisplay, item.PublishDate),
    time: null,
    student: 'All',
    author: pickText(item.Author, item.CreateName, item.AuthorName) || null,
    type: 'News',
    source: 'School news',
    snippet: snippetFrom(body || item.BriefDescription),
    description: body,
    html: rewriteHtmlPhotos(htmlRaw),
    images: rich.images,
    files: rich.files,
    links: rich.links,
    viewed: false,
    imageUrl: rich.images[0]?.src || newsImageUrl(item),
    url: resolvePortalUrl(item.Url) || null,
    feed: 'news'
  };
}

function resourceKindLabel(kind) {
  const key = String(kind || '').toLowerCase();
  if (key === 'media') return 'Media';
  if (key === 'link') return 'Link';
  if (key === 'download') return 'Download';
  if (key === 'content') return 'Content';
  return 'Resource';
}

function isResourceStub(item) {
  if (!item || typeof item !== 'object') return true;
  const id = item.Id ?? item.DownloadID ?? item.LinkID ?? item.AlbumID ?? item.ItemID;
  if (id === -2147483648) return true;
  if (isFlagDescription(item.Description)
    && !item.Url && !item.DownloadUrl && !item.FriendlyFileName && !item.ShortDescription && !item.FileName) {
    return true;
  }
  return false;
}

function isUsableResource(item) {
  if (isResourceStub(item)) return false;
  return Boolean(
    item.DownloadID
    || item.LinkID
    || item.AlbumID
    || item.Url
    || item.DownloadUrl
    || item.FriendlyFileName
    || item.ShortDescription
    || (item.Description && !isFlagDescription(item.Description) && String(item.Description).trim().length > 1)
  );
}

function normalizeResourceItem(item, index, extra = {}) {
  const mapped = normalizeBulletinItem(item, index);
  const htmlRaw = htmlFromRecord(item);
  const type = extra.type || resourceKindLabel(extra.kind);
  const title = pickText(
    mapped.title,
    item.ShortDescription,
    isFlagDescription(item.Description) ? '' : item.Description,
    item.FriendlyFileName,
    item.FileName
  ) || type;
  const images = (mapped.images || []).filter((image) => image?.src && !isPlaceholderPhoto(image.src, image.alt));
  const thumb = images[0]?.src || newsImageUrl(item);
  return {
    id: String(item.DownloadID || item.LinkID || item.AlbumID || mapped.id || extra.id || `resource_${index}`),
    kind: 'resource',
    title,
    date: mapped.date,
    time: null,
    student: 'All',
    author: mapped.author,
    type,
    source: extra.source || item.GroupName || 'Resources',
    snippet: snippetFrom(mapped.body || title),
    description: mapped.body,
    html: rewriteHtmlPhotos(htmlRaw),
    images,
    files: mapped.files || [],
    links: mapped.links || [],
    viewed: false,
    imageUrl: thumb && !isPlaceholderPhoto(thumb) ? thumb : null,
    url: mapped.url || resolvePortalUrl(item.DownloadUrl) || resolvePortalUrl(item.Url) || null,
    feed: 'resources'
  };
}

function uniqueArticles(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (!item?.title && !item?.files?.length && !item?.links?.length && !item?.url) continue;
    const key = `${item.feed || item.kind}:${item.type}:${item.id}:${item.title}:${item.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

async function classLeadSectionIds() {
  const ids = new Set();
  const schoolYear = encodeURIComponent('2026 - 2027');
  for (const studentId of [BEN_ID, JADE_ID]) {
    const termsHit = await blackbaudRequestSoft(
      `/api/DataDirect/StudentGroupTermList/?studentUserId=${studentId}&schoolYearLabel=${schoolYear}&personaId=1`
    );
    if (termsHit.expired) return { ids: [], expired: true };
    const terms = asList(termsHit.data);
    const active = terms.find((row) => row.CurrentInd === 1 && row.OfferingType === 1) || terms[0];
    const durationId = active?.DurationId || 0;
    const classHit = await blackbaudRequestSoft(
      `/api/datadirect/ParentStudentUserClassesGet?userId=${studentId}&schoolYearLabel=${schoolYear}&memberLevel=3&persona=1&durationList=${durationId}`
    );
    if (classHit.expired) return { ids: [], expired: true };
    for (const course of asList(classHit.data)) {
      const id = course.leadsectionid || course.LeadSectionId || course.sectionid || course.SectionId;
      if (id) ids.add(String(id));
    }
  }
  return { ids: [...ids], expired: false };
}

export async function fetchFeaturedContent() {
  const newsUrl = '/api/News/FeaturedNewsGet/?format=json';
  const bulletinUrl = '/api/DataDirect/MainBulletinUser?personaId=1';
  const [newsHit, bulletinHit] = await Promise.all([
    blackbaudRequestSoft(newsUrl),
    blackbaudRequestSoft(bulletinUrl)
  ]);
  if (newsHit.expired) {
    return { connected: false, expired: true, items: [], endpoints: [newsUrl, bulletinUrl] };
  }
  const items = [
    ...asList(newsHit.data).map((item, index) => normalizeFeaturedNews(item, index)),
    ...asList(bulletinHit.data).map((item, index) => ({
      ...normalizeFeaturedNews({ ...item, Name: item.Name || item.Headline || 'Bulletin' }, index),
      type: 'Bulletin',
      source: 'Bulletin'
    }))
  ];
  return {
    connected: true,
    items: uniqueArticles(items),
    endpoints: [newsUrl, bulletinUrl]
  };
}

export async function fetchResources() {
  const items = [];
  const used = [];
  const pushList = (url, kind, list) => {
    const usable = list.filter(isUsableResource);
    if (!usable.length) return;
    used.push(url);
    usable.forEach((item, index) => {
      items.push(normalizeResourceItem(item, items.length + index, {
        kind,
        type: resourceKindLabel(kind),
        source: item.GroupName || 'Resources'
      }));
    });
  };

  const mediaHit = await blackbaudRequestSoft('/api/Media/FeaturedMediaGet/?format=json');
  if (mediaHit.expired) {
    return { connected: false, expired: true, items: [], endpoints: [] };
  }
  pushList('/api/Media/FeaturedMediaGet/?format=json', 'media', asList(mediaHit.data));

  const sections = await classLeadSectionIds();
  if (sections.expired) {
    return { connected: false, expired: true, items: uniqueArticles(items), endpoints: used };
  }
  const kinds = ['download', 'link'];
  const labels = [2, 1];
  const jobs = [];
  for (const id of sections.ids) {
    for (const kind of kinds) {
      for (const label of labels) {
        jobs.push({
          kind,
          url: `/api/${kind}/forsection/${encodeURIComponent(id)}/?format=json&contextLabelId=${label}`
        });
      }
    }
  }
  if (jobs.length) {
    const hits = await Promise.all(jobs.map(async (job) => ({
      ...job,
      hit: await blackbaudRequestSoft(job.url)
    })));
    if (hits.some((row) => row.hit.expired) && !items.length) {
      return { connected: false, expired: true, items: [], endpoints: used };
    }
    for (const { kind, url, hit } of hits) {
      pushList(url, kind, asList(hit.data));
    }
  }

  const mapped = uniqueArticles(items);
  if (mapped.length) {
    console.info(`[Blackbaud] Resources: ${mapped.length} item(s) from download/link forsection`);
  }
  return {
    connected: true,
    items: mapped,
    endpoints: used
  };
}

export async function fetchNewsDetail(rawId) {
  const id = encodeURIComponent(String(rawId || '').trim());
  if (!id) return null;
  const url = `/api/news/${id}/?format=json`;
  const hit = await blackbaudRequestSoft(url);
  const item = asList(hit.data)[0] || (hit.data && typeof hit.data === 'object' && !Array.isArray(hit.data) ? hit.data : null);
  if (!item || item.Error) return null;
  return normalizeFeaturedNews(item, 0);
}
