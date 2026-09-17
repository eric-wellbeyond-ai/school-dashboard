/**
 * Blackbaud hydrate scores are typically pointsEarned / maxPoints (num/num).
 * Color bands use that percentage, not a letter, when the source is a ratio.
 */

import { assignmentPercent } from './gradeColors.js';

export { assignmentPercent };

export function formatAssignmentScore(pointsEarned, maxPoints) {
  const percent = assignmentPercent(pointsEarned, maxPoints);
  const earned = Number(pointsEarned);
  const possible = Number(maxPoints);
  const hasRatio = Number.isFinite(earned) && Number.isFinite(possible) && possible > 0;
  return {
    percent,
    percentLabel: percent == null ? null : `${Math.round(percent)}%`,
    raw: hasRatio ? `${earned}/${possible}` : null
  };
}
