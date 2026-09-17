import {
  fetchIcsText,
  formatWhen,
  parseIcsDate,
  parseVEventBlocks,
  parseVEventProps,
  toHttpsCalendarUrl,
  upcomingFromToday
} from './icsCalendar.js';

const DEFAULT_CALENDAR_URL = 'https://westlakelutheran.myschoolapp.com/podium/feed/iCal.aspx?z=sAWHlftPEbKmx%2bvne15MbqgHtx22vL%2bqZw%2biuxcPJjA5k9VIOcKlp8BRt%2bxF1S%2fmqz8iA995hxhVMSvFpggHjA%3d%3d';

function parseVEventBlock(block) {
  const props = parseVEventProps(block);
  const summary = props.SUMMARY || '';
  if (!summary) return null;
  const start = parseIcsDate(props.DTSTART);
  const end = parseIcsDate(props.DTEND) || start;
  if (!start) return null;
  const when = formatWhen(start.date, start.allDay);
  const uid = props.UID || `${when.sortAt}-${summary}`;
  return {
    id: `inst_${uid}`,
    title: summary.replace(/\s+/g, ' ').trim(),
    student: 'All',
    sport: null,
    date: when.date,
    time: when.time,
    sortAt: when.sortAt,
    endAt: end?.date ? end.date.getTime() : when.sortAt,
    allDay: Boolean(start.allDay),
    location: (props.LOCATION || '').replace(/\s+/g, ' ').trim(),
    source: 'instructional',
    type: 'instructional',
    feed: 'calendar',
    description: props.DESCRIPTION || '',
    acknowledged: false
  };
}

export function parseInstructionalIcs(icsText) {
  const events = [];
  for (const body of parseVEventBlocks(icsText)) {
    const event = parseVEventBlock(body);
    if (event) events.push(event);
  }
  events.sort((a, b) => a.sortAt - b.sortAt);
  return events;
}

export async function fetchInstructionalCalendar(url = process.env.INSTRUCTIONAL_CALENDAR_URL || DEFAULT_CALENDAR_URL) {
  const href = toHttpsCalendarUrl(url, DEFAULT_CALENDAR_URL);
  const text = await fetchIcsText(href, 'instructional calendar');
  return upcomingFromToday(parseInstructionalIcs(text));
}
