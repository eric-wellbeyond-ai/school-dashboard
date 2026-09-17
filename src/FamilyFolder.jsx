import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Folder,
  GraduationCap,
  Key,
  Link as LinkIcon,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Trophy
} from 'lucide-react';
import CalendarBoard from './CalendarBoard.jsx';
import CourseGradeList from './CourseGradeList.jsx';
import {
  assignmentPercent,
  gradeBandFromLetterOrPercent,
  gradeToneClass
} from './lib/gradeColors.js';
import { formatAssignmentScore } from './lib/assignmentScore.js';
import { isZeroCreditMissing, parsePortalDate } from './lib/assignmentBuckets.js';

const GRADE_CHIP_CLASS =
  'inline-flex min-w-[2.75rem] justify-center tabular-nums font-semibold text-[13px] px-2 py-0.5 rounded-md border';

export function ProfileAvatar({ name, photoUrl, size = 28, className = '' }) {
  const [broken, setBroken] = useState(false);
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  const dim = `${size}px`;
  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className={`avatar rounded-full object-cover shrink-0 ${className}`}
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-full shrink-0 font-semibold bg-zinc-800 text-zinc-100 ${className}`}
      style={{ width: dim, height: dim, fontSize: Math.max(11, Math.round(size * 0.4)) }}
    >
      {initial}
    </span>
  );
}

function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function firstName(name) {
  const n = String(name || '').trim();
  return n ? n.split(/\s+/)[0] : 'Family';
}

function formatAckStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSyncTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function daysLate(task) {
  const due = parsePortalDate(task?.dueDateISO || task?.dueDate);
  if (!due) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - due) / 86400000));
}

function AssignmentScoreChip({ earned, max, letter, status, className = '' }) {
  const score = formatAssignmentScore(earned, max);
  const letterText = String(letter || '').trim();
  const zeroMissing = isZeroCreditMissing({ pointsEarned: earned, maxPoints: max });
  const showMissing = status === 'missing' || (zeroMissing && status !== 'done');
  if (showMissing) {
    return (
      <span className={`inline-flex flex-col items-end gap-0.5 ${className}`}>
        <span className={`${GRADE_CHIP_CLASS} ${gradeToneClass('missing')}`}>Missing</span>
        {score.raw ? (
          <span className="text-[11px] tabular-nums text-zinc-500">{score.raw}</span>
        ) : null}
      </span>
    );
  }
  if (score.percent == null && !letterText) return null;
  const band = gradeBandFromLetterOrPercent(letterText, score.percent);
  return (
    <span className={`inline-flex flex-col items-end gap-0.5 ${className}`}>
      <span className={`${GRADE_CHIP_CLASS} ${gradeToneClass(band)}`}>
        {score.percentLabel || letterText}
      </span>
      {score.raw ? (
        <span className="text-[11px] tabular-nums text-zinc-500">{score.raw}</span>
      ) : null}
    </span>
  );
}

function statusLabel(status) {
  if (status === 'missing') return { text: 'Not turned in', className: 'is-missing' };
  if (status === 'overdue') return { text: 'Late', className: 'is-late' };
  if (status === 'dueSoon') return { text: 'Due soon', className: 'is-soon' };
  if (status === 'done') return { text: 'Done', className: 'is-done' };
  return { text: 'Assigned', className: 'is-assigned' };
}

function lateBadgeTone(days) {
  if (days >= 10) return 'is-severe';
  if (days >= 5) return 'is-mid';
  return 'is-mild';
}

export default function FamilyFolder({
  blackbaudStatus,
  isSyncingBlackbaud,
  selectedStudent,
  setSelectedStudent,
  isParentViewer,
  canSeeBen,
  canSeeJade,
  benOpenCount,
  jadeOpenCount,
  studentPhoto,
  taskFilter,
  setTaskFilter,
  checklistCounts,
  filteredTasks,
  fridayLabel,
  childLabel,
  isAddingTask,
  setIsAddingTask,
  setNewTaskStudent,
  newTaskTitle,
  setNewTaskTitle,
  newTaskStudent,
  newTaskCourse,
  setNewTaskCourse,
  newTaskDue,
  setNewTaskDue,
  onAddTask,
  onOpenTask,
  onToggleTask,
  onMissingAck,
  unreadByAssignment,
  gradeDisplay,
  setGradeDisplayMode,
  gradeGroups,
  onSelectCourse,
  filteredEvents,
  eventFilter,
  setEventFilter,
  activeEventsCount,
  acknowledgedEventsCount,
  onSelectEvent,
  calendarEventsCount,
  onRefreshBlackbaud,
  onBlackbaudSettings,
  onDisconnectBlackbaud,
  onOpenLanding,
  sportsYouConnected
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesRef = useRef(null);
  const signedInName = blackbaudStatus.displayName || blackbaudStatus.accountName || '';
  const signedFirst = firstName(signedInName);
  const blackbaudSync = formatSyncTime(blackbaudStatus.verifiedAt);
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).toUpperCase();
  const bothOpenCount = benOpenCount + jadeOpenCount;

  useEffect(() => {
    if (!sourcesOpen) return undefined;
    const onDoc = (event) => {
      if (sourcesRef.current && !sourcesRef.current.contains(event.target)) {
        setSourcesOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setSourcesOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [sourcesOpen]);

  const filterTabs = [
    { id: 'overdue', label: 'Overdue', count: checklistCounts.overdue },
    { id: 'dueSoon', label: 'Due Soon', count: checklistCounts.dueSoon },
    { id: 'assigned', label: 'Assigned', count: checklistCounts.assigned },
    { id: 'missing', label: 'Missing', count: checklistCounts.missing },
    { id: 'done', label: 'Done', count: checklistCounts.done }
  ];

  return (
    <div className="ff-shell flex-1 flex flex-col min-h-0 w-full">
      <header className="app-topbar ff-topbar">
        <div className="ff-brand">
          <span className="ff-folder-mark" aria-hidden="true">
            <Folder className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <p className="ff-brand-kicker">Family folder</p>
            <h1 className="ff-brand-title">
              Westlake Lutheran Academy
              <span className="ff-brand-term"> · Fall 2026</span>
            </h1>
          </div>
        </div>

        <div className="ff-kid-picker" role="group" aria-label="Student">
          {isParentViewer && (
            <button
              id="toggle-all"
              type="button"
              aria-pressed={selectedStudent === 'All'}
              onClick={() => setSelectedStudent('All')}
              className={`ff-kid-pill ${selectedStudent === 'All' ? 'is-active' : ''}`}
            >
              Both
              <span className="tabular-nums">{bothOpenCount}</span>
            </button>
          )}
          {canSeeBen && (
            <button
              id="toggle-ben"
              type="button"
              aria-pressed={selectedStudent === 'Ben'}
              onClick={() => setSelectedStudent('Ben')}
              className={`ff-kid-pill ${selectedStudent === 'Ben' ? 'is-active' : ''}`}
            >
              <ProfileAvatar name="Ben" photoUrl={studentPhoto('Ben')} size={18} />
              Ben
              <span className="tabular-nums">{benOpenCount}</span>
            </button>
          )}
          {canSeeJade && (
            <button
              id="toggle-jade"
              type="button"
              aria-pressed={selectedStudent === 'Jade'}
              onClick={() => setSelectedStudent('Jade')}
              className={`ff-kid-pill ${selectedStudent === 'Jade' ? 'is-active' : ''}`}
            >
              <ProfileAvatar name="Jade" photoUrl={studentPhoto('Jade')} size={18} />
              Jade
              <span className="tabular-nums">{jadeOpenCount}</span>
            </button>
          )}
        </div>

        <div className="ff-account-cluster" ref={sourcesRef}>
          {blackbaudStatus.connected && blackbaudSync ? (
            <p className="ff-sync-line">
              <span className="ff-sync-dot" aria-hidden="true" />
              Blackbaud synced {blackbaudSync}
            </p>
          ) : (
            <p className="ff-sync-line is-quiet">Not synced</p>
          )}
          <div className="ff-account">
            <div className="ff-account-who">
              <ProfileAvatar name={signedInName || 'Family'} photoUrl={blackbaudStatus.photoUrl} size={28} />
              <span className="ff-account-name">{signedFirst}</span>
            </div>
            <button
              type="button"
              className="ff-sources-toggle"
              aria-expanded={sourcesOpen}
              aria-controls="ff-sources-popover"
              onClick={() => setSourcesOpen((open) => !open)}
            >
              Sources
            </button>
          </div>
          {sourcesOpen && (
            <div id="ff-sources-popover" className="ff-sources-pop" role="dialog" aria-label="Sources and settings">
              <a
                href="https://westlakelutheran.myschoolapp.com"
                target="_blank"
                rel="noopener noreferrer"
                id="link-blackbaud"
                className="ff-source-row"
              >
                <GraduationCap className="w-4 h-4" aria-hidden="true" />
                <span>
                  <strong>Blackbaud</strong>
                  <span className="ff-source-meta">Parent portal</span>
                </span>
                <span className={`ff-source-status ${blackbaudStatus.connected ? 'is-on' : ''}`}>
                  {blackbaudStatus.connected
                    ? (blackbaudSync ? `Synced ${blackbaudSync}` : 'Connected')
                    : 'Sign in'}
                </span>
                <ExternalLink className="w-3.5 h-3.5 ff-source-ext" aria-hidden="true" />
              </a>
              <a
                href="https://www.sportsyou.com/login"
                target="_blank"
                rel="noopener noreferrer"
                id="link-sportsyou"
                className="ff-source-row"
              >
                <Trophy className="w-4 h-4" aria-hidden="true" />
                <span>
                  <strong>sportsYou</strong>
                  <span className="ff-source-meta">Athletics &amp; teams</span>
                </span>
                <span className={`ff-source-status ${sportsYouConnected ? 'is-on' : ''}`}>
                  {sportsYouConnected || calendarEventsCount > 0 ? 'Connected' : 'Calendar'}
                </span>
                <ExternalLink className="w-3.5 h-3.5 ff-source-ext" aria-hidden="true" />
              </a>
              <a
                href="https://launchpad.classlink.com"
                target="_blank"
                rel="noopener noreferrer"
                id="link-classlink"
                className="ff-source-row"
              >
                <LinkIcon className="w-4 h-4" aria-hidden="true" />
                <span>
                  <strong>ClassLink</strong>
                  <span className="ff-source-meta">Single sign-on</span>
                </span>
                <ExternalLink className="w-3.5 h-3.5 ff-source-ext" aria-hidden="true" />
              </a>
              <div className="ff-source-actions">
                <button
                  type="button"
                  id="refresh-blackbaud-button"
                  onClick={() => void onRefreshBlackbaud({ openPortal: false })}
                  disabled={isSyncingBlackbaud}
                  aria-busy={isSyncingBlackbaud}
                  className="btn btn-primary btn-sm"
                >
                  {isSyncingBlackbaud
                    ? <span className="loading loading-spinner loading-xs" aria-hidden="true" />
                    : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
                  Refresh data from Blackbaud
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourcesOpen(false);
                    if (blackbaudStatus.connected) onBlackbaudSettings();
                    else onOpenLanding();
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  {blackbaudStatus.connected ? 'Blackbaud settings' : 'Connect Blackbaud'}
                </button>
                {blackbaudStatus.connected && (
                  <button type="button" onClick={onDisconnectBlackbaud} className="btn btn-ghost btn-xs">
                    Sign out
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <main id="wla-main" className="ff-main">
        <p className="ff-date-line">{todayLabel}</p>
        <h2 className="ff-headline">
          <button type="button" className="ff-head-chunk is-missing" onClick={() => setTaskFilter('missing')}>
            <span className="tabular-nums">{checklistCounts.missing}</span> not turned in
          </button>
          <span className="ff-head-comma">, </span>
          <button type="button" className="ff-head-chunk is-late" onClick={() => setTaskFilter('overdue')}>
            <span className="tabular-nums">{checklistCounts.overdue}</span> late
          </button>
          <span className="ff-head-comma">, </span>
          <button type="button" className="ff-head-chunk is-due" onClick={() => setTaskFilter('dueSoon')}>
            <span className="tabular-nums">{checklistCounts.dueSoon}</span> due by Monday
          </button>
        </h2>

        <div className="ff-layout">
          <section className="ff-card ff-assign-card" aria-labelledby="ff-assign-title">
            <div className="ff-assign-head">
              <div className="min-w-0">
                <h2 id="ff-assign-title" className="ff-card-title">
                  Assignments
                  <span className="ff-assign-count tabular-nums">
                    {checklistCounts.overdue + checklistCounts.missing}
                  </span>
                </h2>
                <p className="ff-muted">
                  {childLabel}
                  {taskFilter === 'dueSoon' ? ` · through ${fridayLabel}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (selectedStudent === 'Ben' || selectedStudent === 'Jade') setNewTaskStudent(selectedStudent);
                  setIsAddingTask(!isAddingTask);
                }}
                className="btn btn-ghost btn-sm"
                aria-expanded={isAddingTask}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add an assignment
              </button>
            </div>

            <label className="ff-select-wrap ff-assign-filter">
              <span className="sr-only">Assignment status</span>
              <select
                className="select select-bordered select-sm ff-select"
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
                aria-label="Assignment status"
              >
                {filterTabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label} ({tab.count})
                  </option>
                ))}
              </select>
            </label>

            {isAddingTask && (
              <form onSubmit={onAddTask} className="ff-add-form">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-sky-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Quick Add Assignment
                  </span>
                  <button type="button" onClick={() => setIsAddingTask(false)} className="text-xs text-zinc-400 hover:text-zinc-100">
                    Cancel
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. Bring poster board for history presentation"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="input input-bordered w-full"
                  autoFocus
                />
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={newTaskStudent}
                    onChange={(e) => setNewTaskStudent(e.target.value)}
                    className="select select-bordered select-sm"
                  >
                    {canSeeBen && <option value="Ben">Ben (High School)</option>}
                    {canSeeJade && <option value="Jade">Jade (Middle School)</option>}
                  </select>
                  <select
                    value={newTaskCourse}
                    onChange={(e) => setNewTaskCourse(e.target.value)}
                    className="select select-bordered select-sm"
                  >
                    <option value="Mathematics">Mathematics</option>
                    <option value="Science">Science</option>
                    <option value="English / ELA">English / ELA</option>
                    <option value="History / Social Studies">History</option>
                    <option value="Bible Studies">Bible Studies</option>
                    <option value="Athletics">Athletics</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Due (e.g. Friday)"
                    value={newTaskDue}
                    onChange={(e) => setNewTaskDue(e.target.value)}
                    className="input input-bordered input-sm"
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-block">
                  Save Assignment
                </button>
              </form>
            )}

            <div className="ff-assign-list">
              {filteredTasks.length === 0 ? (
                <div className="ff-empty">
                  {!blackbaudStatus.connected ? (
                    <>
                      <Folder className="w-7 h-7 mx-auto mb-2 text-zinc-500" />
                      <p className="text-[15px] font-semibold">Sign in to load assignments</p>
                      <p className="text-[13px] text-zinc-400 max-w-sm mx-auto mt-1">
                        Log in with Blackbaud, then use Refresh data from Blackbaud for {childLabel}.
                      </p>
                      <button type="button" onClick={onOpenLanding} className="btn btn-primary mt-4">
                        <Key className="w-3.5 h-3.5" />
                        Log in with Blackbaud
                      </button>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-7 h-7 mx-auto mb-2 text-zinc-500" />
                      <p className="text-[15px] font-semibold">
                        {taskFilter === 'overdue' && `No overdue work for ${childLabel}`}
                        {taskFilter === 'dueSoon' && `Nothing due through ${fridayLabel}`}
                        {taskFilter === 'assigned' && 'No assigned work in range'}
                        {taskFilter === 'missing' && `No missing work for ${childLabel}`}
                        {taskFilter === 'done' && 'No graded assignments yet'}
                      </p>
                      <p className="text-[13px] text-zinc-500 mt-1">
                        Choose another status, or refresh from Sources.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <ul>
                  {filteredTasks.map((task) => {
                    const isCustom = String(task.id || '').startsWith('task_custom_');
                    const late = daysLate(task);
                    const showLate = (task.status === 'overdue' || task.status === 'missing') && late > 0;
                    const status = statusLabel(task.status);
                    const showScore = task.status === 'missing' || task.isMissing || isZeroCreditMissing(task)
                      || assignmentPercent(task.pointsEarned, task.maxPoints) != null
                      || String(task.letter || task.letterGrade || '').trim();
                    return (
                      <li key={task.id} className="ff-assign-row">
                        {showLate ? (
                          <span className={`ff-late-badge ${lateBadgeTone(late)}`} aria-label={`${late} days late`}>
                            <span className="tabular-nums">{late}</span>
                            <span>days late</span>
                          </span>
                        ) : (
                          <span className="ff-late-badge is-empty" aria-hidden="true" />
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenTask(task)}
                          aria-haspopup="dialog"
                          className="ff-assign-body"
                        >
                          <span className="ff-assign-title-block">
                            <span className={`ff-assign-title ${task.status === 'done' ? 'is-done' : ''}`}>
                              {decodeHtml(task.title)}
                            </span>
                            <span className="ff-assign-meta">
                              <span className={`ff-student-pill ${task.student === 'Jade' ? 'is-jade' : 'is-ben'}`}>
                                {task.studentPhoto || studentPhoto(task.student) ? (
                                  <ProfileAvatar
                                    name={task.student}
                                    photoUrl={task.studentPhoto || studentPhoto(task.student)}
                                    size={16}
                                  />
                                ) : (
                                  String(task.student || '?').charAt(0)
                                )}
                              </span>
                              <span className={task.student === 'Ben' ? 'text-sky-300' : 'text-violet-300'}>
                                {task.student}
                              </span>
                              {task.course ? ` · ${decodeHtml(task.course)}` : ''}
                            </span>
                            {task.comment ? (
                              <span className="ff-assign-note">Teacher note: {decodeHtml(task.comment)}</span>
                            ) : null}
                            {(task.comments || []).length > 0 ? (
                              <span className="ff-assign-note inline-flex items-center gap-1">
                                <MessageCircle className="w-3 h-3" aria-hidden="true" />
                                Family comments · {(task.comments || []).length}
                                {unreadByAssignment.has(task.id) ? (
                                  <span className="family-thread-unread">New</span>
                                ) : null}
                              </span>
                            ) : unreadByAssignment.has(task.id) ? (
                              <span className="ff-assign-note">
                                <span className="family-thread-unread">New family comment</span>
                              </span>
                            ) : null}
                          </span>
                          <span className="ff-assign-type">{task.type ? decodeHtml(task.type) : ''}</span>
                          <span className="ff-assign-due">
                            <span className={`ff-status-label ${status.className}`}>{status.text}</span>
                            <span className="tabular-nums">{task.dueDate || 'No due date'}</span>
                            {showScore ? (
                              <AssignmentScoreChip
                                earned={task.pointsEarned}
                                max={task.maxPoints}
                                letter={task.letter || task.letterGrade}
                                status={task.status}
                              />
                            ) : task.assignedDate && task.status === 'assigned' ? (
                              <span className="ff-assign-note">Assigned {task.assignedDate}</span>
                            ) : null}
                            {task.acknowledged && task.acknowledgedBy ? (
                              <span className="ff-assign-note">
                                Acked by {task.acknowledgedBy}
                                {task.acknowledgedAt ? ` · ${formatAckStamp(task.acknowledgedAt)}` : ''}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {isCustom ? (
                          <button
                            type="button"
                            className="ff-ack-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleTask(task.id);
                            }}
                            aria-label={task.completed ? 'Mark as open' : 'Mark as done'}
                          >
                            {task.completed ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                            ) : (
                              <Circle className="w-5 h-5 text-zinc-500" />
                            )}
                          </button>
                        ) : task.status === 'missing' ? (
                          <button
                            type="button"
                            className="ff-ack-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onMissingAck(task, true);
                            }}
                            aria-label={`Acknowledge missing: ${decodeHtml(task.title)}`}
                          >
                            <Circle className="w-5 h-5 text-zinc-400" />
                          </button>
                        ) : (
                          <span className="ff-ack-btn is-static" aria-hidden="true">
                            <Circle className="w-5 h-5 text-zinc-700" />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <div className="ff-right">
            <section className="ff-card ff-week-card" aria-labelledby="ff-this-week-title">
              <div className="ff-week-head">
                <div>
                  <h2 id="ff-this-week-title" className="ff-card-title">This week</h2>
                  <p className="ff-muted">sportsYou calendar</p>
                </div>
                <label className="ff-select-wrap">
                  <span className="sr-only">Event list</span>
                  <select
                    className="select select-bordered select-sm ff-select"
                    value={eventFilter}
                    onChange={(e) => setEventFilter(e.target.value)}
                    aria-label="Event list"
                  >
                    <option value="active">Active ({activeEventsCount})</option>
                    <option value="acknowledged">Acknowledged ({acknowledgedEventsCount})</option>
                  </select>
                </label>
              </div>
              <CalendarBoard
                events={filteredEvents}
                onSelect={onSelectEvent}
                compact
              />
            </section>

            <section className="ff-card ff-grades-card" aria-labelledby="ff-grades-title">
              <div className="ff-grades-head">
                <div>
                  <h2 id="ff-grades-title" className="ff-card-title">Grades</h2>
                  <p className="ff-muted">
                    {gradeGroups.length === 0
                      ? 'Nothing posted yet for Fall 2026. Grades appear here as teachers publish them.'
                      : 'Fall 2026'}
                  </p>
                </div>
                <label className="ff-select-wrap">
                  <span className="sr-only">Grade display</span>
                  <select
                    className="select select-bordered select-sm ff-select"
                    value={gradeDisplay}
                    onChange={(e) => setGradeDisplayMode(e.target.value)}
                    aria-label="Grade display"
                  >
                    <option value="letter">Letter</option>
                    <option value="percent">Percent</option>
                  </select>
                </label>
              </div>
              {gradeGroups.length === 0 ? (
                <div className="ff-empty is-compact">
                  {!blackbaudStatus.connected && (
                    <button type="button" onClick={onOpenLanding} className="btn btn-primary">
                      <Key className="w-3.5 h-3.5" />
                      Log in with Blackbaud
                    </button>
                  )}
                </div>
              ) : (
                <CourseGradeList groups={gradeGroups} mode={gradeDisplay} onSelectCourse={onSelectCourse} />
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
