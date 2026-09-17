/**
 * Exclusive assignment filters: missing, done, overdue, dueSoon, assigned.
 * upcoming (future DateAssigned) is hidden until assigned.
 *
 * classifyAssignment order:
 * 1. missing — Blackbaud missing flag OR earned is exactly 0 with maxPoints > 0 (0/100),
 *    unless the family acknowledged it (doneOverride / acknowledged → done).
 * 2. done — graded (real points, letter that is not M, or earned/possible).
 *    Graded with only a creation date (no due date) is Done, not Assigned.
 * 3. assigned — ungraded and no due date (creation date only is fine).
 * 4. overdue — due before today
 * 5. upcoming — DateAssigned after today (hidden)
 * 6. dueSoon — due today through Friday of the current week
 * 7. assigned — DateAssigned is missing or has arrived
 * 8. upcoming
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

function presentCreditNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value === 'string' && value.includes('/')) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseAssignmentCredit(grade = {}) {
  if (!grade || typeof grade !== 'object') return null;
  const ratio = parseRatioScore(grade.pointsEarned)
    || parseRatioScore(grade.PointsEarned)
    || parseRatioScore(grade.score)
    || parseRatioScore(grade.Score);
  if (ratio) return ratio;
  const earned = presentCreditNumber(grade.pointsEarned ?? grade.PointsEarned);
  const possible = presentCreditNumber(grade.maxPoints ?? grade.MaxPoints);
  if (earned == null || possible == null || possible <= 0) return null;
  return { earned, possible };
}

function truthyFlag(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string' && /^(true|yes|1|missing|m)$/i.test(value.trim())) return true;
  return false;
}

const PORTAL_MISSING_KEYS = [
  'Missing',
  'IsMissing',
  'isMissing',
  'missing',
  'MissingAssignment',
  'missingAssignment',
  'MissingInd',
  'IsMissingAssignment',
  'AssignmentMissing'
];

/** Blackbaud hydrategradebook Roster.AssignmentGrades.Missing (and aliases). */
export function isPortalMissingFlag(source = {}) {
  if (!source || typeof source !== 'object') return false;
  for (const key of PORTAL_MISSING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key) && truthyFlag(source[key])) {
      return true;
    }
  }
  const letter = String(source.letter || source.Letter || source.letterGrade || '').trim().toUpperCase();
  return letter === 'M';
}

/** Portal empty work: exactly 0 earned with a positive max (0/100). Ungraded has no score. */
export function isZeroCreditMissing(grade = {}) {
  if (!grade || typeof grade !== 'object') return false;
  if (grade.Exempt === true || grade.exempt === true) return false;
  if (grade.Dropped === true || grade.dropped === true) return false;
  const credit = parseAssignmentCredit(grade);
  if (!credit) return false;
  return credit.earned === 0 && credit.possible > 0;
}

export function isMissingWork(grade = {}, explicitMissing) {
  if (explicitMissing === true) return true;
  return isPortalMissingFlag(grade) || isZeroCreditMissing(grade);
}

function hasNumericPoints(value) {
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'string' && value.trim() !== '' && !value.includes('/')) {
    return Number.isFinite(Number(value));
  }
  return false;
}

function letterGradeValue(grade = {}) {
  return String(grade.letter || grade.Letter || grade.letterGrade || '').trim();
}

export function isAssignmentGraded(grade = {}) {
  if (!grade || typeof grade !== 'object') return false;
  if (grade.Exempt === true || grade.exempt === true) return true;
  if (grade.Dropped === true || grade.dropped === true) return true;
  if (isZeroCreditMissing(grade)) return false;

  const letter = letterGradeValue(grade);
  if (letter.length > 0 && letter.toUpperCase() !== 'M') return true;

  const earned = grade.pointsEarned ?? grade.PointsEarned;
  if (hasNumericPoints(earned) && Number(earned) !== 0) return true;

  const ratio = parseRatioScore(earned)
    || parseRatioScore(grade.score)
    || parseRatioScore(grade.Score);
  if (ratio && !(ratio.earned === 0 && ratio.possible > 0)) return true;

  const possibleRaw = grade.maxPoints ?? grade.MaxPoints;
  if (earned == null || String(earned).trim() === '' || possibleRaw == null || String(possibleRaw).trim() === '') {
    return false;
  }
  const earnedNum = Number(earned);
  const possible = Number(possibleRaw);
  return Number.isFinite(earnedNum) && Number.isFinite(possible) && possible > 0 && earnedNum !== 0;
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
  acknowledged,
  isMissing,
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
  const missingWork = isMissingWork(gradeFields, isMissing === true);
  const familyDone = doneOverride === true || acknowledged === true || (
    !missingWork && (completed === true || done === true)
  );
  const isGraded = graded === true || isAssignmentGraded(gradeFields);

  // 1. Family acknowledge / mark-done forces Done even for portal missing or 0/max.
  if (familyDone) return 'done';
  // 2. Blackbaud missing flag or exact 0/max → Missing (not Done/F).
  if (missingWork) return 'missing';
  // 3. Graded (including no due date / creation date only) → Done.
  if (isGraded) return 'done';

  const today = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const assignedKey = toDateKey(assignedAt);
  const dueKey = toDateKey(dueAt);

  // 4. Ungraded, no due date (creation date only is fine) → Assigned.
  if (!dueKey) return 'assigned';
  // 5. Due before today.
  if (dueKey < today) return 'overdue';
  // 6. Future DateAssigned stays hidden until assigned.
  if (assignedKey && assignedKey > today) return 'upcoming';
  // 7. Due today through this week's Friday.
  const fridayKey = toDateKey(fridayOfCurrentWeek(now));
  if (dueKey <= fridayKey) return 'dueSoon';
  // 8. Assigned date missing or already reached.
  if (!assignedKey || assignedKey <= today) return 'assigned';
  // 9. Fallback hidden.
  return 'upcoming';
}

/** Milliseconds for checklist sort: due date, else creation/assigned date. */
export function assignmentSortValue(item) {
  if (!item || typeof item !== 'object') return Number.MAX_SAFE_INTEGER;
  const due = parsePortalDate(
    item.dueDateISO
    || item.dateDue
    || item.DateDue
    || item.SortDateDue
    || item.dueDate
  );
  if (due) return due.getTime();
  const created = parsePortalDate(
    item.createdDateISO
    || item.dateAssigned
    || item.DateAssigned
    || item.assignedDateISO
    || item.assignedDate
    || item.createdAt
    || item.CreateDate
    || item.DateCreated
  );
  return created ? created.getTime() : Number.MAX_SAFE_INTEGER;
}

/** Done: newest first. Overdue, missing, due soon, assigned: oldest first. */
export function compareChecklistAssignments(a, b, bucket) {
  const delta = assignmentSortValue(a) - assignmentSortValue(b);
  return bucket === 'done' ? -delta : delta;
}
