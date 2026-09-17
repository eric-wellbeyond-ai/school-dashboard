import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(value, count) {
  const d = new Date(value);
  d.setDate(d.getDate() + count);
  return d;
}

function startOfWeek(value) {
  const d = startOfDay(value);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function ymd(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function eventInstant(event) {
  if (Number.isFinite(event?.sortAt) && event.sortAt > 0) return new Date(event.sortAt);
  if (event?.emailDate) {
    const fromEmail = new Date(event.emailDate);
    if (!Number.isNaN(fromEmail.getTime())) return fromEmail;
  }
  const stamp = `${event?.date || ''} ${event?.allDay ? '' : (event?.time || '')}`.replace('All day', '').trim();
  const parsed = Date.parse(stamp);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  const dateOnly = Date.parse(event?.date || '');
  if (!Number.isNaN(dateOnly)) return new Date(dateOnly);
  return null;
}

function eventColor(event) {
  if (event.student === 'Jade') return 'bg-violet-500/80 text-white';
  if (event.student === 'Ben') return 'bg-sky-500/80 text-white';
  return 'bg-amber-500/90 text-zinc-950';
}

function decode(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function eventsByDay(events) {
  const map = new Map();
  for (const event of events) {
    const instant = eventInstant(event);
    if (!instant) continue;
    const key = ymd(instant);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ ...event, _instant: instant });
  }
  for (const list of map.values()) {
    list.sort((a, b) => a._instant - b._instant);
  }
  return map;
}

function rangeLabel(mode, cursor) {
  if (mode === 'month') {
    return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (mode === 'week') {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    const opts = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
  }
  return cursor.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function shiftCursor(mode, cursor, dir) {
  const next = new Date(cursor);
  if (mode === 'month') next.setMonth(next.getMonth() + dir);
  else if (mode === 'week') next.setDate(next.getDate() + (7 * dir));
  else next.setDate(next.getDate() + dir);
  return startOfDay(next);
}

function EventChip({ event, onSelect, compact = false }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(event);
      }}
      className={`w-full text-left rounded-md px-1.5 ${compact ? 'py-0.5 text-[11px] min-h-6' : 'py-1 text-[12px] min-h-7'} font-medium truncate ${eventColor(event)}`}
      title={`${event.time || ''} ${decode(event.title)}`.trim()}
    >
      {!compact && event.time && event.time !== 'All day' ? (
        <span className="opacity-90 mr-1">{event.time}</span>
      ) : null}
      {decode(event.title)}
    </button>
  );
}

export default function CalendarBoard({ events, onSelect }) {
  const [mode, setMode] = useState('month');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const today = startOfDay(new Date());
  const grouped = useMemo(() => eventsByDay(events), [events]);

  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const dayEvents = grouped.get(ymd(cursor)) || [];

  const selectEvent = typeof onSelect === 'function' ? onSelect : () => {};

  return (
    <div className="wla-calendar mt-4 min-h-[28rem]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Previous" onClick={() => setCursor((d) => shiftCursor(mode, d, -1))}>
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCursor(startOfDay(new Date()))}>
            Today
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Next" onClick={() => setCursor((d) => shiftCursor(mode, d, 1))}>
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
          <h3 className="ml-2 text-[15px] font-semibold tracking-tight text-zinc-50">{rangeLabel(mode, cursor)}</h3>
        </div>
        <div className="join" role="radiogroup" aria-label="Calendar view">
          {['month', 'week', 'day'].map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              className={`btn btn-sm join-item ${mode === id ? 'btn-active' : ''}`}
              onClick={() => setMode(id)}
            >
              {id[0].toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {mode === 'month' && (
        <div className="wla-calendar-board">
          <div className="grid grid-cols-7 bg-zinc-900 border-b border-zinc-800">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-2 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400 text-center">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthCells.map((day) => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = sameDay(day, today);
              const list = grouped.get(ymd(day)) || [];
              const extra = list.length - 3;
              return (
                <div
                  key={ymd(day)}
                  className={`min-h-[7.5rem] p-1.5 text-left border-t border-r border-zinc-800 ${inMonth ? 'bg-zinc-950' : 'bg-zinc-950/50'} ${isToday ? 'ring-1 ring-inset ring-blue-500' : ''}`}
                >
                  <button
                    type="button"
                    className={`inline-flex w-7 h-7 items-center justify-center rounded-full text-[13px] font-semibold ${isToday ? 'bg-blue-600 text-white' : inMonth ? 'text-zinc-200' : 'text-zinc-500'}`}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={`Open ${day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}
                    onClick={() => {
                      setCursor(startOfDay(day));
                      setMode('day');
                    }}
                  >
                    {day.getDate()}
                  </button>
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, 3).map((event) => (
                      <EventChip key={event.id} event={event} onSelect={selectEvent} compact />
                    ))}
                    {extra > 0 && (
                      <button
                        type="button"
                        className="block w-full text-left text-[11px] text-zinc-400 px-1 min-h-6"
                        onClick={() => {
                          setCursor(startOfDay(day));
                          setMode('day');
                        }}
                      >
                        +{extra} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'week' && (
        <div className="wla-calendar-board">
          <div className="grid grid-cols-7">
            {weekDays.map((day) => {
              const isToday = sameDay(day, today);
              const list = grouped.get(ymd(day)) || [];
              return (
                <div key={ymd(day)} className="border-r border-zinc-800 last:border-r-0 min-h-[22rem]">
                  <button
                    type="button"
                    className={`w-full px-2 py-2.5 border-b border-zinc-800 text-center ${isToday ? 'bg-blue-600/15' : 'bg-zinc-900'}`}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => {
                      setCursor(startOfDay(day));
                      setMode('day');
                    }}
                  >
                    <div className="text-[11px] uppercase tracking-[0.06em] text-zinc-400">{WEEKDAYS[day.getDay()]}</div>
                    <div className={`text-sm font-semibold ${isToday ? 'text-blue-400' : 'text-zinc-100'}`}>{day.getDate()}</div>
                  </button>
                  <div className="p-1.5 space-y-1">
                    {list.length === 0 ? (
                      <p className="text-[11px] text-zinc-500 px-1 py-2">No events</p>
                    ) : list.map((event) => (
                      <EventChip key={event.id} event={event} onSelect={selectEvent} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'day' && (
        <div className="wla-calendar-board bg-zinc-950">
          {dayEvents.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-16">No events this day</p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {dayEvents.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => selectEvent(event)}
                    className="w-full flex items-start gap-4 text-left px-4 py-3 hover:bg-zinc-900"
                  >
                    <div className="w-20 shrink-0 text-[13px] tabular-nums text-zinc-400 pt-0.5">
                      {event.time || 'All day'}
                    </div>
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${eventColor(event).split(' ')[0]}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{decode(event.title)}</p>
                      <p className="text-[12px] text-zinc-400 mt-0.5">
                        {event.student === 'All' ? 'Ben & Jade' : event.student}
                        {event.sport ? ` · ${event.sport}` : ''}
                        {event.location ? ` · ${decode(event.location)}` : ''}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
