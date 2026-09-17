/**
 * Exclusive assignment filters: overdue, dueSoon, done, assigned.
 * upcoming (future DateAssigned) is hidden until assigned.
 *
 * classifyAssignment order:
 * 1. done — graded (numeric points, letter, or earned/possible num/num)
 *    or family mark-done (`completed` / `doneOverride` / `done`)
 * 2. assigned — no due date (never overdue or hidden just because due is missing)
 * 3. overdue — due before today
 * 4. upcoming — DateAssigned after today (hidden)
 * 5. dueSoon — due today through Friday of the current week
 * 6. assigned — DateAssigned is missing or has arrived
 * 7. upcoming
 *
 * Graded always wins over a missing due date.
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

function parseRatioScore(value) {
  if (value == null) return null;
  const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const earned = Number(match[1]);
  const possible = Number(match[2]);
  if (!Number.isFinite(earned) || !Number.isFinite(possible) || possible <= 0) return null;
  return { earned, possible };
}

function hasNumericPoints(value) {
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'string' && value.trim() !== '' && !value.includes('/')) {
    return Number.isFinite(Number(value));
  }
  return false;
}

export function isAssignmentGraded(grade = {}) {
  if (!grade || typeof grade !== 'object') return false;
  if (grade.Exempt === true || grade.exempt === true) return true;
  if (grade.Dropped === true || grade.dropped === true) return true;

  const letter = String(grade.letter || grade.Letter || grade.letterGrade || '').trim();
  if (letter.length > 0) return true;

  const earned = grade.pointsEarned ?? grade.PointsEarned;
  if (hasNumericPoints(earned)) return true;

  const ratio = parseRatioScore(earned)
    || parseRatioScore(grade.score)
    || parseRatioScore(grade.Score);
  if (ratio) return true;

  const possibleRaw = grade.maxPoints ?? grade.MaxPoints;
  if (earned == null || String(earned).trim() === '' || possibleRaw == null || String(possibleRaw).trim() === '') {
    return false;
  }
  const earnedNum = Number(earned);
  const possible = Number(possibleRaw);
  return Number.isFinite(earnedNum) && Number.isFinite(possible) && possible > 0;
}

export function isAssignmentDone(grade = {}) {
  return isAssignmentGraded(grade);
}

export function classifyAssignment({
  assignedAt,
  dueAt,
  done,
  graded,
  completed,
  doneOverride,
  pointsEarned,
  PointsEarned,
  maxPoints,
  MaxPoints,
  letter,
  Letter,
  letterGrade,
  grade,
  now = new Date()
} = {}) {
  const gradeFields = {
    ...(grade && typeof grade === 'object' ? grade : {}),
    pointsEarned: pointsEarned ?? PointsEarned ?? grade?.pointsEarned,
    PointsEarned: PointsEarned ?? grade?.PointsEarned,
    maxPoints: maxPoints ?? MaxPoints ?? grade?.maxPoints,
    MaxPoints: MaxPoints ?? grade?.MaxPoints,
    letter: letter ?? grade?.letter,
    Letter: Letter ?? grade?.Letter,
    letterGrade: letterGrade ?? grade?.letterGrade
  };
  const isGraded = graded === true || isAssignmentGraded(gradeFields);
  const familyDone = doneOverride === true || completed === true || done === true;

  // 1. Graded always wins (including no due date). Family mark-done also → done.
  if (isGraded || familyDone) return 'done';

  const today = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const assignedKey = toDateKey(assignedAt);
  const dueKey = toDateKey(dueAt);

  // 2. No due date → Assignments filter, never overdue/hidden.
  if (!dueKey) return 'assigned';
  // 3. Due before today.
  if (dueKey < today) return 'overdue';
  // 4. Future DateAssigned stays hidden until assigned.
  if (assignedKey && assignedKey > today) return 'upcoming';
  // 5. Due today through this week's Friday.
  const fridayKey = toDateKey(fridayOfCurrentWeek(now));
  if (dueKey <= fridayKey) return 'dueSoon';
  // 6. Assigned date missing or already reached.
  if (!assignedKey || assignedKey <= today) return 'assigned';
  // 7. Fallback hidden.
  return 'upcoming';
}

export function assignmentSortValue(item) {
  const due = parsePortalDate(item.dueDateISO || item.dueDate);
  return due ? due.getTime() : Number.MAX_SAFE_INTEGER;
}
