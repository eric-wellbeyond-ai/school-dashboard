/**
 * Supabase persistence for the Westlake family dashboard.
 * Uses service role on the Express server only. Never import this from the browser.
 * Tables are wla_* in project aiden-wellbeyond-ais; existing product tables are unused.
 */

import { createClient } from '@supabase/supabase-js';

const TABLES = {
  comments: 'wla_assignment_comments',
  acks: 'wla_missing_acks',
  notifications: 'wla_notifications',
  readState: 'wla_read_state',
  done: 'wla_done_overrides'
};

let client = null;

export function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getServiceClient() {
  if (!isConfigured()) return null;
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

function requireClient() {
  const sb = getServiceClient();
  if (!sb) throw new Error('Supabase is not configured');
  return sb;
}

function throwIf(error) {
  if (error) throw error;
}

function commentFromRow(row) {
  return {
    id: row.id,
    author: row.author,
    authorKey: row.author_key || null,
    authorUserId: row.author_user_id || null,
    authorPhoto: row.author_photo || null,
    role: row.role || null,
    text: row.body || '',
    timestamp: row.timestamp || null,
    createdAt: row.created_at || null
  };
}

function commentToRow(assignmentId, comment) {
  return {
    id: comment.id,
    assignment_id: assignmentId,
    author: comment.author || null,
    author_key: comment.authorKey || null,
    author_user_id: comment.authorUserId != null ? String(comment.authorUserId) : null,
    author_photo: comment.authorPhoto || null,
    role: comment.role || null,
    body: comment.text || '',
    timestamp: comment.timestamp || null,
    created_at: comment.createdAt || new Date().toISOString()
  };
}

function ackFromRow(row) {
  return {
    assignmentId: row.assignment_id,
    student: row.student || null,
    acknowledged: row.acknowledged === true,
    acknowledgedAt: row.acknowledged_at || null,
    acknowledgedBy: row.acknowledged_by || null,
    acknowledgedByKey: row.acknowledged_by_key || null,
    acknowledgedByUserId: row.acknowledged_by_user_id || null,
    acknowledgedByPhoto: row.acknowledged_by_photo || null,
    role: row.role || null,
    updatedAt: row.updated_at || null
  };
}

function ackToRow(ackKey, row) {
  return {
    ack_key: ackKey,
    assignment_id: row.assignmentId,
    student: row.student || null,
    acknowledged: row.acknowledged === true,
    acknowledged_at: row.acknowledgedAt || null,
    acknowledged_by: row.acknowledgedBy || null,
    acknowledged_by_key: row.acknowledgedByKey || null,
    acknowledged_by_user_id: row.acknowledgedByUserId != null ? String(row.acknowledgedByUserId) : null,
    acknowledged_by_photo: row.acknowledgedByPhoto || null,
    role: row.role || null,
    updated_at: row.updatedAt || new Date().toISOString()
  };
}

function notificationFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    assignmentId: row.assignment_id,
    title: row.title,
    student: row.student,
    author: row.author,
    authorKey: row.author_key,
    message: row.message,
    preview: row.preview,
    recipientKeys: Array.isArray(row.recipient_keys) ? row.recipient_keys : [],
    audience: row.audience,
    read: row.read === true,
    readAt: row.read_at || null,
    createdAt: row.created_at
  };
}

function notificationToRow(item) {
  return {
    id: item.id,
    type: item.type || null,
    assignment_id: item.assignmentId || null,
    title: item.title || null,
    student: item.student || null,
    author: item.author || null,
    author_key: item.authorKey || null,
    message: item.message || null,
    preview: item.preview || null,
    recipient_keys: Array.isArray(item.recipientKeys) ? item.recipientKeys : [],
    audience: item.audience || null,
    read: item.read === true,
    read_at: item.readAt || null,
    created_at: item.createdAt || new Date().toISOString()
  };
}

export async function getAllComments() {
  const { data, error } = await requireClient()
    .from(TABLES.comments)
    .select('*')
    .order('created_at', { ascending: true });
  throwIf(error);
  const byAssignment = {};
  for (const row of data || []) {
    const id = row.assignment_id;
    if (!byAssignment[id]) byAssignment[id] = [];
    byAssignment[id].push(commentFromRow(row));
  }
  return byAssignment;
}

export async function getComments(assignmentId) {
  if (!assignmentId) return [];
  const { data, error } = await requireClient()
    .from(TABLES.comments)
    .select('*')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: true });
  throwIf(error);
  return (data || []).map(commentFromRow);
}

export async function addComment(assignmentId, comment) {
  const { data, error } = await requireClient()
    .from(TABLES.comments)
    .upsert(commentToRow(assignmentId, comment), { onConflict: 'id' })
    .select('*')
    .single();
  throwIf(error);
  return commentFromRow(data);
}

export async function deleteComment(assignmentId, commentId) {
  const { error } = await requireClient()
    .from(TABLES.comments)
    .delete()
    .eq('id', commentId)
    .eq('assignment_id', assignmentId);
  throwIf(error);
}

export async function upsertComments(assignmentId, comments) {
  if (!assignmentId || !comments?.length) return;
  const { error } = await requireClient()
    .from(TABLES.comments)
    .upsert(comments.map((c) => commentToRow(assignmentId, c)), { onConflict: 'id' });
  throwIf(error);
}

export async function getCompletions() {
  const { data, error } = await requireClient().from(TABLES.done).select('*');
  throwIf(error);
  const byAssignment = {};
  for (const row of data || []) {
    byAssignment[row.assignment_id] = {
      doneOverride: row.done_override === true,
      updatedAt: row.updated_at,
      userKey: row.user_key || null
    };
  }
  return byAssignment;
}

export async function setCompletion(assignmentId, doneOverride, identity) {
  const row = {
    assignment_id: assignmentId,
    done_override: Boolean(doneOverride),
    user_key: identity?.userKey || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await requireClient()
    .from(TABLES.done)
    .upsert(row, { onConflict: 'assignment_id' })
    .select('*')
    .single();
  throwIf(error);
  return {
    doneOverride: data.done_override === true,
    updatedAt: data.updated_at,
    userKey: data.user_key || null
  };
}

export async function getMissingAcks() {
  const { data, error } = await requireClient().from(TABLES.acks).select('*');
  throwIf(error);
  const byKey = {};
  for (const row of data || []) {
    byKey[row.ack_key] = ackFromRow(row);
  }
  return byKey;
}

export async function setMissingAck(ackKey, assignmentId, row) {
  const payload = [ackToRow(ackKey, row)];
  if (assignmentId && ackKey !== assignmentId) {
    payload.push(ackToRow(assignmentId, row));
  }
  const { error } = await requireClient()
    .from(TABLES.acks)
    .upsert(payload, { onConflict: 'ack_key' });
  throwIf(error);
  return row;
}

export async function getNotificationItems() {
  const { data, error } = await requireClient()
    .from(TABLES.notifications)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(400);
  throwIf(error);
  return (data || []).map(notificationFromRow);
}

export async function addNotifications(rows) {
  if (!rows?.length) return [];
  const { error } = await requireClient()
    .from(TABLES.notifications)
    .upsert(rows.map(notificationToRow), { onConflict: 'id' });
  throwIf(error);
  const { count } = await requireClient()
    .from(TABLES.notifications)
    .select('id', { count: 'exact', head: true });
  if (typeof count === 'number' && count > 400) {
    const extra = count - 400;
    const { data: oldest } = await requireClient()
      .from(TABLES.notifications)
      .select('id')
      .order('created_at', { ascending: true })
      .limit(extra);
    const ids = (oldest || []).map((r) => r.id);
    if (ids.length) {
      await requireClient().from(TABLES.notifications).delete().in('id', ids);
    }
  }
  return rows;
}

export async function updateNotifications(ids, patch) {
  if (!ids?.length) return;
  const { error } = await requireClient()
    .from(TABLES.notifications)
    .update({
      read: patch.read === true,
      read_at: patch.readAt || null
    })
    .in('id', ids);
  throwIf(error);
}

export async function getReadMap(userKey) {
  const { data, error } = await requireClient()
    .from(TABLES.readState)
    .select('*')
    .eq('user_key', userKey);
  throwIf(error);
  const map = {};
  for (const row of data || []) {
    map[row.feed_key] = {
      feed: row.feed,
      itemId: row.item_id,
      read: row.read === true,
      readAt: row.read_at || null,
      updatedAt: row.updated_at
    };
  }
  return map;
}

export async function setItemReadState(userKey, { feed, itemId, feedKey, read, readAt, updatedAt }) {
  const row = {
    user_key: userKey,
    feed_key: feedKey,
    feed: feed || 'post',
    item_id: itemId,
    read: Boolean(read),
    read_at: readAt || null,
    updated_at: updatedAt || new Date().toISOString()
  };
  const { data, error } = await requireClient()
    .from(TABLES.readState)
    .upsert(row, { onConflict: 'user_key,feed_key' })
    .select('*')
    .single();
  throwIf(error);
  return {
    feed: data.feed,
    itemId: data.item_id,
    read: data.read === true,
    readAt: data.read_at || null,
    updatedAt: data.updated_at
  };
}

export async function seedIfEmpty({ comments, acks, notifications, completions, readState }) {
  const sb = requireClient();

  async function empty(table) {
    const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
    throwIf(error);
    return !count;
  }

  if (comments && Object.keys(comments).length && await empty(TABLES.comments)) {
    const rows = [];
    for (const [assignmentId, list] of Object.entries(comments)) {
      for (const comment of list || []) {
        if (comment?.id) rows.push(commentToRow(assignmentId, comment));
      }
    }
    if (rows.length) {
      const { error } = await sb.from(TABLES.comments).upsert(rows, { onConflict: 'id' });
      throwIf(error);
    }
  }

  if (acks && Object.keys(acks).length && await empty(TABLES.acks)) {
    const rows = Object.entries(acks).map(([key, row]) => ackToRow(key, row));
    const { error } = await sb.from(TABLES.acks).upsert(rows, { onConflict: 'ack_key' });
    throwIf(error);
  }

  if (notifications?.length && await empty(TABLES.notifications)) {
    const { error } = await sb.from(TABLES.notifications).upsert(
      notifications.map(notificationToRow),
      { onConflict: 'id' }
    );
    throwIf(error);
  }

  if (completions && Object.keys(completions).length && await empty(TABLES.done)) {
    const rows = Object.entries(completions).map(([assignmentId, row]) => ({
      assignment_id: assignmentId,
      done_override: Boolean(row?.doneOverride),
      user_key: row?.userKey || null,
      updated_at: row?.updatedAt || new Date().toISOString()
    }));
    const { error } = await sb.from(TABLES.done).upsert(rows, { onConflict: 'assignment_id' });
    throwIf(error);
  }

  if (readState && Object.keys(readState).length && await empty(TABLES.readState)) {
    const rows = [];
    for (const [userKey, map] of Object.entries(readState)) {
      for (const [feedKey, row] of Object.entries(map || {})) {
        rows.push({
          user_key: userKey,
          feed_key: feedKey,
          feed: row.feed || 'post',
          item_id: row.itemId,
          read: row.read === true,
          read_at: row.readAt || null,
          updated_at: row.updatedAt || new Date().toISOString()
        });
      }
    }
    if (rows.length) {
      const { error } = await sb.from(TABLES.readState).upsert(rows, { onConflict: 'user_key,feed_key' });
      throwIf(error);
    }
  }
}
