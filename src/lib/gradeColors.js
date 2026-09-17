/**
 * Gradeway-style bands for course grades and assignment scores.
 * Assignment color uses earned/max percent when both are finite numbers.
 */

function presentNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function assignmentPercent(earned, max) {
  const earnedN = presentNumber(earned);
  const maxN = presentNumber(max);
  if (earnedN == null || maxN == null || maxN <= 0) {
    return null;
  }
  return (earnedN / maxN) * 100;
}

export function gradeBandFromLetterOrPercent(letter, percent) {
  const initial = String(letter || '').trim().charAt(0).toUpperCase();
  if (initial === 'A') return 'a';
  if (initial === 'B') return 'b';
  if (initial === 'C') return 'c';
  if (initial === 'D') return 'd';
  if (initial === 'F') return 'f';
  const pct = typeof percent === 'number' && Number.isFinite(percent)
    ? percent
    : parseFloat(String(percent || '').replace('%', '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(pct)) return 'none';
  if (pct >= 90) return 'a';
  if (pct >= 80) return 'b';
  if (pct >= 70) return 'c';
  if (pct >= 60) return 'd';
  return 'f';
}

/** CSS classes from index.css — complete names Tailwind/DaisyUI JIT cannot strip. */
export function gradeToneClass(band) {
  if (band === 'a') return 'grade-a';
  if (band === 'b') return 'grade-b';
  if (band === 'c') return 'grade-c';
  if (band === 'd') return 'grade-d';
  if (band === 'f') return 'grade-f';
  if (band === 'missing') return 'grade-missing';
  return 'grade-none';
}
