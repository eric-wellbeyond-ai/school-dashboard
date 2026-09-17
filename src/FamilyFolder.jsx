import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar,
  CheckCircle2,
  ExternalLink,
  Files,
  Folder,
  GraduationCap,
  Inbox,
  Key,
  Link as LinkIcon,
  MessageCircle,
  Newspaper,
  Plug,
  Plus,
  RefreshCw,
  Sparkles,
  Trophy,
  X
} from 'lucide-react';
import CalendarBoard from './CalendarBoard.jsx';
import CourseGradeList from './CourseGradeList.jsx';
import {
  assignmentPercent,
  gradeBandFromLetterOrPercent,
  gradeToneClass
} from './lib/gradeColors.js';
import { formatAssignmentScore } from './lib/assignmentScore.js';
import { dueDateFromAssignment, isZeroCreditMissing } from './lib/assignmentBuckets.js';
import { liveImageSrc, SafePostImage } from './PostDetail.jsx';

const GRADE_CHIP_CLASS =
  'inline-flex min-w-[2.75rem] justify-center tabular-nums font-semibold text-[13px] px-2 py-0.5 rounded-md border';

export function ProfileAvatar({ name, photoUrl, size = 28, className = '' }) {
  const [broken, setBroken] = useState(false);
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  const dim = `${size}px`;
  const live = liveImageSrc(photoUrl);
  if (live && !broken) {
    return (
      <img
        src={live}
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

function daysFromDue(task) {
  const due = dueDateFromAssignment(task);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

function daysLate(task) {
  const days = daysFromDue(task);
  if (days == null) return 0;
  return Math.max(0, -days);
}

function dueCountdownLabel(days, status) {
  if (days == null) return status === 'assigned' ? 'Assigned' : 'No due date';
  if (days <= 0) return 'Due today';
  if (days === 1) return '1 day till due';
  return `${days} days till due`;
}

function assignmentRightStatus(task) {
  if (task.status === 'done') {
    return { text: 'Done', tone: 'is-done' };
  }
  return null;
}

function assignmentDueSlot(task) {
  if (task.status === 'overdue') {
    const late = daysLate(task);
    if (late <= 0) return null;
    return {
      num: late,
      unit: 'Days late',
      tone: lateBadgeTone(late),
      label: `${late} days late`
    };
  }
  if (task.status === 'dueSoon' || task.status === 'assigned') {
    const days = daysFromDue(task);
    if (days == null) return null;
    const till = Math.max(0, days);
    return {
      num: till,
      unit: 'Days till due',
      tone: task.status === 'dueSoon' ? 'is-soon' : 'is-assigned',
      label: dueCountdownLabel(till, task.status)
    };
  }
  return null;
}

function sortUnreadFirst(items) {
  return [...(items || [])].sort((a, b) => {
    const au = a?.viewed === false ? 0 : 1;
    const bu = b?.viewed === false ? 0 : 1;
    return au - bu;
  });
}

function feedThumbSrc(item) {
  const candidates = [
    item?.imageUrl,
    ...((item?.images || []).map((image) => image?.src))
  ];
  for (const src of candidates) {
    const live = liveImageSrc({ src, alt: item?.title });
    if (live) return live;
  }
  return null;
}

function snippetLine(text, max = 140) {
  const clean = decodeHtml(text);
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
}

function noteMatchesStudent(item, filter) {
  if (filter === 'All') return true;
  return item.student === filter || item.student === 'All';
}

function FeedListSheet({
  id,
  title,
  empty,
  items,
  onSelect,
  onClose,
  filters,
  filter,
  onFilter,
  filterLabel
}) {
  const closeRef = useRef(null);
  const titleId = `${id}-title`;
  const rows = sortUnreadFirst(items);
  useEffect(() => {
    const prev = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, []);

  return createPortal(
    <div className="post-detail-root" onClick={onClose}>
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="post-detail-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="post-detail-grabber" aria-hidden="true" />
        <header className="post-detail-toolbar">
          <button
            ref={closeRef}
            type="button"
            className="post-detail-icon-btn"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
          <p id={titleId} className="post-detail-kicker">{title}</p>
        </header>
        {filters?.length > 1 ? (
          <div className="ff-feed-filters ff-feed-sheet-filters" role="tablist" aria-label={filterLabel}>
            {filters.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                className={`ff-feed-filter ${filter === tab.id ? 'is-active' : ''}`}
                onClick={() => onFilter(tab.id)}
              >
                {tab.label}
                {typeof tab.count === 'number' && tab.count > 0 ? (
                  <span className="tabular-nums">{tab.count}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        <div className="post-detail-scroll">
          {rows.length === 0 ? (
            <p className="ff-feed-empty">{empty}</p>
          ) : (
            <ul className="ff-feed-sheet-list">
              {rows.map((item) => {
                const thumb = feedThumbSrc(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`ff-feed-row ${item.viewed === false ? 'is-unread' : ''}`}
                      onClick={() => onSelect(item)}
                    >
                      <span className="ff-feed-row-copy">
                        <span className="ff-feed-row-title">{decodeHtml(item.title)}</span>
                        <span className="ff-feed-row-meta">
                          {[
                            item.date,
                            item.author || (item.student && item.student !== 'All' ? item.student : null),
                            item.type && item.feed === 'resources' ? item.type : null
                          ].filter(Boolean).join(' · ')}
                        </span>
                        {item.snippet ? (
                          <span className="ff-feed-row-snippet">{snippetLine(item.snippet)}</span>
                        ) : null}
                      </span>
                      {thumb ? (
                        <SafePostImage src={thumb} alt="" className="ff-feed-thumb" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function AssignmentScoreChip({ earned, max, letter, status, className = '' }) {
  const score = formatAssignmentScore(earned, max);
  const letterText = String(letter || '').trim();
  const zeroMissing = isZeroCreditMissing({ pointsEarned: earned, maxPoints: max });
  const showMissing = status === 'missing' || (zeroMissing && status !== 'done');
  if (showMissing) {
    return (
      <span
        className={`ff-assign-chip ${GRADE_CHIP_CLASS} ${gradeToneClass('missing')} ${className}`}
        title={score.raw || 'Missing'}
      >
        Missing
      </span>
    );
  }
  if (score.percent == null && !letterText) return null;
  const band = gradeBandFromLetterOrPercent(letterText, score.percent);
  return (
    <span
      className={`ff-assign-chip ${GRADE_CHIP_CLASS} ${gradeToneClass(band)} ${className}`}
      title={score.raw || undefined}
    >
      {score.percentLabel || letterText}
    </span>
  );
}

function lateBadgeTone(days) {
  if (days >= 10) return 'is-severe';
  if (days >= 5) return 'is-mid';
  return 'is-mild';
}

function AssignmentDoneCheck({ checked, label, onToggle }) {
  return (
    <label className="ff-done-check">
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(event) => event.stopPropagation()}
      />
    </label>
  );
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
  sportsYouConnected,
  instructionalConnected = false,
  topbarTools,
  officialNotes = [],
  featuredNews = [],
  schoolResources = [],
  notesUnreadCount = 0,
  newsUnreadCount = 0,
  resourcesUnreadCount = 0,
  onOpenOfficialNote,
  onOpenFeaturedItem,
  onOpenResource
}) {
  const [openMenu, setOpenMenu] = useState(null);
  const sourcesRef = useRef(null);
  const feedsRef = useRef(null);
  const endRef = useRef(null);
  const signedInName = blackbaudStatus.displayName || blackbaudStatus.accountName || '';
  const signedFirst = firstName(signedInName);
  const blackbaudSync = formatSyncTime(blackbaudStatus.verifiedAt);
  const blackbaudSynced = Boolean(blackbaudStatus.connected && blackbaudStatus.verifiedAt);
  const sourcesLabel = blackbaudSynced
    ? (blackbaudSync ? `Sources, Blackbaud synced ${blackbaudSync}` : 'Sources, Blackbaud synced')
    : 'Sources, Blackbaud not synced';
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).toUpperCase();
  const bothOpenCount = benOpenCount + jadeOpenCount;
  const sourcesOpen = openMenu === 'sources';
  const notesOpen = openMenu === 'notes';
  const newsOpen = openMenu === 'news';
  const resourcesOpen = openMenu === 'resources';
  const profileOpen = openMenu === 'profile';
  const [notesFilter, setNotesFilter] = useState(selectedStudent === 'All' ? 'All' : selectedStudent);

  useEffect(() => {
    setNotesFilter(selectedStudent === 'All' ? 'All' : selectedStudent);
  }, [selectedStudent]);

  useEffect(() => {
    if (!openMenu) return undefined;
    const isFeed = openMenu === 'notes' || openMenu === 'news' || openMenu === 'resources';
    const onKey = (event) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('keydown', onKey);
    if (isFeed) {
      return () => document.removeEventListener('keydown', onKey);
    }
    const onDoc = (event) => {
      if (endRef.current && endRef.current.contains(event.target)) return;
      setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const filterTabs = [
    { id: 'overdue', label: 'Overdue', count: checklistCounts.overdue },
    { id: 'dueSoon', label: 'Due soon', count: checklistCounts.dueSoon },
    { id: 'assigned', label: 'Assigned', count: checklistCounts.assigned },
    { id: 'missing', label: 'Missing', count: checklistCounts.missing },
    { id: 'done', label: 'Done', count: checklistCounts.done }
  ];

  const visibleNotes = officialNotes.filter((item) => noteMatchesStudent(item, notesFilter));
  const noteFilters = isParentViewer && canSeeBen && canSeeJade
    ? [
      { id: 'All', label: 'Both', count: officialNotes.length },
      { id: 'Ben', label: 'Ben', count: officialNotes.filter((item) => noteMatchesStudent(item, 'Ben')).length },
      { id: 'Jade', label: 'Jade', count: officialNotes.filter((item) => noteMatchesStudent(item, 'Jade')).length }
    ]
    : [];

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
              className={`ff-kid-pill is-both ${selectedStudent === 'All' ? 'is-active' : ''}`}
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
              className={`ff-kid-pill is-ben ${selectedStudent === 'Ben' ? 'is-active' : ''}`}
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
              className={`ff-kid-pill is-jade ${selectedStudent === 'Jade' ? 'is-active' : ''}`}
            >
              <ProfileAvatar name="Jade" photoUrl={studentPhoto('Jade')} size={18} />
              Jade
              <span className="tabular-nums">{jadeOpenCount}</span>
            </button>
          )}
        </div>

        <div className="ff-topbar-end" ref={endRef}>
        <div className="ff-topbar-tools" data-slot="topbar-tools">
          {topbarTools}
          <div className="ff-feeds" ref={feedsRef}>
            <div className="ff-feed-slot">
              <button
                type="button"
                id="official-notes-button"
                className="ff-feed-btn"
                aria-label={notesUnreadCount ? `Official notes, ${notesUnreadCount} unread` : 'Official notes'}
                title="Official notes"
                aria-expanded={notesOpen}
                aria-haspopup="dialog"
                aria-controls="ff-notes-popover"
                onClick={() => setOpenMenu(notesOpen ? null : 'notes')}
              >
                <Inbox className="w-5 h-5" aria-hidden="true" />
                {notesUnreadCount > 0 ? (
                  <span className="ff-feed-badge" aria-hidden="true">
                    {notesUnreadCount > 99 ? '99+' : notesUnreadCount}
                  </span>
                ) : null}
              </button>
              {notesOpen && (
                <FeedListSheet
                  id="ff-notes-popover"
                  title="Official notes"
                  empty={blackbaudStatus.connected ? 'No official notes for this student.' : 'Sign in to load official notes.'}
                  items={visibleNotes}
                  filter={notesFilter}
                  filters={noteFilters}
                  filterLabel="Student"
                  onFilter={setNotesFilter}
                  onClose={() => setOpenMenu(null)}
                  onSelect={(item) => {
                    setOpenMenu(null);
                    onOpenOfficialNote(item);
                  }}
                />
              )}
            </div>
            <div className="ff-feed-slot">
              <button
                type="button"
                id="featured-news-button"
                className="ff-feed-btn"
                aria-label={newsUnreadCount ? `News, ${newsUnreadCount} unread` : 'News'}
                title="News"
                aria-expanded={newsOpen}
                aria-haspopup="dialog"
                aria-controls="ff-news-popover"
                onClick={() => setOpenMenu(newsOpen ? null : 'news')}
              >
                <Newspaper className="w-5 h-5" aria-hidden="true" />
                {newsUnreadCount > 0 ? (
                  <span className="ff-feed-badge" aria-hidden="true">
                    {newsUnreadCount > 99 ? '99+' : newsUnreadCount}
                  </span>
                ) : null}
              </button>
              {newsOpen && (
                <FeedListSheet
                  id="ff-news-popover"
                  title="News"
                  empty={blackbaudStatus.connected ? 'No school news yet.' : 'Sign in to load school news.'}
                  items={featuredNews}
                  onClose={() => setOpenMenu(null)}
                  onSelect={(item) => {
                    setOpenMenu(null);
                    onOpenFeaturedItem(item);
                  }}
                />
              )}
            </div>
            <div className="ff-feed-slot">
              <button
                type="button"
                id="school-resources-button"
                className="ff-feed-btn"
                aria-label={resourcesUnreadCount ? `Resources, ${resourcesUnreadCount} unread` : 'Resources'}
                title="Resources"
                aria-expanded={resourcesOpen}
                aria-haspopup="dialog"
                aria-controls="ff-resources-popover"
                onClick={() => setOpenMenu(resourcesOpen ? null : 'resources')}
              >
                <Files className="w-5 h-5" aria-hidden="true" />
                {resourcesUnreadCount > 0 ? (
                  <span className="ff-feed-badge" aria-hidden="true">
                    {resourcesUnreadCount > 99 ? '99+' : resourcesUnreadCount}
                  </span>
                ) : null}
              </button>
              {resourcesOpen && (
                <FeedListSheet
                  id="ff-resources-popover"
                  title="Resources"
                  empty={blackbaudStatus.connected ? 'No resources for this school.' : 'Sign in to load resources.'}
                  items={schoolResources}
                  onClose={() => setOpenMenu(null)}
                  onSelect={(item) => {
                    setOpenMenu(null);
                    onOpenResource(item);
                  }}
                />
              )}
            </div>
          </div>
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
            <button
              type="button"
              className={`ff-feed-btn ff-sources-toggle ${blackbaudSynced ? 'is-synced' : ''}`}
              aria-label={sourcesLabel}
              title={sourcesLabel}
              aria-expanded={sourcesOpen}
              aria-haspopup="dialog"
              aria-controls="ff-sources-popover"
              onClick={() => setOpenMenu(sourcesOpen ? null : 'sources')}
            >
              <Plug className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ff-account-who"
              aria-label={signedInName ? `Account, ${signedFirst}` : 'Account'}
              title="Account"
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              aria-controls="ff-profile-menu"
              onClick={() => setOpenMenu(profileOpen ? null : 'profile')}
            >
              <ProfileAvatar name={signedInName || 'Family'} photoUrl={blackbaudStatus.photoUrl} size={28} />
              <span className="ff-account-name">{signedFirst}</span>
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
                  {sportsYouConnected ? 'Connected' : 'Calendar'}
                </span>
                <ExternalLink className="w-3.5 h-3.5 ff-source-ext" aria-hidden="true" />
              </a>
              <a
                href="https://westlakelutheran.myschoolapp.com"
                target="_blank"
                rel="noopener noreferrer"
                id="link-instructional-calendar"
                className="ff-source-row"
              >
                <Calendar className="w-4 h-4" aria-hidden="true" />
                <span>
                  <strong>School calendar</strong>
                  <span className="ff-source-meta">Instructional schedule</span>
                </span>
                <span className={`ff-source-status ${instructionalConnected ? 'is-on' : ''}`}>
                  {instructionalConnected ? 'Connected' : 'Calendar'}
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
                    setOpenMenu(null);
                    if (blackbaudStatus.connected) onBlackbaudSettings();
                    else onOpenLanding();
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  {blackbaudStatus.connected ? 'Blackbaud settings' : 'Connect Blackbaud'}
                </button>
              </div>
            </div>
          )}
          {profileOpen && (
            <div id="ff-profile-menu" className="ff-profile-pop" role="menu" aria-label="Account">
              {signedInName ? (
                <p className="ff-profile-kicker">{signedInName}</p>
              ) : null}
              {blackbaudStatus.connected ? (
                <button
                  type="button"
                  role="menuitem"
                  className="ff-profile-item"
                  onClick={() => {
                    setOpenMenu(null);
                    onDisconnectBlackbaud();
                  }}
                >
                  Sign out
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="ff-profile-item"
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenLanding();
                  }}
                >
                  Sign in
                </button>
              )}
            </div>
          )}
        </div>
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

            <div
              role="tablist"
              aria-label="Assignment status"
              className="ff-assign-slider tabs"
            >
              {filterTabs.map((tab, index) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={taskFilter === tab.id}
                  tabIndex={taskFilter === tab.id ? 0 : -1}
                  className={`tab ff-assign-tab join-item ${taskFilter === tab.id ? 'tab-active' : ''}`}
                  onClick={() => setTaskFilter(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
                    event.preventDefault();
                    const last = filterTabs.length - 1;
                    let next = index;
                    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
                    if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
                    if (event.key === 'Home') next = 0;
                    if (event.key === 'End') next = last;
                    setTaskFilter(filterTabs[next].id);
                    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus();
                  }}
                >
                  {tab.label}
                  <span className="ff-assign-tab-count tabular-nums">{tab.count}</span>
                </button>
              ))}
            </div>

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
                  <label className="ff-select-wrap">
                    <span className="sr-only">Student</span>
                    <select
                      value={newTaskStudent}
                      onChange={(e) => setNewTaskStudent(e.target.value)}
                      className="select select-bordered select-sm ff-select"
                    >
                      {canSeeBen && <option value="Ben">Ben (High School)</option>}
                      {canSeeJade && <option value="Jade">Jade (Middle School)</option>}
                    </select>
                  </label>
                  <label className="ff-select-wrap">
                    <span className="sr-only">Course</span>
                    <select
                      value={newTaskCourse}
                      onChange={(e) => setNewTaskCourse(e.target.value)}
                      className="select select-bordered select-sm ff-select"
                    >
                      <option value="Mathematics">Mathematics</option>
                      <option value="Science">Science</option>
                      <option value="English / ELA">English / ELA</option>
                      <option value="History / Social Studies">History</option>
                      <option value="Bible Studies">Bible Studies</option>
                      <option value="Athletics">Athletics</option>
                    </select>
                  </label>
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
                    const dueSlot = assignmentDueSlot(task);
                    const familyFiled = task.acknowledged === true || task.doneOverride === true;
                    const showCheck = task.status === 'overdue'
                      || task.status === 'missing'
                      || (task.status === 'done' && (familyFiled || (isCustom && task.completed)));
                    const isChecked = isCustom ? Boolean(task.completed) : familyFiled;
                    const checkLabel = isChecked
                      ? `Restore ${decodeHtml(task.title)}`
                      : `Mark ${decodeHtml(task.title)} as done`;
                    const showScore = task.status === 'missing' || task.isMissing || isZeroCreditMissing(task)
                      || assignmentPercent(task.pointsEarned, task.maxPoints) != null
                      || String(task.letter || task.letterGrade || '').trim();
                    const courseType = [
                      task.course ? decodeHtml(task.course) : null,
                      task.type ? decodeHtml(task.type) : null
                    ].filter(Boolean).join(' · ');
                    const metaText = [task.student, courseType].filter(Boolean).join(' · ');
                    const rightStatus = assignmentRightStatus(task);
                    const scoreChip = showScore ? (
                      <AssignmentScoreChip
                        earned={task.pointsEarned}
                        max={task.maxPoints}
                        letter={task.letter || task.letterGrade}
                        status={task.status}
                      />
                    ) : null;
                    return (
                      <li key={task.id} className="ff-assign-row">
                        {dueSlot ? (
                          <span className={`ff-late-badge ${dueSlot.tone}`} aria-label={dueSlot.label}>
                            <span className="ff-late-num tabular-nums">{dueSlot.num}</span>
                            <span className="ff-late-unit">{dueSlot.unit}</span>
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
                          <span className="ff-assign-copy">
                            <span className="ff-assign-head">
                              <span className={`ff-assign-title ${task.status === 'done' ? 'is-done' : ''}`}>
                                {decodeHtml(task.title)}
                              </span>
                              {scoreChip}
                            </span>
                            <span className="ff-assign-sub">
                              <span className="ff-assign-meta max-w-[50%]" title={metaText}>
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
                                <span className="ff-assign-meta-text">
                                  <span className={task.student === 'Ben' ? 'text-sky-300' : 'text-violet-300'}>
                                    {task.student}
                                  </span>
                                  {courseType ? ` · ${courseType}` : ''}
                                </span>
                              </span>
                              {rightStatus ? (
                                <span className="ff-assign-due ml-auto text-right">
                                  <span className={`ff-status-label tabular-nums ${rightStatus.tone}`}>
                                    {rightStatus.text}
                                  </span>
                                </span>
                              ) : null}
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
                            {familyFiled && task.acknowledgedBy ? (
                              <span className="ff-assign-note">
                                Done by {task.acknowledgedBy}
                                {task.acknowledgedAt ? ` · ${formatAckStamp(task.acknowledgedAt)}` : ''}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {showCheck ? (
                          <AssignmentDoneCheck
                            checked={isChecked}
                            label={checkLabel}
                            onToggle={() => {
                              if (isCustom) onToggleTask(task.id);
                              else void onMissingAck(task, !isChecked);
                            }}
                          />
                        ) : task.status === 'done' ? (
                          <span className="ff-done-check is-complete">
                            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                            <span className="sr-only">Done</span>
                          </span>
                        ) : (
                          <span className="ff-done-check is-empty" aria-hidden="true" />
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
                  <p className="ff-muted">School and sportsYou calendars</p>
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
