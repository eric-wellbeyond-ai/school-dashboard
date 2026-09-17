import { classifySportsYouEvent } from '../../src/lib/sportsyouClassify.js';

export { classifySportsYouEvent };

const DEFAULT_CALENDAR_URL = 'https://calendar.sportsyou.com/access/us-0ed4570c-7c7d-4bb3-8dc6-612c8d80b1cd/101ac9b5-86d4-4a09-8b4c-afdf8d52edb5';
const TZ = 'America/Chicago';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** webcal:// and https:// are the same ICS feed. */
export function toHttpsCalendarUrl(url) {
  const raw = String(url || DEFAULT_CALENDAR_URL).trim();
  if (!raw) return DEFAULT_CALENDAR_URL;
  return raw.replace(/^webcal:/i, 'https:');
}

export function unfoldIcs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');
}

function unescapeIcs(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDate(raw) {
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

function formatWhen(parsed, allDay) {
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

function parseVEventBlock(block) {
  const props = {};
  for (const line of block.split('\n')) {
    const parsed = icsPropValue(line);
    if (!parsed) continue;
    props[parsed.key] = parsed.value;
  }
  const summary = props.SUMMARY || '';
  if (!summary) return null;
  const start = parseIcsDate(props.DTSTART);
  const end = parseIcsDate(props.DTEND) || start;
  if (!start) return null;
  const when = formatWhen(start.date, start.allDay);
  const { sport, student } = classifySportsYouEvent(summary);
  const uid = props.UID || `${when.sortAt}-${summary}`;
  return {
    id: `sy_${uid}`,
    title: summary.replace(/\s+/g, ' ').trim(),
    student,
    sport,
    date: when.date,
    time: when.time,
    sortAt: when.sortAt,
    endAt: end?.date ? end.date.getTime() : when.sortAt,
    allDay: Boolean(start.allDay),
    location: (props.LOCATION || '').replace(/\s+/g, ' ').trim() || 'TBA',
    source: 'sportsYou',
    type: 'sports',
    feed: 'calendar',
    description: props.DESCRIPTION || '',
    acknowledged: false
  };
}

export function parseSportsYouIcs(icsText) {
  const unfolded = unfoldIcs(icsText);
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const events = [];
  for (const chunk of blocks) {
    const body = chunk.split(/END:VEVENT/i)[0];
    const event = parseVEventBlock(body);
    if (event) events.push(event);
  }
  events.sort((a, b) => a.sortAt - b.sortAt);
  return events;
}

function startOfTodayChicago() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00`).getTime();
}

export async function fetchSportsYouCalendar(url = process.env.SPORTSYOU_CALENDAR_URL || DEFAULT_CALENDAR_URL) {
  const href = toHttpsCalendarUrl(url);
  const res = await fetch(href, {
    headers: {
      Accept: 'text/calendar, text/plain, */*',
      'User-Agent': CHROME_UA
    },
    redirect: 'follow'
  });
  if (!res.ok) {
    throw new Error(`sportsYou calendar HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('sportsYou calendar did not return ICS');
  }
  const events = parseSportsYouIcs(text);
  const today = startOfTodayChicago();
  return events.filter((event) => (event.endAt || event.sortAt) >= today);
}
