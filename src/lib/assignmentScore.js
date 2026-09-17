/**
 * Blackbaud hydrate scores are typically pointsEarned / maxPoints (num/num).
 * Color bands use that percentage, not a letter, when the source is a ratio.
 */

import { assignmentPercent } from './gradeColors.js';

export { assignmentPercent };

export function formatAssignmentScore(pointsEarned, maxPoints) {
  const percent = assignmentPercent(pointsEarned, maxPoints);
  if (percent == null) {
    return { percent: null, percentLabel: null, raw: null };
  }
  const earned = Number(pointsEarned);
  const possible = Number(maxPoints);
  return {
    percent,
    percentLabel: `${Math.round(percent)}%`,
    raw: `${earned}/${possible}`
  };
}
