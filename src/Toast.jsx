import React from 'react';
import { AlertCircle, CheckCircle2, Info, MessageCircle, X } from 'lucide-react';

export function parentLabel(authorKey, author) {
  const key = String(authorKey || '').toLowerCase();
  const name = String(author || '');
  if (key === 'stefani' || /stefani|stephanie/i.test(name)) return 'Mom';
  if (key === 'eric' || /^eric\b/i.test(name)) return 'Dad';
  return familyFirst(name);
}

function familyFirst(name) {
  const n = String(name || '').trim();
  if (!n) return 'Family';
  return n.split(/\s+/)[0];
}

export function incomingCommentToast(comment, assignment) {
  const title = assignment?.title || 'an assignment';
  const who = parentLabel(comment?.authorKey, comment?.author);
  if (who === 'Mom' || who === 'Dad') return `${who} commented on ${title}`;
  return `${comment?.author ? familyFirst(comment.author) : who} replied on ${title}`;
}

export function sentCommentToast(authorKey, role, student) {
  const key = String(authorKey || '').toLowerCase();
  if (key === 'ben' || key === 'jade' || role === 'student') return 'Sent to Mom and Dad';
  if (student === 'Ben' || student === 'Jade') return `Sent to ${student}`;
  return 'Comment sent';
}

export function notificationToastMessage(item) {
  if (!item) return '';
  if (item.audience === 'student' || item.type === 'comment') {
    return incomingCommentToast(
      { authorKey: item.authorKey, author: item.author },
      { title: item.title }
    );
  }
  if (item.type === 'reply' || item.audience === 'parents') {
    const who = familyFirst(item.author || item.student);
    return `${who} replied on ${item.title || 'an assignment'}`;
  }
  return item.message || '';
}

function commentKeysFrom(lists = []) {
  const keys = new Set();
  for (const item of lists) {
    if (!item?.id) continue;
    for (const comment of item.comments || []) {
      if (comment?.id) keys.add(`${item.id}:${comment.id}`);
    }
  }
  return keys;
}

export function collectNewIncomingComments(lists, knownKeys, identity) {
  const nextKeys = commentKeysFrom(lists);
  const found = [];
  if (knownKeys == null) return { keys: nextKeys, toasts: found };
  const mine = String(identity?.userKey || '').toLowerCase();
  const myName = familyFirst(identity?.displayName || identity?.accountName).toLowerCase();
  for (const item of lists) {
    for (const comment of item.comments || []) {
      const key = `${item.id}:${comment.id}`;
      if (!comment?.id || knownKeys.has(key)) continue;
      const authorKey = String(comment.authorKey || '').toLowerCase();
      if (authorKey && mine && authorKey === mine) continue;
      const authorName = familyFirst(comment.author).toLowerCase();
      if (authorName && myName && authorName === myName) continue;
      found.push({
        message: incomingCommentToast(comment, item),
        assignmentId: item.id
      });
    }
  }
  return { keys: nextKeys, toasts: found };
}

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  comment: MessageCircle
};

export function ToastViewport({ toasts, onDismiss, onActivate }) {
  if (!toasts?.length) return null;
  return (
    <div
      className="wla-toasts"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type] || Info;
        const interactive = Boolean(toast.assignmentId);
        return (
          <div
            key={toast.id}
            className={`wla-toast ${interactive ? 'is-action' : ''}`}
            role="status"
          >
            <button
              type="button"
              className="wla-toast-body"
              onClick={() => (interactive ? onActivate?.(toast) : onDismiss?.(toast.id))}
            >
              <Icon className={`wla-toast-icon is-${toast.type || 'info'}`} aria-hidden="true" />
              <span className="wla-toast-message">{toast.message}</span>
            </button>
            <button
              type="button"
              className="wla-toast-close"
              aria-label="Dismiss notification"
              onClick={() => onDismiss?.(toast.id)}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
