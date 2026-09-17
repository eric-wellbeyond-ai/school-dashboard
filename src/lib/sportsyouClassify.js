export function classifySportsYouEvent(summary) {
  const s = String(summary || '').toLowerCase();
  if (s.includes('volleyball')) {
    return { sport: 'Volleyball', student: 'Jade' };
  }
  if (
    s.includes('boys bb')
    || s.includes('boys basketball')
    || s.includes("boy's basketball")
    || s.includes('hs boys')
    || /\bbb\b/.test(s)
    || s.includes('basketball')
  ) {
    return { sport: 'Boys BB', student: 'Ben' };
  }

  const isCc = (
    /\bcc\b/.test(s)
    || s.includes('cross country')
    || s.includes(' xc ')
    || s.includes('xc practice')
    || s.includes('xc classic')
    || s.includes('xc invitational')
    || s.includes('xc championship')
    || s.includes('xc meet')
    || s.includes('wildcat cc')
  );

  if (isCc) {
    const hasMs = /\bms\b/.test(s) || s.includes('middle school');
    const hasHs = /\bhs\b/.test(s) || s.includes('high school');
    if (hasMs && hasHs) return { sport: 'CC', student: 'All' };
    if (hasMs) return { sport: 'CC', student: 'Jade' };
    if (hasHs) return { sport: 'CC', student: 'Ben' };
    return { sport: 'CC', student: 'All' };
  }

  return { sport: 'Athletics', student: 'All' };
}
