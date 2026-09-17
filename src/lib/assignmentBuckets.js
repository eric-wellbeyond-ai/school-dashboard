/**
 * Exclusive Blackbaud assignment buckets:
 * done → overdue (due before today) → due soon (today through this week's Friday)
 * → assigned (DateAssigned ≤ today ≤ DateDue) → upcoming (not yet assigned).
 */

export function parsePortalDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const str = String(value).trim();
  if (!str) return null;
  const mdY = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdY) {
    return new Date(Number(mdY[3]), Number(mdY[1]) - 1, Number(mdY[2]));
  }
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function toDateKey(d) {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fridayOfCurrentWeek(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + (5 - d.getDay()));
  return d;
}

export function formatAssignmentDate(value) {
  const d = value instanceof Date ? value : parsePortalDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function isAssignmentDone(grade = {}) {
  if (grade.Exempt === true || grade.exempt === true) return true;
  if (grade.Dropped === true || grade.dropped === true) return true;
  const pts = grade.pointsEarned ?? grade.PointsEarned;
  if (typeof pts === 'number' && !Number.isNaN(pts)) return true;
  const letter = String(grade.letter || grade.Letter || '').trim();
  return letter.length > 0;
}

export function classifyAssignment({ assignedAt, dueAt, done, now = new Date() }) {
  if (done) return 'done';
  const today = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const assignedKey = toDateKey(assignedAt);
  const dueKey = toDateKey(dueAt);
  if (dueKey && dueKey < today) return 'overdue';
  if (assignedKey && assignedKey > today) return 'upcoming';
  const fridayKey = toDateKey(fridayOfCurrentWeek(now));
  if (dueKey && dueKey <= fridayKey) return 'dueSoon';
  if (!assignedKey || assignedKey <= today) {
    if (!dueKey || dueKey >= today) return 'assigned';
  }
  return 'upcoming';
}

export function assignmentSortValue(item) {
  const due = parsePortalDate(item.dueDateISO || item.dueDate);
  return due ? due.getTime() : Number.MAX_SAFE_INTEGER;
}
