import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '..', 'data', 'user-sessions.json');

export const SESSION_COOKIE = 'wla_session';
export const LOGIN_COOKIE = 'wla_login';

export const BEN_ID = 5662183;
export const JADE_ID = 5819113;
export const ERIC_ID = 5662184;

const SESSION_TTL_SECONDS = 2592000;
const sessions = new Map();
const claims = new Map();

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

function kvSessionKey(id) {
  return `wla_session_${id}`;
}

function cookieSuffix() {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `; HttpOnly; Path=/; SameSite=Lax${secure}`;
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    for (const [id, record] of Object.entries(parsed.sessions || {})) {
      sessions.set(id, { ...record, sessionId: id });
    }
  } catch (err) {
    console.warn('[Sessions] Failed to load store:', err.message);
  }
}

function persistStore() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const obj = {};
    for (const [id, record] of sessions) obj[id] = record;
    fs.writeFileSync(STORE_PATH, JSON.stringify({ sessions: obj }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Sessions] Failed to persist store:', err.message);
  }
}

async function writeKvSession(id, record) {
  const { url, token } = kvConfig();
  if (!url || !token || !id) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(kvSessionKey(id))}/ex/${SESSION_TTL_SECONDS}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(record)
    });
  } catch (err) {
    console.warn('[Sessions] KV write failed:', err.message);
  }
}

async function readKvSession(id) {
  const { url, token } = kvConfig();
  if (!url || !token || !id) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(kvSessionKey(id))}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const json = await res.json();
    let parsed = json?.result;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { return null; }
    }
    if (parsed && typeof parsed === 'object' && parsed.cookie) {
      return { ...parsed, sessionId: id };
    }
  } catch (err) {
    console.warn('[Sessions] KV read failed:', err.message);
  }
  return null;
}

async function deleteKvSession(id) {
  const { url, token } = kvConfig();
  if (!url || !token || !id) return;
  try {
    await fetch(`${url}/del/${encodeURIComponent(kvSessionKey(id))}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    console.warn('[Sessions] KV delete failed:', err.message);
  }
}

async function deleteLegacyGlobalBlackbaudSession() {
  const { url, token } = kvConfig();
  if (!url || !token) return;
  try {
    await fetch(`${url}/del/blackbaud_session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    console.warn('[Sessions] Legacy KV cleanup failed:', err.message);
  }
}

loadStore();
void deleteLegacyGlobalBlackbaudSession();

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function sessionCookieHeader(id, { clear = false } = {}) {
  if (clear || !id) {
    return `${SESSION_COOKIE}=; Max-Age=0${cookieSuffix()}`;
  }
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Max-Age=${SESSION_TTL_SECONDS}${cookieSuffix()}`;
}

export function loginCookieHeader(nonce, { clear = false } = {}) {
  if (clear || !nonce) {
    return `${LOGIN_COOKIE}=; Max-Age=0${cookieSuffix()}`;
  }
  return `${LOGIN_COOKIE}=${encodeURIComponent(nonce)}; Max-Age=600${cookieSuffix()}`;
}

export function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  const list = Array.isArray(prev) ? prev : [prev];
  res.setHeader('Set-Cookie', [...list, value]);
}

export function identifyUser(session = {}) {
  const uiName = String(session.accountName || session.parentName || '').toLowerCase();
  const firstName = String(session.firstName || session.nickName || '').toLowerCase();
  const email = String(session.email || '').toLowerCase();
  const first = firstName || uiName.split(/\s+/).filter(Boolean)[0] || '';
  const blob = `${uiName} ${firstName} ${email}`;
  const userId = Number(session.userId || 0);
  const parentAccess = {
    role: 'parent',
    allowedStudentKeys: ['Ben', 'Jade'],
    allowedStudentIds: [BEN_ID, JADE_ID]
  };

  if (userId === ERIC_ID || first === 'eric' || email.includes('hifismith')) {
    return {
      userKey: 'eric',
      displayName: 'Eric',
      accountName: session.accountName || 'Eric',
      userId: session.userId || ERIC_ID,
      ...parentAccess
    };
  }
  if (/stefani|stephanie/.test(blob) || first === 'stefani' || email.includes('stefanicsmith')) {
    return {
      userKey: 'stefani',
      displayName: 'Stefani',
      accountName: session.accountName || 'Stefani',
      userId: session.userId || null,
      ...parentAccess
    };
  }
  if (userId === BEN_ID || first === 'ben' || /benjamin/.test(uiName) || /benjamin/.test(blob)) {
    return {
      userKey: 'ben',
      displayName: 'Ben',
      role: 'student',
      accountName: session.accountName || 'Ben',
      allowedStudentKeys: ['Ben'],
      allowedStudentIds: [BEN_ID]
    };
  }
  if (userId === JADE_ID || first === 'jade') {
    return {
      userKey: 'jade',
      displayName: 'Jade',
      role: 'student',
      accountName: session.accountName || 'Jade',
      allowedStudentKeys: ['Jade'],
      allowedStudentIds: [JADE_ID]
    };
  }

  if (session.role === 'parent' || (session.students || []).length > 1) {
    const students = session.students || [];
    return {
      userKey: 'parent',
      displayName: session.accountName || 'Parent',
      role: 'parent',
      accountName: session.accountName || 'Parent',
      allowedStudentKeys: students.map((s) => s.student).filter(Boolean),
      allowedStudentIds: students.map((s) => s.id).filter(Boolean)
    };
  }

  const self = (session.students || []).find((s) => s.id === userId) || session.students?.[0];
  return {
    userKey: 'student',
    displayName: session.accountName || self?.student || 'Student',
    role: 'student',
    accountName: session.accountName || self?.name || 'Student',
    allowedStudentKeys: self ? [self.student] : [],
    allowedStudentIds: self ? [self.id] : (userId ? [userId] : [])
  };
}

export function publicIdentity(record) {
  if (!record?.cookie) {
    return {
      connected: false,
      subdomain: 'westlakelutheran',
      students: []
    };
  }
  const allowedIds = new Set(record.allowedStudentIds || []);
  const allowedKeys = new Set(record.allowedStudentKeys || []);
  const students = (record.students || []).filter((s) => (
    allowedIds.has(s.id) || allowedKeys.has(s.student)
  ));
  return {
    connected: true,
    subdomain: record.subdomain || 'westlakelutheran',
    userKey: record.userKey,
    displayName: record.displayName,
    role: record.role,
    accountName: record.accountName,
    firstName: record.firstName || null,
    lastName: record.lastName || null,
    nickName: record.nickName || null,
    email: record.email || null,
    photoUrl: record.photoUrl || null,
    parentName: record.parentName,
    userId: record.userId,
    personaId: record.personaId,
    allowedStudentKeys: record.allowedStudentKeys || [],
    students,
    verifiedAt: record.verifiedAt || null
  };
}

export function stageLogin(record) {
  const claimToken = crypto.randomUUID();
  claims.set(claimToken, { record, expires: Date.now() + 5 * 60 * 1000 });
  return { claimToken, record };
}

export function takeClaim(token) {
  if (!token) return null;
  const row = claims.get(token);
  claims.delete(token);
  if (!row || row.expires < Date.now()) return null;
  return row.record;
}

export function persistSessions(record) {
  if (record?.sessionId) {
    sessions.set(record.sessionId, record);
    persistStore();
    void writeKvSession(record.sessionId, record);
    return;
  }
  persistStore();
}

export function createSession(record) {
  const id = crypto.randomUUID();
  const stored = { ...record, sessionId: id, createdAt: new Date().toISOString() };
  sessions.set(id, stored);
  persistStore();
  void writeKvSession(id, stored);
  return id;
}

export function getSession(id) {
  if (!id) return null;
  return sessions.get(id) || null;
}

export async function getSessionAsync(id) {
  if (!id) return null;
  const cached = sessions.get(id);
  if (cached) return cached;
  const fromKv = await readKvSession(id);
  if (fromKv) {
    sessions.set(id, fromKv);
    return fromKv;
  }
  return null;
}

export function deleteSession(id) {
  if (!id) return;
  sessions.delete(id);
  persistStore();
  void deleteKvSession(id);
}

export function filterPayloadForIdentity(data, identity) {
  if (!data) return {};
  if (!identity) {
    return {
      tasks: [],
      events: [],
      deletedEventKeys: [],
      grades: {},
      assignments: [],
      missingAssignments: []
    };
  }
  if (identity.role === 'parent') return data;
  const allowed = new Set(identity.allowedStudentKeys || []);
  const grades = {};
  for (const [key, rows] of Object.entries(data.grades || {})) {
    if (allowed.has(key)) grades[key] = rows;
  }
  return {
    ...data,
    grades,
    tasks: (data.tasks || []).filter((t) => allowed.has(t.student)),
    events: (data.events || []).filter((e) => allowed.has(e.student) || e.student === 'All'),
    assignments: (data.assignments || []).filter((a) => allowed.has(a.student)),
    missingAssignments: (data.missingAssignments || []).filter((m) => allowed.has(m.student))
  };
}

export function mergeStudentWrite(existing, incoming, identity) {
  const allowed = new Set(identity.allowedStudentKeys || []);
  const mergeList = (oldList = [], newList) => {
    if (!Array.isArray(newList)) return oldList;
    const keep = oldList.filter((item) => !allowed.has(item.student));
    const scoped = newList.filter((item) => allowed.has(item.student) || String(item.id || '').startsWith('task_custom_'));
    return [...keep, ...scoped];
  };
  return {
    tasks: incoming.tasks !== undefined ? mergeList(existing.tasks, incoming.tasks) : existing.tasks,
    events: incoming.events !== undefined ? mergeList(existing.events, incoming.events) : existing.events,
    deletedEventKeys: incoming.deletedEventKeys !== undefined ? incoming.deletedEventKeys : existing.deletedEventKeys,
    assignments: incoming.assignments !== undefined ? mergeList(existing.assignments, incoming.assignments) : existing.assignments
  };
}
