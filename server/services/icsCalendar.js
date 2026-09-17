export const TZ = 'America/Chicago';
export const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** webcal:// and https:// are the same ICS feed. */
export function toHttpsCalendarUrl(url, fallback = '') {
  const raw = String(url || fallback).trim();
  if (!raw) return fallback;
  return raw.replace(/^webcal:/i, 'https:');
}

export function unfoldIcs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');
}

export function unescapeIcs(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

export function parseIcsDate(raw) {
  const value = String(raw || '').trim();
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh) {
    return {
      date: new Date(`${y}-${mo}-${d}T12:00:00`),
      allDay: true
    };
  }
  if (z === 'Z') {
    return {
      date: new Date(Date.UTC(
        Number(y), Number(mo) - 1, Number(d),
        Number(hh), Number(mm), Number(ss)
      )),
      allDay: false
    };
  }
  return {
    date: new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}`),
    allDay: false
  };
}

export function formatWhen(parsed, allDay) {
  if (!parsed) {
    return { date: '', time: '', sortAt: 0 };
  }
  const date = parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TZ
  });
  if (allDay) {
    return { date, time: 'All day', sortAt: parsed.getTime() };
  }
  const time = parsed.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ
  });
  return { date, time, sortAt: parsed.getTime() };
}

function icsPropValue(line) {
  const idx = line.indexOf(':');
  if (idx < 1) return null;
  const key = line.slice(0, idx).split(';')[0].toUpperCase();
  return { key, value: unescapeIcs(line.slice(idx + 1)) };
}

export function parseVEventProps(block) {
  const props = {};
  for (const line of String(block || '').split('\n')) {
    const parsed = icsPropValue(line);
    if (!parsed) continue;
    props[parsed.key] = parsed.value;
  }
  return props;
}

export function parseVEventBlocks(icsText) {
  const unfolded = unfoldIcs(icsText);
  return unfolded.split(/BEGIN:VEVENT/i).slice(1).map((chunk) => chunk.split(/END:VEVENT/i)[0]);
}

export function startOfTodayChicago() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00`).getTime();
}

export function upcomingFromToday(events) {
  const today = startOfTodayChicago();
  return (events || []).filter((event) => (event.endAt || event.sortAt) >= today);
}

export async function fetchIcsText(url, label = 'calendar') {
  const href = toHttpsCalendarUrl(url);
  if (!href) {
    throw new Error(`${label} URL is missing`);
  }
  const res = await fetch(href, {
    headers: {
      Accept: 'text/calendar, text/plain, */*',
      'User-Agent': CHROME_UA
    },
    redirect: 'follow'
  });
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error(`${label} did not return ICS`);
  }
  return text;
}
