/**
 * Durable family store (the DB for this Mac app):
 * comments, notifications, completions, missing-acks, read-state.
 * Prefers Supabase wla_* tables when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * are set; otherwise local JSON. Independent of Blackbaud hydrate / dashboard-data.json.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as supabaseStore from './supabaseStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');

function useSupabase() {
  return supabaseStore.isConfigured();
}

function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `${name}.tmp`);
  const dest = path.join(DATA_DIR, name);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, dest);
}

let seedAttempted = false;
async function maybeSeedSupabase() {
  if (seedAttempted || !useSupabase()) return;
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

async function withStore(sbFn, jsonFn) {
  if (useSupabase()) {
    await maybeSeedSupabase();
    try {
      return await sbFn();
    } catch (err) {
      console.warn('[familyStore] Supabase failed, using JSON fallback:', err.message);
    }
  }
  return jsonFn();
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

export async function getAllComments() {
  return withStore(() => supabaseStore.getAllComments(), () => jsonGetAllComments());
}

export async function getComments(assignmentId) {
  if (!assignmentId) return [];
  return withStore(
    () => supabaseStore.getComments(assignmentId),
    () => jsonGetAllComments()[assignmentId] || []
  );
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
  return withStore(
    () => supabaseStore.addComment(assignmentId, row),
    () => {
      const byAssignment = jsonGetAllComments();
      const list = byAssignment[assignmentId] || [];
      byAssignment[assignmentId] = [...list, row];
      writeJson('comments.json', { byAssignment, updatedAt: new Date().toISOString() });
      return row;
    }
  );
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
  await withStore(
    async () => {
      await supabaseStore.deleteComment(assignmentId, commentId);
      return true;
    },
    () => {
      const byAssignment = jsonGetAllComments();
      byAssignment[assignmentId] = (byAssignment[assignmentId] || []).filter((c) => c.id !== commentId);
      writeJson('comments.json', { byAssignment, updatedAt: new Date().toISOString() });
      return true;
    }
  );
  return { ok: true };
}

export async function getCompletions() {
  return withStore(() => supabaseStore.getCompletions(), () => jsonGetCompletions());
}

export async function setCompletion(assignmentId, doneOverride, identity) {
  return withStore(
    () => supabaseStore.setCompletion(assignmentId, doneOverride, identity),
    () => {
      const byAssignment = jsonGetCompletions();
      byAssignment[assignmentId] = {
        doneOverride: Boolean(doneOverride),
        updatedAt: new Date().toISOString(),
        userKey: identity?.userKey || null
      };
      writeJson('completions.json', { byAssignment, updatedAt: new Date().toISOString() });
      return byAssignment[assignmentId];
    }
  );
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
  return withStore(() => supabaseStore.getMissingAcks(), () => jsonGetMissingAcks());
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
  return withStore(
    () => supabaseStore.setMissingAck(key, assignmentId, row),
    () => {
      const data = readJson('missing-acks.json', { byKey: {} });
      const byKey = data.byKey || {};
      byKey[key] = row;
      if (assignmentId && key !== assignmentId) byKey[assignmentId] = row;
      writeJson('missing-acks.json', { byKey, updatedAt: now });
      return row;
    }
  );
}

/**
 * Family comments live in comments.json / wla_assignment_comments, not Blackbaud.
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
    await withStore(
      async () => {
        for (const [assignmentId, list] of Object.entries(byAssignment)) {
          if (list?.length) await supabaseStore.upsertComments(assignmentId, list);
        }
      },
      () => {
        writeJson('comments.json', { byAssignment, updatedAt: new Date().toISOString() });
      }
    );
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
  return withStore(
    () => supabaseStore.getNotificationItems(),
    () => readJson('notifications.json', { items: [] }).items || []
  );
}

export async function getNotifications(identity) {
  const items = await loadNotificationItems();
  return items.filter((item) => notificationVisible(item, identity));
}

export async function addNotifications(rows) {
  if (!rows?.length) return [];
  return withStore(
    () => supabaseStore.addNotifications(rows),
    () => {
      const data = readJson('notifications.json', { items: [] });
      data.items = [...rows, ...(data.items || [])].slice(0, 400);
      writeJson('notifications.json', data);
      return rows;
    }
  );
}

export async function markNotificationRead(id, identity) {
  const items = await loadNotificationItems();
  const target = items.find((item) => item.id === id && notificationVisible(item, identity));
  if (!target) return false;
  const readAt = new Date().toISOString();
  await withStore(
    () => supabaseStore.updateNotifications([id], { read: true, readAt }),
    () => {
      const data = readJson('notifications.json', { items: [] });
      data.items = (data.items || []).map((item) => (
        item.id === id ? { ...item, read: true, readAt } : item
      ));
      writeJson('notifications.json', data);
    }
  );
  return true;
}

export async function markAllNotificationsRead(identity) {
  const items = await loadNotificationItems();
  const now = new Date().toISOString();
  const ids = items.filter((item) => notificationVisible(item, identity) && !item.read).map((item) => item.id);
  if (ids.length) {
    await withStore(
      () => supabaseStore.updateNotifications(ids, { read: true, readAt: now }),
      () => {
        const data = readJson('notifications.json', { items: [] });
        data.items = (data.items || []).map((item) => (
          notificationVisible(item, identity)
            ? { ...item, read: true, readAt: item.readAt || now }
            : item
        ));
        writeJson('notifications.json', data);
      }
    );
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
    await withStore(
      () => supabaseStore.updateNotifications(ids, { read: true, readAt: now }),
      () => {
        const data = readJson('notifications.json', { items: [] });
        data.items = (data.items || []).map((item) => {
          if (item.assignmentId !== assignmentId) return item;
          if (!notificationVisible(item, identity)) return item;
          if (item.read) return item;
          return { ...item, read: true, readAt: now };
        });
        writeJson('notifications.json', data);
      }
    );
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
  return withStore(
    () => supabaseStore.getReadMap(userKey),
    () => {
      const data = readJson('read-state.json', { byUser: {} });
      const byUser = data.byUser || {};
      return byUser[userKey] || {};
    }
  );
}

export async function setItemReadState(identity, { feed, itemId, read }) {
  const id = String(itemId || '').trim();
  if (!id) return null;
  const userKey = readUserKey(identity);
  const key = feedReadKey(feed, id);
  const now = new Date().toISOString();
  const on = Boolean(read);
  const row = {
    feed: String(feed || 'post'),
    itemId: id,
    read: on,
    readAt: on ? now : null,
    updatedAt: now
  };
  return withStore(
    () => supabaseStore.setItemReadState(userKey, {
      feed: row.feed,
      itemId: id,
      feedKey: key,
      read: on,
      readAt: row.readAt,
      updatedAt: now
    }),
    () => {
      const data = readJson('read-state.json', { byUser: {} });
      const byUser = data.byUser || {};
      const map = { ...(byUser[userKey] || {}) };
      map[key] = row;
      byUser[userKey] = map;
      writeJson('read-state.json', { byUser, updatedAt: now });
      return map[key];
    }
  );
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
