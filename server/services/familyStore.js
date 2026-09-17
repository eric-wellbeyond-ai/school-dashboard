/**
 * Durable family store (the DB for this Mac app):
 * comments, notifications, completions, missing-acks, read-state.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and writes only to
 * wla_* tables. Local JSON is read once to seed empty tables, never as a
 * runtime fallback. Independent of Blackbaud hydrate / dashboard-data.json.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as supabaseStore from './supabaseStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');

function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function jsonGetAllComments() {
  const data = readJson('comments.json', { byAssignment: {} });
  return data.byAssignment || {};
}

function jsonGetCompletions() {
  const data = readJson('completions.json', { byAssignment: {} });
  return data.byAssignment || {};
}

function jsonGetMissingAcks() {
  const data = readJson('missing-acks.json', { byKey: {} });
  return data.byKey || {};
}

let seedAttempted = false;
async function maybeSeedSupabase() {
  supabaseStore.requireConfigured();
  if (seedAttempted) return;
  seedAttempted = true;
  try {
    await supabaseStore.seedIfEmpty({
      comments: jsonGetAllComments(),
      acks: jsonGetMissingAcks(),
      notifications: readJson('notifications.json', { items: [] }).items || [],
      completions: jsonGetCompletions(),
      readState: readJson('read-state.json', { byUser: {} }).byUser || {}
    });
  } catch (err) {
    console.warn('[familyStore] Supabase seed skipped:', err.message);
  }
}

async function withSupabase(fn) {
  supabaseStore.requireConfigured();
  await maybeSeedSupabase();
  return fn();
}

export async function getAllComments() {
  return withSupabase(() => supabaseStore.getAllComments());
}

export async function getComments(assignmentId) {
  if (!assignmentId) return [];
  return withSupabase(() => supabaseStore.getComments(assignmentId));
}

export async function addComment(assignmentId, comment) {
  const existing = await getComments(assignmentId);
  if (comment?.id && existing.some((c) => c.id === comment.id)) {
    return existing.find((c) => c.id === comment.id);
  }
  const row = {
    id: comment.id || `comm_${crypto.randomUUID()}`,
    author: comment.author,
    authorKey: comment.authorKey || null,
    authorUserId: comment.authorUserId || null,
    authorPhoto: comment.authorPhoto || null,
    role: comment.role || null,
    text: comment.text,
    timestamp: comment.timestamp
      || (new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        + ' at '
        + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
    createdAt: new Date().toISOString()
  };
  return withSupabase(() => supabaseStore.addComment(assignmentId, row));
}

export async function deleteComment(assignmentId, commentId, identity) {
  const list = await getComments(assignmentId);
  const target = list.find((c) => c.id === commentId);
  if (!target) return { ok: false, reason: 'not_found' };
  const isAuthor = (
    (target.authorKey && target.authorKey === identity?.userKey)
    || (target.authorUserId && identity?.userId && Number(target.authorUserId) === Number(identity.userId))
    || (target.author && identity?.displayName && target.author === identity.displayName)
  );
  const isParent = identity?.role === 'parent';
  if (!isAuthor && !isParent) return { ok: false, reason: 'forbidden' };
  await withSupabase(() => supabaseStore.deleteComment(assignmentId, commentId));
  return { ok: true };
}

export async function getCompletions() {
  return withSupabase(() => supabaseStore.getCompletions());
}

export async function setCompletion(assignmentId, doneOverride, identity) {
  return withSupabase(() => supabaseStore.setCompletion(assignmentId, doneOverride, identity));
}

export async function ingestDoneOverrides(lists = [], identity) {
  const items = (lists || []).flat().filter((item) => item?.id && item.doneOverride === true);
  for (const item of items) {
    await setCompletion(item.id, true, identity);
  }
}

function identityLabel(identity) {
  const key = String(identity?.userKey || '').toLowerCase();
  if (key === 'eric') return 'Eric';
  if (key === 'stefani') return 'Stefani';
  if (key === 'ben') return 'Ben';
  if (key === 'jade') return 'Jade';
  const name = String(identity?.displayName || identity?.firstName || identity?.accountName || '').trim();
  return name.split(/\s+/)[0] || 'Family';
}

export function missingAckKey(assignmentId, student) {
  const id = String(assignmentId || '');
  const who = String(student || '').trim();
  return who ? `${id}::${who}` : id;
}

export async function getMissingAcks() {
  return withSupabase(() => supabaseStore.getMissingAcks());
}

export async function lookupMissingAck(assignmentId, student) {
  if (!assignmentId) return null;
  const byKey = await getMissingAcks();
  return byKey[missingAckKey(assignmentId, student)] || byKey[assignmentId] || null;
}

export async function isMissingAcked(assignmentId, student) {
  const ack = await lookupMissingAck(assignmentId, student);
  return ack?.acknowledged === true;
}

export async function setMissingAck(assignmentId, acknowledged, identity, extra = {}) {
  const student = extra.student || null;
  const key = missingAckKey(assignmentId, student);
  const now = new Date().toISOString();
  const on = Boolean(acknowledged);
  const row = {
    assignmentId,
    student,
    acknowledged: on,
    acknowledgedAt: on ? now : null,
    acknowledgedBy: on ? identityLabel(identity) : null,
    acknowledgedByKey: on ? (identity?.userKey || null) : null,
    acknowledgedByUserId: on ? (identity?.userId || null) : null,
    acknowledgedByPhoto: on ? (identity?.photoUrl || null) : null,
    role: identity?.role || null,
    updatedAt: now
  };
  return withSupabase(() => supabaseStore.setMissingAck(key, assignmentId, row));
}

/**
 * Family comments live in wla_assignment_comments, not Blackbaud.
 * Prefer the family store when an assignment id has been seen;
 * otherwise migrate inline comments from dashboard-data.json.
 * Merge is add-only so a sync with empty comments[] cannot wipe the thread.
 */
export async function overlayFamilyComments(assignments = []) {
  const byAssignment = await getAllComments();
  let dirty = false;
  const out = (assignments || []).map((a) => {
    if (!a?.id) return a;
    const hasStored = Object.prototype.hasOwnProperty.call(byAssignment, a.id);
    const stored = hasStored ? (byAssignment[a.id] || []) : [];
    const inline = Array.isArray(a.comments) ? a.comments : [];
    if (hasStored) {
      if (inline.length) {
        const map = new Map(stored.map((c) => [c.id, c]));
        let added = false;
        for (const c of inline) {
          if (c?.id && !map.has(c.id)) {
            map.set(c.id, c);
            added = true;
          }
        }
        if (added) {
          byAssignment[a.id] = [...map.values()];
          dirty = true;
        }
      }
      return { ...a, comments: byAssignment[a.id] || [] };
    }
    if (inline.length) {
      byAssignment[a.id] = inline;
      dirty = true;
      return { ...a, comments: inline };
    }
    return { ...a, comments: [] };
  });
  if (dirty) {
    await withSupabase(async () => {
      for (const [assignmentId, list] of Object.entries(byAssignment)) {
        if (list?.length) await supabaseStore.upsertComments(assignmentId, list);
      }
    });
  }
  return out;
}

export async function ingestClientComments(lists = []) {
  await overlayFamilyComments((lists || []).flat().filter(Boolean));
}

export async function annotateAssignments(assignments = []) {
  const completions = await getCompletions();
  const acks = await getMissingAcks();
  return (await overlayFamilyComments(assignments)).map((a) => {
    if (!a?.id) return a;
    const override = completions[a.id];
    const ack = acks[missingAckKey(a.id, a.student)] || acks[a.id] || null;
    const acked = ack?.acknowledged === true;
    const doneOverride = acked || Boolean(override?.doneOverride);
    return {
      ...a,
      doneOverride,
      completed: doneOverride || a.completed,
      done: doneOverride || a.done,
      missingAck: ack,
      acknowledged: acked,
      acknowledgedAt: acked ? ack.acknowledgedAt : null,
      acknowledgedBy: acked ? ack.acknowledgedBy : null,
      acknowledgedByKey: acked ? ack.acknowledgedByKey : null
    };
  });
}

function notificationVisible(item, identity) {
  if (!identity) return false;
  const key = String(identity.userKey || '').toLowerCase();
  const recipients = (item.recipientKeys || []).map((k) => String(k).toLowerCase());
  if (identity.role === 'parent') {
    return item.audience === 'parents' || recipients.includes(key);
  }
  return recipients.includes(key) || String(item.student || '').toLowerCase() === key;
}

async function loadNotificationItems() {
  return withSupabase(() => supabaseStore.getNotificationItems());
}

export async function getNotifications(identity) {
  const items = await loadNotificationItems();
  return items.filter((item) => notificationVisible(item, identity));
}

export async function addNotifications(rows) {
  if (!rows?.length) return [];
  return withSupabase(() => supabaseStore.addNotifications(rows));
}

export async function markNotificationRead(id, identity) {
  const items = await loadNotificationItems();
  const target = items.find((item) => item.id === id && notificationVisible(item, identity));
  if (!target) return false;
  const readAt = new Date().toISOString();
  await withSupabase(() => supabaseStore.updateNotifications([id], { read: true, readAt }));
  return true;
}

export async function markAllNotificationsRead(identity) {
  const items = await loadNotificationItems();
  const now = new Date().toISOString();
  const ids = items.filter((item) => notificationVisible(item, identity) && !item.read).map((item) => item.id);
  if (ids.length) {
    await withSupabase(() => supabaseStore.updateNotifications(ids, { read: true, readAt: now }));
  }
  return getNotifications(identity);
}

export async function markNotificationsForAssignment(assignmentId, identity) {
  if (!assignmentId) return getNotifications(identity);
  const items = await loadNotificationItems();
  const now = new Date().toISOString();
  const ids = items
    .filter((item) => item.assignmentId === assignmentId && notificationVisible(item, identity) && !item.read)
    .map((item) => item.id);
  if (ids.length) {
    await withSupabase(() => supabaseStore.updateNotifications(ids, { read: true, readAt: now }));
  }
  return getNotifications(identity);
}

function readUserKey(identity) {
  return String(identity?.userKey || identity?.userId || 'family').toLowerCase() || 'family';
}

export function feedReadKey(feed, itemId) {
  return `${String(feed || 'post')}:${String(itemId || '')}`;
}

export async function getReadMap(identity) {
  const userKey = readUserKey(identity);
  return withSupabase(() => supabaseStore.getReadMap(userKey));
}

export async function setItemReadState(identity, { feed, itemId, read }) {
  const id = String(itemId || '').trim();
  if (!id) return null;
  const userKey = readUserKey(identity);
  const key = feedReadKey(feed, id);
  const now = new Date().toISOString();
  const on = Boolean(read);
  return withSupabase(() => supabaseStore.setItemReadState(userKey, {
    feed: String(feed || 'post'),
    itemId: id,
    feedKey: key,
    read: on,
    readAt: on ? now : null,
    updatedAt: now
  }));
}

export async function overlayItemReadState(items, identity, { defaultUnread = false } = {}) {
  const map = await getReadMap(identity);
  return (items || []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const key = feedReadKey(item.feed || item.kind, item.id);
    const row = map[key];
    if (row && typeof row.read === 'boolean') {
      return { ...item, viewed: row.read, readAt: row.readAt || null };
    }
    if (defaultUnread && item.viewed == null) {
      return { ...item, viewed: false };
    }
    return item;
  });
}

export async function notifyForFamilyComment({ assignment, comment, authorKey }) {
  if (!assignment?.id) return [];
  const student = assignment.student;
  const key = String(authorKey || '').toLowerCase();
  const isParentAuthor = key === 'eric' || key === 'stefani' || comment.role === 'parent';
  const isStudentAuthor = key === 'ben' || key === 'jade';
  const now = new Date().toISOString();
  const parentWho = key === 'stefani' ? 'Mom' : key === 'eric' ? 'Dad' : (comment.author || 'A parent');
  const authorName = comment.author || (isStudentAuthor ? student : parentWho);
  const base = {
    id: `ntf_${crypto.randomUUID()}`,
    type: 'comment',
    assignmentId: assignment.id,
    title: assignment.title,
    student,
    author: authorName,
    authorKey: key || null,
    read: false,
    createdAt: now,
    preview: String(comment.text || '').slice(0, 140)
  };
  if (isParentAuthor && (student === 'Ben' || student === 'Jade')) {
    return addNotifications([{
      ...base,
      message: `${parentWho} commented on ${assignment.title}`,
      recipientKeys: [student.toLowerCase()],
      audience: 'student'
    }]);
  }
  if (isStudentAuthor) {
    return addNotifications([{
      ...base,
      type: 'reply',
      message: `${authorName} replied on ${assignment.title}`,
      recipientKeys: ['eric', 'stefani'],
      audience: 'parents'
    }]);
  }
  return [];
}
