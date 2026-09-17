/**
 * Durable local family store (the DB for this Mac app):
 * comments.json, notifications.json, completions.json.
 * Independent of Blackbaud hydrate / dashboard-data.json sync.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

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

function writeJson(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `${name}.tmp`);
  const dest = path.join(DATA_DIR, name);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, dest);
}

export function getAllComments() {
  const data = readJson('comments.json', { byAssignment: {} });
  return data.byAssignment || {};
}

export function getComments(assignmentId) {
  if (!assignmentId) return [];
  return getAllComments()[assignmentId] || [];
}

export function addComment(assignmentId, comment) {
  const byAssignment = getAllComments();
  const list = byAssignment[assignmentId] || [];
  if (comment?.id && list.some((c) => c.id === comment.id)) {
    return list.find((c) => c.id === comment.id);
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
  byAssignment[assignmentId] = [...list, row];
  writeJson('comments.json', { byAssignment, updatedAt: new Date().toISOString() });
  return row;
}

export function deleteComment(assignmentId, commentId, identity) {
  const byAssignment = getAllComments();
  const list = byAssignment[assignmentId] || [];
  const target = list.find((c) => c.id === commentId);
  if (!target) return { ok: false, reason: 'not_found' };
  const isAuthor = (
    (target.authorKey && target.authorKey === identity?.userKey)
    || (target.authorUserId && identity?.userId && Number(target.authorUserId) === Number(identity.userId))
    || (target.author && identity?.displayName && target.author === identity.displayName)
  );
  const isParent = identity?.role === 'parent';
  if (!isAuthor && !isParent) return { ok: false, reason: 'forbidden' };
  byAssignment[assignmentId] = list.filter((c) => c.id !== commentId);
  writeJson('comments.json', { byAssignment, updatedAt: new Date().toISOString() });
  return { ok: true };
}

export function getCompletions() {
  const data = readJson('completions.json', { byAssignment: {} });
  return data.byAssignment || {};
}

export function setCompletion(assignmentId, doneOverride, identity) {
  const byAssignment = getCompletions();
  byAssignment[assignmentId] = {
    doneOverride: Boolean(doneOverride),
    updatedAt: new Date().toISOString(),
    userKey: identity?.userKey || null
  };
  writeJson('completions.json', { byAssignment, updatedAt: new Date().toISOString() });
  return byAssignment[assignmentId];
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

export function getMissingAcks() {
  const data = readJson('missing-acks.json', { byKey: {} });
  return data.byKey || {};
}

export function lookupMissingAck(assignmentId, student) {
  if (!assignmentId) return null;
  const byKey = getMissingAcks();
  return byKey[missingAckKey(assignmentId, student)] || byKey[assignmentId] || null;
}

export function isMissingAcked(assignmentId, student) {
  return lookupMissingAck(assignmentId, student)?.acknowledged === true;
}

export function setMissingAck(assignmentId, acknowledged, identity, extra = {}) {
  const data = readJson('missing-acks.json', { byKey: {} });
  const byKey = data.byKey || {};
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
  byKey[key] = row;
  if (assignmentId && key !== assignmentId) byKey[assignmentId] = row;
  writeJson('missing-acks.json', { byKey, updatedAt: now });
  return row;
}

/**
 * Family comments live in comments.json, not Blackbaud.
 * Prefer the family store when an assignment id has been seen;
 * otherwise migrate inline comments from dashboard-data.json.
 * Merge is add-only so a sync with empty comments[] cannot wipe the thread.
 */
export function overlayFamilyComments(assignments = []) {
  const byAssignment = getAllComments();
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
    writeJson('comments.json', { byAssignment, updatedAt: new Date().toISOString() });
  }
  return out;
}

export function ingestClientComments(lists = []) {
  overlayFamilyComments((lists || []).flat().filter(Boolean));
}

export function annotateAssignments(assignments = []) {
  const completions = getCompletions();
  const acks = getMissingAcks();
  return overlayFamilyComments(assignments).map((a) => {
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

export function getNotifications(identity) {
  const data = readJson('notifications.json', { items: [] });
  return (data.items || []).filter((item) => notificationVisible(item, identity));
}

export function addNotifications(rows) {
  if (!rows?.length) return [];
  const data = readJson('notifications.json', { items: [] });
  data.items = [...rows, ...(data.items || [])].slice(0, 400);
  writeJson('notifications.json', data);
  return rows;
}

export function markNotificationRead(id, identity) {
  const data = readJson('notifications.json', { items: [] });
  let changed = false;
  data.items = (data.items || []).map((item) => {
    if (item.id !== id) return item;
    if (!notificationVisible(item, identity)) return item;
    changed = true;
    return { ...item, read: true, readAt: new Date().toISOString() };
  });
  if (changed) writeJson('notifications.json', data);
  return changed;
}

export function markAllNotificationsRead(identity) {
  const data = readJson('notifications.json', { items: [] });
  data.items = (data.items || []).map((item) => (
    notificationVisible(item, identity)
      ? { ...item, read: true, readAt: item.readAt || new Date().toISOString() }
      : item
  ));
  writeJson('notifications.json', data);
  return getNotifications(identity);
}

export function markNotificationsForAssignment(assignmentId, identity) {
  if (!assignmentId) return getNotifications(identity);
  const data = readJson('notifications.json', { items: [] });
  data.items = (data.items || []).map((item) => {
    if (item.assignmentId !== assignmentId) return item;
    if (!notificationVisible(item, identity)) return item;
    if (item.read) return item;
    return { ...item, read: true, readAt: new Date().toISOString() };
  });
  writeJson('notifications.json', data);
  return getNotifications(identity);
}

export function notifyForFamilyComment({ assignment, comment, authorKey }) {
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
