import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  Circle,
  Calendar,
  Clock,
  MapPin,
  GraduationCap,
  Trophy,
  BookOpen,
  User,
  Users,
  CheckSquare,
  AlertCircle,
  Plus,
  Trash2,
  Inbox,
  Shield,
  Filter,
  Check,
  Sparkles,
  Link as LinkIcon,
  MessageSquare,
  MessageCircle,
  Send,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  CheckCheck,
  Award,
  AlertTriangle,
  Key,
  Mail,
  Copy,
  FileText,
  Bookmark
} from 'lucide-react';
import { buildBlackbaudBookmarklet } from './blackbaudBookmarklet.js';
import LandingPage from './LandingPage.jsx';
import ClassDetailModal from './ClassDetailModal.jsx';
import FamilyFolder, { ProfileAvatar } from './FamilyFolder.jsx';
import PostDetail, { toPostItem } from './PostDetail.jsx';
import {
  classifyAssignment,
  formatAssignmentDate,
  fridayOfCurrentWeek,
  parsePortalDate,
  compareChecklistAssignments,
  isZeroCreditMissing
} from './lib/assignmentBuckets.js';
import { classifySportsYouEvent } from './lib/sportsyouClassify.js';
import {
  assignmentPercent,
  gradeBandFromLetterOrPercent,
  gradeToneClass
} from './lib/gradeColors.js';
import { formatAssignmentScore } from './lib/assignmentScore.js';
import MapsLocationLink from './lib/MapsLocationLink.jsx';
import {
  ToastViewport,
  collectNewIncomingComments,
  notificationToastMessage,
  sentCommentToast
} from './Toast.jsx';

/**
 * Decode all HTML entities (named, decimal, hex) and strip raw HTML tags
 */
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#160;|&nbsp;/gi, ' ')
    .replace(/&#8217;|&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&#8216;|&lsquo;/gi, "'")
    .replace(/&#8220;|&ldquo;|&#8221;|&rdquo;/gi, '"')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8594;|&rarr;/gi, '→')
    .replace(/&#x3D;|&#61;/gi, '=')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCharCode(parseInt(dec, 10)); } catch { return _; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCharCode(parseInt(hex, 16)); } catch { return _; }
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function fingerprintText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 90);
}

function formatMailDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function notesFromGmail(events, tasks) {
  const byEmail = new Map();
  const push = (item) => {
    const emailId = item?.emailId;
    if (!emailId || byEmail.has(emailId)) return;
    const body = item.emailBody || item.description || '';
    const title = item.emailSubject || item.title || 'School email';
    byEmail.set(emailId, {
      id: `gmail_${emailId}`,
      kind: 'gmail',
      title,
      date: formatMailDate(item.emailDate) || item.date || null,
      time: null,
      student: item.student || 'All',
      author: item.emailFrom || item.source || null,
      type: item.source === 'sportsYou' ? 'sportsYou email' : 'School email',
      source: item.source === 'sportsYou' ? 'Gmail · sportsYou' : 'Gmail',
      snippet: decodeHtmlEntities(body).slice(0, 140),
      description: decodeHtmlEntities(body),
      viewed: true,
      feed: 'notes',
      emailId,
      emailSubject: item.emailSubject,
      emailBody: item.emailBody,
      emailFrom: item.emailFrom,
      emailDate: item.emailDate
    });
  };
  (events || []).forEach(push);
  (tasks || []).forEach(push);
  return [...byEmail.values()];
}

function mergeOfficialNotes(portalNotes, gmailNotes) {
  const portal = portalNotes || [];
  const fingerprints = new Set(portal.map((item) => fingerprintText(item.description || item.snippet || item.title)).filter(Boolean));
  const extras = (gmailNotes || []).filter((item) => {
    const print = fingerprintText(item.description || item.snippet || item.title);
    if (!print) return true;
    for (const existing of fingerprints) {
      if (existing && (print.includes(existing) || existing.includes(print))) return false;
    }
    return true;
  });
  return [...portal, ...extras];
}

function cleanDeep(obj) {
  if (typeof obj === 'string') {
    return decodeHtmlEntities(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = cleanDeep(v);
    }
    return res;
  }
  return obj;
}

const GRADE_DISPLAY_KEY = 'school_dashboard_grade_display';
const CALENDAR_ACK_KEY = 'school_dashboard_calendar_acked';

function isLiveCalendarId(eventId) {
  const id = String(eventId || '');
  return id.startsWith('sy_') || id.startsWith('inst_');
}

function isInstructionalEvent(event) {
  return event?.source === 'instructional' || event?.type === 'instructional';
}

function courseGradeValue(course, mode) {
  const letter = String(course?.letterGrade || '').trim();
  const percent = String(course?.percentage || '').trim();
  if (mode === 'percent') return percent || letter || '—';
  return letter || percent || '—';
}

const GRADE_CHIP_CLASS =
  'inline-flex min-w-[2.75rem] justify-center tabular-nums font-semibold text-[13px] px-2 py-0.5 rounded-md border';

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
          <span className="text-[11px] tabular-nums text-base-content/60">{score.raw}</span>
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
        <span className="text-[11px] tabular-nums text-base-content/60">{score.raw}</span>
      ) : null}
    </span>
  );
}

function formatAckStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function familyFirstName(name) {
  const n = String(name || '').trim();
  if (!n) return 'Family';
  return n.split(/\s+/)[0];
}

const BLACKBAUD_AUTO_SYNC_MS = 5 * 60 * 1000;

function blackbaudSyncStudentKeys(status, selectedStudent) {
  if (status?.role === 'student') {
    return (status.allowedStudentKeys || []).filter(Boolean);
  }
  if (selectedStudent === 'Ben' || selectedStudent === 'Jade') return [selectedStudent];
  return ['Ben', 'Jade'];
}

function isOwnFamilyComment(comment, status) {
  if (!comment) return false;
  if (comment.authorKey && status?.userKey
    && String(comment.authorKey).toLowerCase() === String(status.userKey).toLowerCase()) {
    return true;
  }
  if (comment.authorUserId && status?.userId
    && Number(comment.authorUserId) === Number(status.userId)) {
    return true;
  }
  const author = familyFirstName(comment.author).toLowerCase();
  const me = familyFirstName(status?.displayName || status?.accountName).toLowerCase();
  return Boolean(author && me && author !== 'family' && author === me);
}

function familyMessagePlaceholder(isParent, student) {
  if (isParent && (student === 'Ben' || student === 'Jade')) return `Message ${student}…`;
  return 'Message the family…';
}

function FamilyThread({
  comments,
  status,
  isParent,
  student,
  commentText,
  onCommentText,
  onSend,
  onDelete,
  unreadCount = 0
}) {
  const listRef = useRef(null);
  const signedName = familyFirstName(status?.displayName || status?.accountName || 'Family');
  const placeholder = familyMessagePlaceholder(isParent, student);
  const audience = isParent && (student === 'Ben' || student === 'Jade')
    ? student
    : 'the family';
  const emptyHint = isParent && (student === 'Ben' || student === 'Jade')
    ? `Message ${student} about this assignment.`
    : 'Message Eric and Stefani about this assignment.';

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments?.length]);

  return (
    <section className="family-thread" aria-labelledby="family-thread-title">
      <div className="family-thread-header">
        <div className="min-w-0">
          <h3 id="family-thread-title" className="family-thread-title">Family</h3>
          <p className="family-thread-kicker">
            Only Eric, Stefani, Ben, and Jade. Teachers never see this.
          </p>
        </div>
        <div className="family-thread-header-meta">
          {unreadCount > 0 ? (
            <span className="family-thread-unread">{unreadCount} new</span>
          ) : null}
          <span className="family-thread-count tabular-nums">
            {(comments || []).length}
          </span>
        </div>
      </div>

      <div ref={listRef} className="family-thread-list">
        {(comments || []).length === 0 ? (
          <div className="family-thread-empty">
            <p className="family-thread-empty-title">No family comments yet</p>
            <p className="family-thread-empty-copy">{emptyHint}</p>
          </div>
        ) : (
          (comments || []).map((comment) => {
            const mine = isOwnFamilyComment(comment, status);
            const canDelete = mine || isParent;
            const who = familyFirstName(comment.author);
            return (
              <article
                key={comment.id}
                className={`family-thread-row ${mine ? 'is-own' : 'is-other'}`}
              >
                <ProfileAvatar
                  name={who}
                  photoUrl={comment.authorPhoto}
                  size={28}
                  className="family-thread-avatar"
                />
                <div className="family-thread-body">
                  <div className="family-thread-meta">
                    <span className="family-thread-name">{who}</span>
                    <span className="family-thread-time">{comment.timestamp}</span>
                  </div>
                  <p className="family-thread-bubble">
                    {decodeHtmlEntities(comment.text)}
                  </p>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => onDelete(comment.id)}
                      className="family-thread-delete"
                      aria-label={`Delete comment from ${who}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>

      <form onSubmit={onSend} className="family-thread-composer">
        <ProfileAvatar
          name={signedName}
          photoUrl={status?.photoUrl}
          size={36}
          className="family-thread-avatar"
        />
        <label className="sr-only" htmlFor="family-thread-input">
          Message {audience}
        </label>
        <textarea
          id="family-thread-input"
          placeholder={placeholder}
          value={commentText}
          onChange={(e) => onCommentText(e.target.value)}
          rows={2}
          className="textarea family-thread-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={!commentText.trim()}
          className="btn btn-primary family-thread-send"
          aria-label={`Send to ${audience}`}
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

function photoForStudent(students, grades, assignments, name) {
  const row = (students || []).find((s) => s.student === name);
  if (row?.photoUrl) return row.photoUrl;
  const courses = grades?.[name];
  const first = Array.isArray(courses) ? courses[0] : null;
  if (first?.studentPhoto || first?.photoUrl) return first.studentPhoto || first.photoUrl;
  const fromAssignment = (assignments || []).find((a) => a.student === name && a.studentPhoto);
  return fromAssignment?.studentPhoto || null;
}

export default function App() {
  const [selectedStudent, setSelectedStudent] = useState('All'); // 'All' | 'Ben' | 'Jade'
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncDropdownOpen, setSyncDropdownOpen] = useState(false);
  const [lastSynced, setLastSynced] = useState(() => {
    try {
      return localStorage.getItem('school_dashboard_last_synced') || null;
    } catch {
      return null;
    }
  });
  const [syncSource, setSyncSource] = useState(null);
  const [taskFilter, setTaskFilter] = useState('overdue'); // overdue | dueSoon | assigned | missing | done
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskStudent, setNewTaskStudent] = useState('Ben');
  const [newTaskCourse, setNewTaskCourse] = useState('Mathematics');
  const [newTaskDue, setNewTaskDue] = useState('Tomorrow');
  const [isAddingTask, setIsAddingTask] = useState(false);
  
  // Google OAuth state
  const [authStatus, setAuthStatus] = useState({
    configured: false,
    hasClientId: true,
    hasClientSecret: false,
    clientId: '82253624012-97aurejdlmr6nhrcrcf8fj6o0d6a5ge5.apps.googleusercontent.com',
    redirectUri: 'http://localhost:5001/auth/google/callback',
    authenticated: false
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef(new Map());
  const seenNotifIds = useRef(new Set());
  const seenCommentToasts = useRef(new Set());
  const knownCommentKeys = useRef(null);
  const identityRef = useRef(null);
  const selectedStudentRef = useRef('All');

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  };

  const showToast = (input) => {
    if (!input) return;
    const message = typeof input === 'string' ? input : input.message;
    if (!message) return;
    const toast = {
      id: (typeof input === 'object' && input.id) || `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: (typeof input === 'object' && input.type) || 'info',
      message,
      assignmentId: typeof input === 'object' ? (input.assignmentId || null) : null,
      notificationId: typeof input === 'object' ? (input.notificationId || null) : null
    };
    const existingTimer = toastTimers.current.get(toast.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      toastTimers.current.delete(toast.id);
    }
    setToasts((prev) => [...prev.filter((row) => row.id !== toast.id), toast].slice(-4));
    const duration = typeof input === 'object' && input.duration != null ? input.duration : 4000;
    if (duration > 0) {
      toastTimers.current.set(toast.id, setTimeout(() => dismissToast(toast.id), duration));
    }
  };

  const setAuthBanner = (banner) => {
    if (!banner || typeof banner === 'function' || !banner.message) return;
    showToast({
      type: banner.type === 'success' ? 'success' : banner.type === 'error' ? 'error' : 'info',
      message: banner.message
    });
  };

  // Blackbaud Portal (myschoolapp.com) state
  const [blackbaudStatus, setBlackbaudStatus] = useState({
    connected: false,
    subdomain: 'westlakelutheran',
    students: [],
    verifiedAt: null
  });
  const [blackbaudGrades, setBlackbaudGrades] = useState(() => {
    try {
      const saved = localStorage.getItem('school_dashboard_blackbaud_grades');
      return saved ? cleanDeep(JSON.parse(saved)) : { Ben: [], Jade: [] };
    } catch {
      return { Ben: [], Jade: [] };
    }
  });
  const [blackbaudMissing, setBlackbaudMissing] = useState(() => {
    try {
      const saved = localStorage.getItem('school_dashboard_blackbaud_missing');
      return saved ? cleanDeep(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });
  const [blackbaudAssignments, setBlackbaudAssignments] = useState(() => {
    try {
      const saved = localStorage.getItem('school_dashboard_blackbaud_assignments');
      return saved ? cleanDeep(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });
  const [showBlackbaudModal, setShowBlackbaudModal] = useState(false);
  const [blackbaudCookieInput, setBlackbaudCookieInput] = useState('');
  const [blackbaudBenId, setBlackbaudBenId] = useState('');
  const [blackbaudJadeId, setBlackbaudJadeId] = useState('');
  const [isConnectingBlackbaud, setIsConnectingBlackbaud] = useState(false);
  const [isSyncingBlackbaud, setIsSyncingBlackbaud] = useState(false);
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false);
  const [macWebview, setMacWebview] = useState({ port: 5055, running: false, canStart: false });
  const [macWebviewStarting, setMacWebviewStarting] = useState(false);
  const [loginStatus, setLoginStatus] = useState({
    playwrightRunning: false,
    chromeRunning: false,
    cookiePresent: false,
    lastCheck: null
  });
  const [loginBusy, setLoginBusy] = useState(false);
  const consumedBbHash = useRef(false);
  const portalSyncPoll = useRef(null);
  const syncInFlightRef = useRef(false);
  const reauthPromptedRef = useRef(false);
  const macKeysRef = useRef(null);
  const macFrameRef = useRef(null);
  const closedAuthPopup = useRef(false);
  const claimedMacToken = useRef(null);
  const syncMenuRef = useRef(null);
  const [view, setView] = useState('landing');
  // Task collaboration & comment modal state
  const [selectedTaskForModal, setSelectedTaskForModal] = useState(null);
  const [assignmentDetailLoading, setAssignmentDetailLoading] = useState(false);
  const [assignmentDetailError, setAssignmentDetailError] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [familyNotifications, setFamilyNotifications] = useState([]);
  const [gradeDisplay, setGradeDisplay] = useState(() => {
    try {
      return localStorage.getItem(GRADE_DISPLAY_KEY) === 'percent' ? 'percent' : 'letter';
    } catch {
      return 'letter';
    }
  });

  // Event & email detail modal state
  const [selectedEventForModal, setSelectedEventForModal] = useState(null);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [copiedEmailText, setCopiedEmailText] = useState(false);

  // Persistent state: rehydrates from browser localStorage immediately
  const [tasks, setTasks] = useState(() => {
    try {
      const saved = localStorage.getItem('school_dashboard_tasks');
      return saved ? cleanDeep(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });

  const [events, setEvents] = useState(() => {
    try {
      const saved = localStorage.getItem('school_dashboard_events');
      return saved ? cleanDeep(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });

  const [deletedEventKeys, setDeletedEventKeys] = useState(() => {
    try {
      const saved = localStorage.getItem('school_dashboard_deleted_events');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [eventFilter, setEventFilter] = useState('active'); // 'active' | 'acknowledged'
  const [eventSource, setEventSource] = useState('calendar'); // 'calendar' | 'inbox' | 'all'
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [officialNotes, setOfficialNotes] = useState([]);
  const [featuredNews, setFeaturedNews] = useState([]);
  const [schoolResources, setSchoolResources] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [readOverrides, setReadOverrides] = useState({});
  identityRef.current = blackbaudStatus;
  selectedStudentRef.current = selectedStudent;

  // Persist state to both localStorage and backend Express API only on deliberate user actions
  const persistDashboardState = (newTasks, newEvents, newDeletedKeys, newAssignments) => {
    const t = newTasks !== undefined ? newTasks : tasks;
    const ev = newEvents !== undefined ? newEvents : events;
    const dk = newDeletedKeys !== undefined ? newDeletedKeys : deletedEventKeys;
    const a = newAssignments !== undefined ? newAssignments : blackbaudAssignments;

    try {
      localStorage.setItem('school_dashboard_tasks', JSON.stringify(t));
      localStorage.setItem('school_dashboard_events', JSON.stringify(ev));
      localStorage.setItem('school_dashboard_deleted_events', JSON.stringify(dk));
      localStorage.setItem('school_dashboard_blackbaud_assignments', JSON.stringify(a));
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }

    fetch('/api/dashboard/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: t, events: ev, deletedEventKeys: dk, assignments: a })
    }).catch(err => console.warn('Failed to save dashboard state:', err));
  };

  const applyCalendarAcks = (list) => {
    let acks = {};
    try {
      acks = JSON.parse(localStorage.getItem(CALENDAR_ACK_KEY) || '{}');
    } catch {}
    return (list || []).map((ev) => (
      acks[ev.id]
        ? { ...ev, acknowledged: true, acknowledgedAt: acks[ev.id] }
        : ev
    ));
  };

  const persistCalendarAck = (eventId, acknowledgedAt) => {
    let acks = {};
    try {
      acks = JSON.parse(localStorage.getItem(CALENDAR_ACK_KEY) || '{}');
    } catch {}
    if (acknowledgedAt) acks[eventId] = acknowledgedAt;
    else delete acks[eventId];
    try {
      localStorage.setItem(CALENDAR_ACK_KEY, JSON.stringify(acks));
    } catch {}
  };

  const loadLiveCalendars = async () => {
    const fetchFeed = async (path, label) => {
      try {
        const res = await fetch(path);
        const data = await res.json().catch(() => ({}));
        return Array.isArray(data.events) ? data.events : [];
      } catch (err) {
        console.warn(`${label} calendar unavailable:`, err.message);
        return [];
      }
    };
    const [sports, instructional] = await Promise.all([
      fetchFeed('/api/calendar/sportsyou', 'sportsYou'),
      fetchFeed('/api/calendar/instructional', 'instructional')
    ]);
    const merged = [...sports, ...instructional].sort((a, b) => (a.sortAt || 0) - (b.sortAt || 0));
    setCalendarEvents(applyCalendarAcks(merged));
  };

  const loadSchoolFeeds = async () => {
    try {
      const [notesRes, newsRes, resourcesRes] = await Promise.all([
        fetch('/api/blackbaud/notes'),
        fetch('/api/blackbaud/news'),
        fetch('/api/blackbaud/resources')
      ]);
      const notesData = notesRes.ok ? await notesRes.json().catch(() => ({})) : {};
      const newsData = newsRes.ok ? await newsRes.json().catch(() => ({})) : {};
      const resourcesData = resourcesRes.ok ? await resourcesRes.json().catch(() => ({})) : {};
      setOfficialNotes(cleanDeep(notesData.notes || []));
      setFeaturedNews(cleanDeep(newsData.items || []));
      setSchoolResources(cleanDeep(resourcesData.items || []));
    } catch (err) {
      console.warn('School feeds unavailable:', err.message);
    }
  };

  // Sync Inbox function calling backend Express API
  const handleSyncInbox = async (mode = 'incremental') => {
    setIsSyncing(true);
    setSyncDropdownOpen(false);
    try {
      const res = await fetch(`/api/dashboard/sync?mode=${mode}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setAuthBanner({
            type: 'info',
            message: 'Please connect your Google Account first to sync school emails from your inbox.'
          });
          setShowAuthModal(true);
        } else {
          setAuthBanner({
            type: 'error',
            message: errData.message || `Sync failed with status: ${res.status}`
          });
        }
        return;
      }
      const rawData = await res.json();
      const data = cleanDeep(rawData);
      
      // Update tasks preserving user completed checks and comments where titles match
      if (Array.isArray(data.tasks)) {
        setTasks(data.tasks);
        try {
          localStorage.setItem('school_dashboard_tasks', JSON.stringify(data.tasks));
        } catch {}
      }

      if (Array.isArray(data.events)) {
        setEvents(data.events);
        try {
          localStorage.setItem('school_dashboard_events', JSON.stringify(data.events));
        } catch {}
      }
      setSyncSource(data.source || 'gmail_api');
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSynced(timeStr);
      try {
        localStorage.setItem('school_dashboard_last_synced', timeStr);
      } catch {}

      if (data.message) {
        setAuthBanner({
          type: 'success',
          message: data.message
        });
      }
      await loadLiveCalendars();
    } catch (err) {
      console.error('Failed to sync with server API:', err);
      setAuthBanner({
        type: 'error',
        message: 'Could not connect to dashboard server to sync.'
      });
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSynced(timeStr);
    } finally {
      setTimeout(() => setIsSyncing(false), 600);
    }
  };

  const fetchAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        setAuthStatus(data);
      }
    } catch (err) {
      console.warn('Auth status check unavailable:', err.message);
    }
  };

  const toastCommentOnce = (message, assignmentId, notificationId) => {
    if (!message) return;
    const key = `${assignmentId || ''}:${message}`;
    if (seenCommentToasts.current.has(key)) return;
    seenCommentToasts.current.add(key);
    showToast({
      type: 'comment',
      message,
      assignmentId: assignmentId || null,
      notificationId: notificationId || null
    });
  };

  const noteIncomingComments = (assignments, extraTasks) => {
    const { keys, toasts: incoming } = collectNewIncomingComments(
      [...(assignments || []), ...(extraTasks || [])],
      knownCommentKeys.current,
      identityRef.current
    );
    knownCommentKeys.current = keys;
    incoming.forEach((row) => toastCommentOnce(row.message, row.assignmentId));
  };

  const loadFamilyNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      const list = data.notifications || data.items || [];
      setFamilyNotifications(list);
      list.filter((item) => !item.read && item.id && !seenNotifIds.current.has(item.id)).forEach((item) => {
        seenNotifIds.current.add(item.id);
        toastCommentOnce(
          notificationToastMessage(item) || item.message,
          item.assignmentId,
          item.id
        );
      });
    } catch {
      /* notifications are optional */
    }
  };

  // Load persisted state from server on startup
  const loadDashboardState = async () => {
    try {
      const res = await fetch('/api/dashboard/state');
      if (res.ok) {
        const rawData = await res.json();
        const data = cleanDeep(rawData);
        if (Array.isArray(data.tasks)) {
          setTasks(data.tasks);
          try {
            localStorage.setItem('school_dashboard_tasks', JSON.stringify(data.tasks));
          } catch {}
        }
        if (Array.isArray(data.events)) {
          setEvents(data.events);
          try {
            localStorage.setItem('school_dashboard_events', JSON.stringify(data.events));
          } catch {}
        }
        if (data.deletedEventKeys && Array.isArray(data.deletedEventKeys)) {
          setDeletedEventKeys(data.deletedEventKeys);
          try {
            localStorage.setItem('school_dashboard_deleted_events', JSON.stringify(data.deletedEventKeys));
          } catch {}
        }
        if (data.grades) {
          setBlackbaudGrades(data.grades);
          try {
            localStorage.setItem('school_dashboard_blackbaud_grades', JSON.stringify(data.grades));
          } catch {}
        }
        if (data.missingAssignments && Array.isArray(data.missingAssignments)) {
          setBlackbaudMissing(data.missingAssignments);
          try {
            localStorage.setItem('school_dashboard_blackbaud_missing', JSON.stringify(data.missingAssignments));
          } catch {}
        }
        if (Array.isArray(data.assignments)) {
          setBlackbaudAssignments(data.assignments);
          try {
            localStorage.setItem('school_dashboard_blackbaud_assignments', JSON.stringify(data.assignments));
          } catch {}
        }
        noteIncomingComments(data.assignments || [], data.tasks || []);
        if (data.lastSyncedAt) {
          const timeStr = new Date(data.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setLastSynced(timeStr);
          try {
            localStorage.setItem('school_dashboard_last_synced', timeStr);
          } catch {}
        }
        loadFamilyNotifications();
      }
    } catch (err) {
      console.warn('Failed to load dashboard state:', err.message);
    }
  };

  useEffect(() => {
    window.name = 'school-dashboard';
    fetchAuthStatus();
    loadLiveCalendars();
    (async () => {
      const status = await fetchBlackbaudStatus();
      if (status?.connected) {
        await loadDashboardState();
        await loadSchoolFeeds();
      } else {
        setBlackbaudGrades({ Ben: [], Jade: [] });
        setBlackbaudMissing([]);
      }
    })();

    // Check OAuth return params
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      setAuthBanner({
        type: 'success',
        message: 'Google Account successfully linked! Live Gmail synchronization is now active.'
      });
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchAuthStatus();
      handleSyncInbox('incremental');
    } else if (params.get('auth') === 'failed' || params.get('auth') === 'error') {
      const errorMsg = params.get('message') || 'Google authentication could not be completed.';
      setAuthBanner({
        type: 'error',
        message: decodeURIComponent(errorMsg)
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => {
      if (portalSyncPoll.current) {
        clearInterval(portalSyncPoll.current);
        portalSyncPoll.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (selectedPost) setSelectedPost(null);
        if (selectedEventForModal) setSelectedEventForModal(null);
        if (selectedTaskForModal) setSelectedTaskForModal(null);
        if (showBlackbaudModal) setShowBlackbaudModal(false);
        if (showAuthModal) setShowAuthModal(false);
        if (syncDropdownOpen) setSyncDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPost, selectedEventForModal, selectedTaskForModal, showBlackbaudModal, showAuthModal, syncDropdownOpen]);

  useEffect(() => {
    if (!syncDropdownOpen) return undefined;
    const onDoc = (e) => {
      if (syncMenuRef.current && !syncMenuRef.current.contains(e.target)) {
        setSyncDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [syncDropdownOpen]);

  useEffect(() => {
    if (!showBlackbaudModal) return undefined;
    refreshMacWebview();
    const id = setInterval(() => {
      refreshMacWebview();
      fetchBlackbaudStatus();
      loadDashboardState();
    }, 4000);
    return () => clearInterval(id);
  }, [showBlackbaudModal]);

  useEffect(() => {
    if (view !== 'dashboard' || !blackbaudStatus.connected) return undefined;
    void loadFamilyNotifications();
    void loadReadState();
    const id = setInterval(() => {
      void loadFamilyNotifications();
    }, 20000);
    return () => clearInterval(id);
  }, [view, blackbaudStatus.connected]);

  const fetchBlackbaudStatus = async () => {
    try {
      const res = await fetch('/api/blackbaud/status', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setBlackbaudStatus(data);
        if (data.role === 'student' && Array.isArray(data.allowedStudentKeys) && data.allowedStudentKeys.length === 1) {
          setSelectedStudent(data.allowedStudentKeys[0]);
          setNewTaskStudent(data.allowedStudentKeys[0]);
        }
        if (!data.connected) {
          setBlackbaudGrades({ Ben: [], Jade: [] });
          setBlackbaudMissing([]);
        }
        return data;
      }
    } catch (err) {
      console.warn('Blackbaud status check unavailable:', err.message);
    }
    return null;
  };

  const connectBlackbaudCookie = async (rawCookie) => {
    const cookie = (rawCookie || '').trim();
    if (!cookie) return false;
    setIsConnectingBlackbaud(true);
    try {
      const res = await fetch('/api/blackbaud/connect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookie,
          benStudentId: blackbaudBenId.trim() || undefined,
          jadeStudentId: blackbaudJadeId.trim() || undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBlackbaudStatus({
          connected: true,
          subdomain: 'westlakelutheran',
          students: data.data?.students || [],
          verifiedAt: new Date().toISOString()
        });
        setShowBlackbaudModal(false);
        setBlackbaudCookieInput('');
        setAuthBanner({
          type: 'success',
          message: 'Blackbaud Portal linked! Fetching live course grades & assignments...'
        });
        await handleSyncBlackbaud({ openPortal: false });
        return true;
      }
      setAuthBanner({
        type: 'error',
        message: data.error || data.note || 'Failed to connect Blackbaud. Please verify session cookie.'
      });
      return false;
    } catch (err) {
      console.error('Error connecting Blackbaud:', err);
      setAuthBanner({
        type: 'error',
        message: 'Connection failed: ' + err.message
      });
      return false;
    } finally {
      setIsConnectingBlackbaud(false);
    }
  };

  const handleConnectBlackbaud = async (e) => {
    if (e) e.preventDefault();
    await connectBlackbaudCookie(blackbaudCookieInput);
  };

  const copyBlackbaudBookmarklet = async () => {
    const href = buildBlackbaudBookmarklet(window.location.origin);
    try {
      await navigator.clipboard.writeText(href);
      setBookmarkletCopied(true);
      setTimeout(() => setBookmarkletCopied(false), 2000);
    } catch {
      setAuthBanner({
        type: 'error',
        message: 'Could not copy the bookmarklet. Drag the bookmark link to your bookmarks bar instead.'
      });
    }
  };

  const refreshMacWebview = async () => {
    try {
      const res = await fetch('/api/blackbaud/mac-webview', { credentials: 'include' });
      if (res.ok) {
        setMacWebview(await res.json());
      }
    } catch {}
  };

  const startMacWebview = async () => {
    setMacWebviewStarting(true);
    try {
      await fetch('/api/blackbaud/mac-webview/start', { method: 'POST', credentials: 'include' });
      for (let i = 0; i < 30; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const res = await fetch('/api/blackbaud/mac-webview', { credentials: 'include' });
        if (!res.ok) continue;
        const data = await res.json();
        setMacWebview(data);
        if (data.running) break;
      }
    } catch (err) {
      setAuthBanner({
        type: 'error',
        message: 'Could not start the Mac webview: ' + err.message
      });
    } finally {
      setMacWebviewStarting(false);
    }
  };

  const macWebviewOrigin = () => {
    const port = macWebview.port || 5055;
    if (typeof window === 'undefined') return `http://127.0.0.1:${port}`;
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  };

  const sendMacWebviewInput = (payload) => {
    void fetch(`${macWebviewOrigin()}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  };

  const focusMacKeys = () => {
    window.setTimeout(() => macKeysRef.current?.focus(), 120);
  };

  const handleMacWebviewKeyDown = (event) => {
    const fromBridge = event.target === macKeysRef.current;
    if (!fromBridge && event.target && event.target.closest && event.target.closest('input, textarea, select, button')) {
      return;
    }
    const special = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Home', 'End'];
    if (event.metaKey || event.ctrlKey || event.altKey || special.includes(event.key)) {
      event.preventDefault();
      sendMacWebviewInput({
        action: 'key',
        type: 'down',
        key: event.key,
        code: event.code,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey
      });
    }
  };

  const handleMacWebviewKeyUp = (event) => {
    const fromBridge = event.target === macKeysRef.current;
    if (!fromBridge && event.target && event.target.closest && event.target.closest('input, textarea, select, button')) {
      return;
    }
    const special = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Home', 'End'];
    if (event.metaKey || event.ctrlKey || event.altKey || special.includes(event.key)) {
      event.preventDefault();
      sendMacWebviewInput({
        action: 'key',
        type: 'up',
        key: event.key,
        code: event.code,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey
      });
    }
  };

  const handleMacWebviewChange = (event) => {
    const text = event.target.value;
    if (!text) return;
    event.target.value = '';
    sendMacWebviewInput({ action: 'type', text });
  };

  const handleMacWebviewPaste = (event) => {
    const text = event.clipboardData?.getData('text');
    if (!text) return;
    event.preventDefault();
    sendMacWebviewInput({ action: 'type', text });
  };

  useEffect(() => {
    if (!showBlackbaudModal || !macWebview.running) return;
    focusMacKeys();
  }, [showBlackbaudModal, macWebview.running]);

  useEffect(() => {
    if (consumedBbHash.current) return;
    const hash = window.location.hash || '';
    const ingested = hash.includes('bb_ingested=1') || new URLSearchParams(window.location.search).get('bb_ingested') === '1';
    const ingestFailed = hash.includes('bb_ingested=0');
    if (ingested || ingestFailed) {
      consumedBbHash.current = true;
      window.history.replaceState({}, document.title, window.location.pathname);
      if (ingestFailed) {
        setAuthBanner({
          type: 'error',
          message: 'Could not pull grades. Keep the Westlake portal tab open and signed in, then click the bookmark again.'
        });
        return;
      }
      setAuthBanner({
        type: 'success',
        message: 'Pulled live grades from the Westlake portal.'
      });
      fetchBlackbaudStatus();
      loadDashboardState();
      return;
    }

    const fromHash = hash.match(/bb_t=([^&]+)/);
    const fromQuery = new URLSearchParams(window.location.search).get('bb_t');
    const raw = fromHash ? fromHash[1] : fromQuery;
    if (!raw) return;
    consumedBbHash.current = true;
    const token = decodeURIComponent(raw);
    window.history.replaceState({}, document.title, window.location.pathname);
    setAuthBanner({
      type: 'info',
      message: 'Got session token t from the parent portal. Connecting…'
    });
    connectBlackbaudCookie(token);
  }, []);

  const handleDisconnectBlackbaud = async () => {
    try {
      await fetch('/api/blackbaud/disconnect', { method: 'POST', credentials: 'include' });
      setBlackbaudStatus({ connected: false, students: [], role: null, displayName: null, allowedStudentKeys: [] });
      setBlackbaudGrades({ Ben: [], Jade: [] });
      setBlackbaudMissing([]);
      setBlackbaudAssignments([]);
      try {
        localStorage.removeItem('school_dashboard_blackbaud_grades');
        localStorage.removeItem('school_dashboard_blackbaud_missing');
        localStorage.removeItem('school_dashboard_blackbaud_assignments');
      } catch {}
      setAuthBanner({
        type: 'info',
        message: 'Signed out of this device. Other people on the network keep their own sessions.'
      });
      setShowBlackbaudModal(false);
      setView('landing');
    } catch (err) {
      console.error('Error disconnecting Blackbaud:', err);
    }
  };

  const applyBlackbaudSync = (rawData) => {
    const data = cleanDeep(rawData || {});
    if (data.grades) {
      setBlackbaudGrades(data.grades);
      try {
        localStorage.setItem('school_dashboard_blackbaud_grades', JSON.stringify(data.grades));
      } catch {}
    }
    if (data.missingAssignments && Array.isArray(data.missingAssignments)) {
      setBlackbaudMissing(data.missingAssignments);
      try {
        localStorage.setItem('school_dashboard_blackbaud_missing', JSON.stringify(data.missingAssignments));
      } catch {}
    }
    if (Array.isArray(data.assignments)) {
      setBlackbaudAssignments((prev) => {
        const commentsById = new Map((prev || []).map((a) => [a.id, a.comments || []]));
        const merged = data.assignments.map((a) => ({
          ...a,
          comments: (a.comments && a.comments.length) ? a.comments : (commentsById.get(a.id) || [])
        }));
        try {
          localStorage.setItem('school_dashboard_blackbaud_assignments', JSON.stringify(merged));
        } catch {}
        return merged;
      });
    }
    if (Array.isArray(data.tasks)) {
      setTasks(data.tasks);
      try {
        localStorage.setItem('school_dashboard_tasks', JSON.stringify(data.tasks));
      } catch {}
    }
    if (data.connected) {
      reauthPromptedRef.current = false;
      setBlackbaudStatus(prev => ({
        ...prev,
        connected: true,
        students: data.students || prev.students || [],
        role: data.role || prev.role,
        userKey: data.userKey || prev.userKey,
        displayName: data.displayName || prev.displayName,
        accountName: data.accountName || prev.accountName,
        firstName: data.firstName || prev.firstName,
        lastName: data.lastName || prev.lastName,
        nickName: data.nickName || prev.nickName,
        email: data.email || prev.email,
        photoUrl: data.photoUrl || prev.photoUrl,
        userId: data.userId || prev.userId,
        allowedStudentKeys: data.allowedStudentKeys || prev.allowedStudentKeys,
        verifiedAt: data.lastSyncedAt || new Date().toISOString()
      }));
      if (data.role === 'student' && Array.isArray(data.allowedStudentKeys) && data.allowedStudentKeys.length === 1) {
        setSelectedStudent(data.allowedStudentKeys[0]);
        setNewTaskStudent(data.allowedStudentKeys[0]);
      }
    }
    loadFamilyNotifications();
    return data;
  };

  const gradeCountFrom = (data) => Object.values(data?.grades || {}).reduce(
    (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
    0
  );

  const finishMacSignIn = (data, { closePopup = true } = {}) => {
    const gradeCount = gradeCountFrom(data);
    const studentCount = Array.isArray(data?.students) ? data.students.length : 0;
    if (closePopup) {
      closedAuthPopup.current = true;
      setShowBlackbaudModal(false);
      setView('dashboard');
    }
    if (portalSyncPoll.current) {
      clearInterval(portalSyncPoll.current);
      portalSyncPoll.current = null;
    }
    if (gradeCount > 0) {
      setAuthBanner({
        type: 'success',
        message: `Signed in. Loaded live grades${studentCount ? ` for ${studentCount} students` : ' for Ben and Jade'}. Chromium stays running on this Mac.`
      });
    } else {
      setAuthBanner({
        type: 'success',
        message: 'Signed in. Chromium stays running on this Mac so the session remains live.'
      });
    }
  };

  const startPortalGradePoll = () => {
    if (portalSyncPoll.current) clearInterval(portalSyncPoll.current);
    closedAuthPopup.current = false;
    const started = Date.now();
    portalSyncPoll.current = setInterval(async () => {
      if (closedAuthPopup.current) {
        clearInterval(portalSyncPoll.current);
        portalSyncPoll.current = null;
        return;
      }
      if (Date.now() - started > 5 * 60 * 1000) {
        clearInterval(portalSyncPoll.current);
        portalSyncPoll.current = null;
        return;
      }
      try {
        const wvRes = await fetch('/api/blackbaud/mac-webview', { credentials: 'include' });
        if (wvRes.ok) {
          const wv = await wvRes.json();
          setMacWebview(wv);
          if (wv.posted && (wv.homeReady || /\/app\/(parent|student)(?:\/|\?|#|$)/i.test(wv.url || ''))) {
            if (wv.claimToken && claimedMacToken.current !== wv.claimToken) {
              claimedMacToken.current = wv.claimToken;
              const claimRes = await fetch('/api/blackbaud/claim', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claimToken: wv.claimToken })
              });
              if (claimRes.ok) {
                const claimed = await claimRes.json();
                setBlackbaudStatus({ connected: true, ...(claimed.data || {}) });
              }
            }
            const syncRes = await fetch('/api/blackbaud/sync', { credentials: 'include' });
            const data = applyBlackbaudSync(await syncRes.json());
            await fetchBlackbaudStatus();
            await loadDashboardState();
            finishMacSignIn(data, { closePopup: true });
            return;
          }
        }
      } catch {}
    }, 1500);
  };

  const promptBlackbaudReauth = async () => {
    setAuthBanner({
      type: 'info',
      message: 'Blackbaud needs a sign-in. Use Log in with Blackbaud here — Chromium stays in the background on this Mac.'
    });
    setShowBlackbaudModal(true);
    startPortalGradePoll();
    let running = macWebview.running || loginStatus.playwrightRunning || loginStatus.chromeRunning;
    try {
      const [wvRes, loginRes] = await Promise.all([
        fetch('/api/blackbaud/mac-webview', { credentials: 'include' }),
        fetch('/api/blackbaud/login-status', { credentials: 'include' })
      ]);
      if (wvRes.ok) {
        const wv = await wvRes.json();
        setMacWebview(wv);
        running = Boolean(wv.running || wv.playwrightRunning || wv.chromeRunning);
      }
      if (loginRes.ok) {
        const login = await loginRes.json();
        setLoginStatus(login);
        running = running || Boolean(login.playwrightRunning || login.chromeRunning || login.running);
      }
    } catch {}
    if (!running) {
      void startMacWebview();
    }
  };

  const applyLoginProbe = ({ status, login, webview }) => {
    if (status && typeof status.connected === 'boolean') setBlackbaudStatus(status);
    if (login) setLoginStatus(login);
    if (webview) setMacWebview(webview);
  };

  const claimMacSession = async (claimToken) => {
    if (!claimToken) return false;
    if (claimedMacToken.current === claimToken) return true;
    const claimRes = await fetch('/api/blackbaud/claim', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimToken })
    });
    if (!claimRes.ok) return false;
    claimedMacToken.current = claimToken;
    const claimed = await claimRes.json();
    setBlackbaudStatus({ connected: true, ...(claimed.data || {}) });
    return true;
  };

  const handleReconnectBlackbaud = async () => {
    setLoginBusy(true);
    try {
      const [statusRes, loginRes, wvRes] = await Promise.all([
        fetch('/api/blackbaud/status', { credentials: 'include' }),
        fetch('/api/blackbaud/login-status', { credentials: 'include' }),
        fetch('/api/blackbaud/mac-webview', { credentials: 'include' })
      ]);
      const status = statusRes.ok ? await statusRes.json() : null;
      const login = loginRes.ok ? await loginRes.json() : null;
      const wv = wvRes.ok ? await wvRes.json() : null;
      applyLoginProbe({ status, login, webview: wv });
      if (status?.connected || login?.dashboardConnected) {
        setView('dashboard');
        return;
      }
      const claimToken = wv?.claimToken || login?.claimToken;
      if (claimToken && await claimMacSession(claimToken)) {
        await fetchBlackbaudStatus();
        await loadDashboardState();
        setView('dashboard');
        setAuthBanner({
          type: 'success',
          message: 'Blackbaud is connected. Chromium stays running on this Mac.'
        });
        return;
      }
      setShowBlackbaudModal(true);
      startPortalGradePoll();
    } catch (err) {
      setAuthBanner({
        type: 'error',
        message: 'Could not reconnect to Blackbaud on this Mac.'
      });
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLoginWithBlackbaud = async () => {
    setLoginBusy(true);
    try {
      const [statusRes, loginRes, wvRes] = await Promise.all([
        fetch('/api/blackbaud/status', { credentials: 'include' }),
        fetch('/api/blackbaud/login-status', { credentials: 'include' }),
        fetch('/api/blackbaud/mac-webview', { credentials: 'include' })
      ]);
      const status = statusRes.ok ? await statusRes.json() : null;
      const login = loginRes.ok ? await loginRes.json() : null;
      const wv = wvRes.ok ? await wvRes.json() : null;
      applyLoginProbe({ status, login, webview: wv });
      if (status?.connected || login?.dashboardConnected) {
        setView('dashboard');
        return;
      }
      const chromeUp = Boolean(
        login?.playwrightRunning
        || login?.chromeRunning
        || login?.running
        || wv?.running
        || wv?.playwrightRunning
        || wv?.chromeRunning
      );
      if (chromeUp && (login?.tokenValid || wv?.tokenValid)) {
        await handleReconnectBlackbaud();
        return;
      }
      if (chromeUp) {
        setShowBlackbaudModal(true);
        startPortalGradePoll();
        return;
      }
    } catch {
      /* fall through to a fresh sign-in */
    } finally {
      setLoginBusy(false);
    }
    claimedMacToken.current = null;
    void handleSyncBlackbaud({ openPortal: true });
  };

  const handleSyncBlackbaud = async (options = {}) => {
    const openPortal = options?.openPortal === true;
    const quiet = options?.quiet === true;
    if (openPortal) {
      closedAuthPopup.current = false;
      setShowBlackbaudModal(true);
      startPortalGradePoll();
      setAuthBanner({
        type: 'info',
        message: 'Opening the Mac sign-in. It stays open through redirects and closes once /app/parent or /app/student loads.'
      });
      void startMacWebview();
      return;
    }
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setIsSyncingBlackbaud(true);
    if (!quiet) {
      showToast({
        id: 'blackbaud-refresh',
        type: 'info',
        message: 'Refreshing from Blackbaud...',
        duration: 12000
      });
    }
    try {
      const keys = blackbaudSyncStudentKeys(identityRef.current || blackbaudStatus, selectedStudentRef.current);
      const qs = keys.length ? `?students=${encodeURIComponent(keys.join(','))}` : '';
      const res = await fetch(`/api/blackbaud/sync${qs}`, { credentials: 'include' });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      const msg = String(data.error || data.message || '');
      const tokenExpired =
        res.status === 401
        || res.status === 403
        || data.needsReauth === true
        || /SESSION_EXPIRED|token t is not valid|re-authenticate|re-run the bookmarklet/i.test(msg);
      const needsReauth = tokenExpired || data.connected === false || /not connected/i.test(msg);
      if (needsReauth) {
        setBlackbaudStatus((prev) => ({ ...prev, connected: false, verifiedAt: null }));
        showToast({
          id: 'blackbaud-refresh',
          type: 'error',
          message: "Couldn't refresh — sign in again"
        });
        if (!reauthPromptedRef.current) {
          reauthPromptedRef.current = true;
          void promptBlackbaudReauth();
        }
        return;
      }
      if (!res.ok) {
        showToast({
          id: 'blackbaud-refresh',
          type: 'error',
          message: "Couldn't refresh from Blackbaud"
        });
        return;
      }
      data = applyBlackbaudSync(data);
      noteIncomingComments(data.assignments || [], data.tasks || []);
      await loadSchoolFeeds();
      if (!quiet) {
        showToast({
          id: 'blackbaud-refresh',
          type: 'success',
          message: 'Grades and assignments updated'
        });
      }
      void loadFamilyNotifications();
    } catch (err) {
      console.error('Failed to sync Blackbaud:', err);
      showToast({
        id: 'blackbaud-refresh',
        type: 'error',
        message: "Couldn't refresh from Blackbaud"
      });
    } finally {
      syncInFlightRef.current = false;
      setIsSyncingBlackbaud(false);
    }
  };

  useEffect(() => {
    if (view !== 'dashboard' || !blackbaudStatus.connected) return undefined;
    const kick = () => {
      if (document.visibilityState === 'hidden') return;
      void handleSyncBlackbaud({ openPortal: false, quiet: true });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    kick();
    const id = window.setInterval(kick, BLACKBAUD_AUTO_SYNC_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [view, blackbaudStatus.connected, selectedStudent]);

  const loadReadState = async () => {
    try {
      const res = await fetch('/api/read-state', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const next = {};
      for (const [key, row] of Object.entries(data.items || {})) {
        if (row && typeof row.read === 'boolean') next[key] = row.read;
      }
      setReadOverrides(next);
    } catch (err) {
      console.warn('Read state unavailable:', err.message);
    }
  };

  const withReadOverride = (item) => {
    if (!item?.id) return item;
    const key = `${item.feed || item.kind || 'post'}:${item.id}`;
    if (!Object.prototype.hasOwnProperty.call(readOverrides, key)) return item;
    return { ...item, viewed: readOverrides[key] };
  };

  const applyPostRead = (item, read) => {
    if (!item?.id) return;
    const patch = { viewed: read, readAt: read ? new Date().toISOString() : null };
    const match = (row) => row.id === item.id;
    const key = `${item.feed || item.kind || 'post'}:${item.id}`;
    setReadOverrides((prev) => ({ ...prev, [key]: read }));
    setOfficialNotes((prev) => prev.map((row) => (match(row) ? { ...row, ...patch } : row)));
    setFeaturedNews((prev) => prev.map((row) => (match(row) ? { ...row, ...patch } : row)));
    setSchoolResources((prev) => prev.map((row) => (match(row) ? { ...row, ...patch } : row)));
    setSelectedPost((prev) => (prev && prev.id === item.id ? { ...prev, ...patch } : prev));
  };

  const persistPostRead = async (item, read) => {
    applyPostRead(item, read);
    try {
      await fetch('/api/read-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          itemId: item.id,
          feed: item.feed || item.kind || 'post',
          read
        })
      });
    } catch (err) {
      console.warn('Read state failed:', err.message);
    }
  };

  const openPost = (item, extra = {}) => {
    const next = toPostItem(item, extra);
    setSelectedPost(next);
    if (next?.id && next.viewed !== true) {
      void persistPostRead(next, true);
    }
    return next;
  };

  const handleOpenOfficialNote = async (item) => {
    if (!item) return;
    const opened = openPost(item, { feed: item.feed || 'notes' });
    if (!item.id || String(item.id).startsWith('gmail_') || item.kind === 'gmail') return;
    try {
      const res = await fetch(`/api/blackbaud/notes/detail?id=${encodeURIComponent(item.id)}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (data.note) {
        const next = toPostItem(cleanDeep(data.note), { feed: 'notes', viewed: true });
        setSelectedPost(next);
        setOfficialNotes((prev) => prev.map((row) => (
          row.id === item.id
            ? { ...row, ...next, viewed: true, description: next.description || row.description }
            : row
        )));
      }
    } catch (err) {
      console.warn('Official note detail unavailable:', err.message);
    }
    return opened;
  };

  const handleOpenFeaturedItem = async (item) => {
    if (!item) return;
    openPost(item, { feed: 'news' });
    if (!item.id || item.type === 'Bulletin') return;
    try {
      const res = await fetch(`/api/blackbaud/news/detail?id=${encodeURIComponent(item.id)}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (data.item) {
        const next = toPostItem(cleanDeep(data.item), { feed: 'news', viewed: true });
        setSelectedPost(next);
        setFeaturedNews((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...next, viewed: true } : row)));
      }
    } catch (err) {
      console.warn('School news detail unavailable:', err.message);
    }
  };

  const handleSelectCalendarEvent = (event) => {
    if (!event) return;
    setSelectedPost(null);
    setSelectedEventForModal({
      ...event,
      type: event.type || (isInstructionalEvent(event) ? 'instructional' : 'sports'),
      source: event.source || (isInstructionalEvent(event) ? 'instructional' : 'sportsYou'),
      feed: 'calendar'
    });
  };

  const handleOpenResource = (item) => {
    if (!item) return;
    openPost(item, { feed: 'resources' });
  };

  const handleOpenClassPost = (item) => {
    if (!item) return;
    openPost(item, { feed: item.feed || item.kind || 'bulletin' });
  };

  const handleConnectGoogle = () => {
    if (authStatus.configured) {
      window.location.href = '/auth/google';
    } else {
      setShowAuthModal(true);
    }
  };

  const handleDisconnectGoogle = async () => {
    try {
      await fetch('/api/auth/disconnect', { method: 'POST' });
      setAuthStatus(prev => ({ ...prev, authenticated: false }));
      setAuthBanner({
        type: 'info',
        message: 'Disconnected Google Account. Switched to offline sample mode.'
      });
      setTimeout(() => setAuthBanner(null), 5000);
    } catch (err) {
      console.error('Error disconnecting Google account:', err);
    }
  };

  // Toggle completion status of a task
  const toggleTask = (taskId) => {
    setTasks(prev => {
      const updated = prev.map(task => {
        if (task.id === taskId) {
          const u = { ...task, completed: !task.completed };
          if (selectedTaskForModal && selectedTaskForModal.id === taskId) {
            setSelectedTaskForModal(u);
          }
          return u;
        }
        return task;
      });
      persistDashboardState(updated);
      return updated;
    });
  };

  const applyMissingAckLocally = (taskId, ack) => {
    const on = ack?.acknowledged === true;
    const patch = {
      doneOverride: on,
      acknowledged: on,
      acknowledgedAt: on ? ack.acknowledgedAt : null,
      acknowledgedBy: on ? ack.acknowledgedBy : null,
      acknowledgedByKey: on ? ack.acknowledgedByKey : null,
      missingAck: ack
    };
    setBlackbaudAssignments((prev) => {
      const next = (prev || []).map((a) => (a.id === taskId ? { ...a, ...patch } : a));
      try {
        localStorage.setItem('school_dashboard_blackbaud_assignments', JSON.stringify(next));
      } catch {}
      return next;
    });
    setSelectedTaskForModal((prev) => {
      if (!prev || prev.id !== taskId) return prev;
      const next = { ...prev, ...patch, completed: on };
      if (on) return { ...next, status: 'done' };
      const status = classifyAssignment({
        assignedAt: parsePortalDate(next.assignedDateISO || next.assignedDate),
        dueAt: parsePortalDate(next.dueDateISO || next.dueDate),
        doneOverride: false,
        acknowledged: false,
        isMissing: next.isMissing === true,
        pointsEarned: next.pointsEarned ?? next.PointsEarned,
        maxPoints: next.maxPoints ?? next.MaxPoints,
        letter: next.letter || next.Letter || next.letterGrade,
        grade: next
      });
      return { ...next, status };
    });
  };

  const handleMissingAck = async (task, acknowledged) => {
    if (!task?.id) return;
    const optimistic = {
      assignmentId: task.id,
      student: task.student || null,
      acknowledged,
      acknowledgedAt: acknowledged ? new Date().toISOString() : null,
      acknowledgedBy: familyFirstName(blackbaudStatus.displayName || blackbaudStatus.accountName || blackbaudStatus.userKey),
      acknowledgedByKey: blackbaudStatus.userKey || null
    };
    applyMissingAckLocally(task.id, optimistic);
    try {
      const res = await fetch(`/api/assignments/${encodeURIComponent(task.id)}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ acknowledged, student: task.student || null })
      });
      if (!res.ok) throw new Error('ack failed');
      const data = await res.json();
      if (data?.ack) applyMissingAckLocally(task.id, data.ack);
    } catch (err) {
      console.warn('Missing ack failed:', err.message);
      applyMissingAckLocally(task.id, {
        ...optimistic,
        acknowledged: !acknowledged,
        acknowledgedAt: acknowledged ? null : task.acknowledgedAt,
        acknowledgedBy: acknowledged ? null : task.acknowledgedBy
      });
    }
  };

  // Delete a task
  const deleteTask = (taskId, e) => {
    if (e) e.stopPropagation();
    setTasks(prev => {
      const updated = prev.filter(t => t.id !== taskId);
      persistDashboardState(updated);
      return updated;
    });
    if (selectedTaskForModal && selectedTaskForModal.id === taskId) {
      setSelectedTaskForModal(null);
    }
  };

  const setGradeDisplayMode = (mode) => {
    setGradeDisplay(mode);
    try {
      localStorage.setItem(GRADE_DISPLAY_KEY, mode);
    } catch {
      /* ignore quota */
    }
  };

  const patchTaskComments = (taskId, comments) => {
    const apply = (list) => list.map((item) => {
      if (item.id !== taskId) return item;
      const u = { ...item, comments };
      setSelectedTaskForModal((prev) => (prev && prev.id === taskId ? { ...prev, comments } : prev));
      return u;
    });
    if (String(taskId || '').startsWith('bb_')) {
      setBlackbaudAssignments((prev) => {
        const updated = apply(prev);
        persistDashboardState(undefined, undefined, undefined, updated);
        return updated;
      });
    } else {
      setTasks((prev) => {
        const updated = apply(prev);
        persistDashboardState(updated);
        return updated;
      });
    }
  };

  // Open task detail & collaboration modal
  const handleOpenTaskModal = async (task) => {
    const fromPortal = (blackbaudAssignments || []).find((t) => t.id === task.id);
    const fromCustom = (tasks || []).find((t) => t.id === task.id);
    const current = fromPortal || fromCustom || task;
    setSelectedTaskForModal(current);
    setCommentText('');
    setAssignmentDetailError(false);
    setFamilyNotifications((prev) => prev.map((item) => (
      item.assignmentId === current.id ? { ...item, read: true } : item
    )));

    fetch(`/api/assignments/${encodeURIComponent(current.id)}/comments`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!Array.isArray(data?.comments)) return;
        setSelectedTaskForModal((prev) => (
          prev && prev.id === current.id ? { ...prev, comments: data.comments } : prev
        ));
        const apply = (list) => list.map((item) => (
          item.id === current.id ? { ...item, comments: data.comments } : item
        ));
        if (String(current.id || '').startsWith('bb_')) {
          setBlackbaudAssignments((prev) => apply(prev));
        } else {
          setTasks((prev) => apply(prev));
        }
      })
      .catch(() => {});

    fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId: current.id })
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.notifications)) setFamilyNotifications(data.notifications);
      })
      .catch(() => {});

    if (!current.assignmentId) {
      setAssignmentDetailLoading(false);
      return;
    }
    setAssignmentDetailLoading(true);
    try {
      const res = await fetch(`/api/blackbaud/assignment/${current.assignmentId}`);
      if (!res.ok) {
        setAssignmentDetailError(true);
        return;
      }
      const detail = await res.json();
      setSelectedTaskForModal((prev) => {
        if (!prev || prev.id !== current.id) return prev;
        return {
          ...prev,
          longDescription: detail.longDescription || prev.longDescription,
          type: detail.type || prev.type,
          dropbox: detail.dropbox,
          onPaper: detail.onPaper,
          maxPoints: detail.maxPoints ?? prev.maxPoints
        };
      });
    } catch (err) {
      console.warn('Assignment detail unavailable:', err.message);
      setAssignmentDetailError(true);
    } finally {
      setAssignmentDetailLoading(false);
    }
  };

  const handleToastActivate = (toast) => {
    dismissToast(toast.id);
    if (!toast.assignmentId) return;
    const task = (blackbaudAssignments || []).find((item) => item.id === toast.assignmentId)
      || (tasks || []).find((item) => item.id === toast.assignmentId)
      || { id: toast.assignmentId, title: toast.message };
    void handleOpenTaskModal(task);
    void fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: toast.notificationId || undefined,
        assignmentId: toast.assignmentId
      })
    }).catch(() => {});
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim() || !selectedTaskForModal) return;
    const text = commentText.trim();
    const profileName = familyFirstName(
      blackbaudStatus.displayName || blackbaudStatus.accountName || 'Family'
    );
    const optimistic = {
      id: `comm_${Date.now()}`,
      author: profileName,
      authorKey: blackbaudStatus.userKey || null,
      authorUserId: blackbaudStatus.userId || null,
      authorPhoto: blackbaudStatus.photoUrl || null,
      role: blackbaudStatus.role || null,
      text,
      timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        + ' at '
        + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const next = [...(selectedTaskForModal.comments || []), optimistic];
    patchTaskComments(selectedTaskForModal.id, next);
    setCommentText('');
    if (knownCommentKeys.current) {
      knownCommentKeys.current.add(`${selectedTaskForModal.id}:${optimistic.id}`);
    }
    showToast({
      type: 'success',
      message: sentCommentToast(blackbaudStatus.userKey, blackbaudStatus.role, selectedTaskForModal.student)
    });

    try {
      const res = await fetch(`/api/assignments/${encodeURIComponent(selectedTaskForModal.id)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          student: selectedTaskForModal.student,
          title: selectedTaskForModal.title
        })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.comments)) {
        patchTaskComments(selectedTaskForModal.id, data.comments);
      } else if (data.comment) {
        const swapped = next.map((c) => (c.id === optimistic.id ? data.comment : c));
        patchTaskComments(selectedTaskForModal.id, swapped);
      }
    } catch (err) {
      console.warn('Family comment save failed:', err.message);
    }
  };

  const handleDeleteComment = async (taskId, commentId) => {
    const current = (String(taskId || '').startsWith('bb_')
      ? blackbaudAssignments
      : tasks
    ).find((item) => item.id === taskId) || selectedTaskForModal;
    const next = (current?.comments || []).filter((c) => c.id !== commentId);
    patchTaskComments(taskId, next);

    try {
      await fetch(
        `/api/assignments/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
        { method: 'DELETE' }
      );
    } catch (err) {
      console.warn('Family comment delete failed:', err.message);
    }
  };

  // Add a new manual task
  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const student = (selectedStudent === 'Ben' || selectedStudent === 'Jade') ? selectedStudent : newTaskStudent;

    const newTask = {
      id: `task_custom_${Date.now()}`,
      title: newTaskTitle.trim(),
      student,
      course: newTaskCourse,
      dueDate: newTaskDue || 'Assigned',
      source: 'Family',
      completed: false,
      status: 'assigned',
      priority: 'medium',
      comments: []
    };

    setTasks(prev => {
      const updated = [newTask, ...prev];
      persistDashboardState(updated);
      return updated;
    });
    setNewTaskTitle('');
    setIsAddingTask(false);
    setTaskFilter('assigned');
  };

  // Acknowledge an event (marks acknowledged and removes from active view)
  const acknowledgeEvent = (eventId, e) => {
    if (e) e.stopPropagation();
    const acknowledgedAt = new Date().toISOString();
    if (isLiveCalendarId(eventId)) {
      persistCalendarAck(eventId, acknowledgedAt);
      setCalendarEvents((prev) => prev.map((ev) => (
        ev.id === eventId ? { ...ev, acknowledged: true, acknowledgedAt } : ev
      )));
    } else {
      setEvents(prev => {
        const updated = prev.map(ev => {
          if (ev.id === eventId) {
            return {
              ...ev,
              acknowledged: true,
              acknowledgedAt
            };
          }
          return ev;
        });
        persistDashboardState(undefined, updated);
        return updated;
      });
    }
    setSelectedEventForModal(prev => (prev && prev.id === eventId ? { ...prev, acknowledged: true, acknowledgedAt } : prev));
    setAuthBanner({
      type: 'success',
      message: 'Event acknowledged and removed from active schedule.'
    });
    setTimeout(() => {
      setAuthBanner(prev => (prev?.message?.includes('acknowledged') ? null : prev));
    }, 3500);
  };

  // Restore an acknowledged event back to active
  const restoreEvent = (eventId, e) => {
    if (e) e.stopPropagation();
    if (isLiveCalendarId(eventId)) {
      persistCalendarAck(eventId, null);
      setCalendarEvents((prev) => prev.map((ev) => (
        ev.id === eventId ? { ...ev, acknowledged: false, acknowledgedAt: null } : ev
      )));
    } else {
      setEvents(prev => {
        const updated = prev.map(ev => {
          if (ev.id === eventId) {
            return {
              ...ev,
              acknowledged: false,
              acknowledgedAt: null
            };
          }
          return ev;
        });
        persistDashboardState(undefined, updated);
        return updated;
      });
    }
    setSelectedEventForModal(prev => (prev && prev.id === eventId ? { ...prev, acknowledged: false, acknowledgedAt: null } : prev));
    setAuthBanner({
      type: 'info',
      message: 'Event restored to active schedule.'
    });
    setTimeout(() => {
      setAuthBanner(prev => (prev?.message?.includes('restored') ? null : prev));
    }, 3500);
  };

  // Delete an event permanently (removes from list and prevents future sync re-adding)
  const deleteEvent = (eventId, eventTitle, eventDate, e) => {
    if (e) e.stopPropagation();
    const eventKey = (eventId || `${(eventTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '')}_${eventDate || ''}`).toLowerCase();

    const nextInbox = events.filter(ev => ev.id !== eventId);
    const nextCalendar = calendarEvents.filter(ev => ev.id !== eventId);
    const nextKeys = Array.from(new Set([...deletedEventKeys, eventKey]));
    setEvents(nextInbox);
    setCalendarEvents(nextCalendar);
    setDeletedEventKeys(nextKeys);
    persistDashboardState(undefined, nextInbox, nextKeys);
    setSelectedEventForModal(prev => (prev && prev.id === eventId ? null : prev));

    setAuthBanner({
      type: 'info',
      message: 'Event deleted from schedule.'
    });
    setTimeout(() => {
      setAuthBanner(prev => (prev?.message?.includes('deleted') ? null : prev));
    }, 3500);
  };

  const handleCopyEmailText = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedEmailText(true);
    setTimeout(() => setCopiedEmailText(false), 2000);
  };

  const fridayLabel = formatAssignmentDate(fridayOfCurrentWeek());
  const childLabel = selectedStudent === 'All' ? 'Ben and Jade' : selectedStudent;

  const checklistItems = useMemo(() => {
    const now = new Date();
    const fromPortal = (blackbaudAssignments || []).map((item) => {
      const assignedAt = parsePortalDate(item.assignedDateISO || item.assignedDate);
      const dueAt = parsePortalDate(item.dueDateISO || item.dueDate);
      const familyDone = item.doneOverride === true || item.acknowledged === true;
      const status = classifyAssignment({
        assignedAt,
        dueAt,
        now,
        doneOverride: familyDone,
        acknowledged: familyDone,
        completed: familyDone,
        done: familyDone,
        isMissing: item.isMissing === true,
        pointsEarned: item.pointsEarned ?? item.PointsEarned,
        maxPoints: item.maxPoints ?? item.MaxPoints,
        letter: item.letter || item.Letter || item.letterGrade,
        grade: item
      });
      return {
        ...item,
        status,
        completed: familyDone || Boolean(item.completed),
        dueDate: item.dueDate || formatAssignmentDate(dueAt),
        assignedDate: item.assignedDate || formatAssignmentDate(assignedAt)
      };
    });
    const custom = (tasks || [])
      .filter((t) => String(t.id || '').startsWith('task_custom_'))
      .map((t) => ({
        ...t,
        status: t.completed ? 'done' : 'assigned',
        source: t.source || 'Family'
      }));
    const items = [...fromPortal, ...custom];
    if (blackbaudStatus.role === 'student') {
      const allowed = new Set(blackbaudStatus.allowedStudentKeys || []);
      return items.filter((item) => allowed.has(item.student));
    }
    return items;
  }, [blackbaudAssignments, tasks, blackbaudStatus.role, blackbaudStatus.allowedStudentKeys]);

  const scopedChecklist = checklistItems.filter((item) => (
    selectedStudent === 'All' || item.student === selectedStudent
  ));

  const checklistCounts = {
    overdue: scopedChecklist.filter((i) => i.status === 'overdue').length,
    dueSoon: scopedChecklist.filter((i) => i.status === 'dueSoon').length,
    assigned: scopedChecklist.filter((i) => i.status === 'assigned').length,
    missing: scopedChecklist.filter((i) => i.status === 'missing').length,
    done: scopedChecklist.filter((i) => i.status === 'done').length
  };

  const filteredTasks = scopedChecklist
    .filter((item) => item.status === taskFilter)
    .sort((a, b) => compareChecklistAssignments(a, b, taskFilter));

  const scheduleEvents = useMemo(() => {
    const calendar = (calendarEvents || []).map((ev) => {
      if (isInstructionalEvent(ev)) {
        return { ...ev, student: 'All', sport: ev.sport || null, feed: ev.feed || 'calendar' };
      }
      const classified = classifySportsYouEvent(ev.title || '');
      const mapped = classified.sport === 'CC' || classified.sport === 'Volleyball' || classified.sport === 'Boys BB'
        ? { ...ev, sport: ev.sport || classified.sport, student: classified.student }
        : { ...ev };
      return { ...mapped, feed: ev.feed || 'calendar' };
    }).filter((ev) => ev.feed !== 'inbox' && ev.source !== 'gmail' && !ev.emailFrom);
    return calendar;
  }, [calendarEvents]);

  const sportsYouCount = (calendarEvents || []).filter((ev) => ev.source === 'sportsYou').length;
  const instructionalCount = (calendarEvents || []).filter((ev) => isInstructionalEvent(ev)).length;

  // Filter events (excluding deleted, filtered by student and active/acknowledged tab)
  const filteredEvents = scheduleEvents.filter(event => {
    const key = (event.id || `${(event.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}_${event.date || ''}`).toLowerCase();
    if (deletedEventKeys.includes(key)) return false;

    const matchesStudent = selectedStudent === 'All' || event.student === selectedStudent || event.student === 'All';
    if (!matchesStudent) return false;

    if (eventFilter === 'active') return !event.acknowledged;
    if (eventFilter === 'acknowledged') return Boolean(event.acknowledged);
    return true;
  });

  const activeEventsCount = scheduleEvents.filter(ev => {
    const key = (ev.id || `${(ev.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date || ''}`).toLowerCase();
    return !deletedEventKeys.includes(key) && !ev.acknowledged && (selectedStudent === 'All' || ev.student === selectedStudent || ev.student === 'All');
  }).length;

  const acknowledgedEventsCount = scheduleEvents.filter(ev => {
    const key = (ev.id || `${(ev.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date || ''}`).toLowerCase();
    return !deletedEventKeys.includes(key) && Boolean(ev.acknowledged) && (selectedStudent === 'All' || ev.student === selectedStudent || ev.student === 'All');
  }).length;

  const benOpenCount = checklistItems.filter((t) => t.student === 'Ben' && t.status !== 'done' && t.status !== 'upcoming').length;
  const jadeOpenCount = checklistItems.filter((t) => t.student === 'Jade' && t.status !== 'done' && t.status !== 'upcoming').length;
  const pendingCount = checklistCounts.overdue + checklistCounts.dueSoon + checklistCounts.assigned + checklistCounts.missing;
  const completedCount = checklistCounts.done;
  const visibleMissing = (blackbaudMissing || []).filter((m) => {
    if (selectedStudent !== 'All' && m.student !== selectedStudent) return false;
    const match = (blackbaudAssignments || []).find((a) => a.id === m.id);
    if (match?.doneOverride || match?.acknowledged) return false;
    return true;
  });
  const allowedKeys = blackbaudStatus.allowedStudentKeys
    || (blackbaudStatus.role === 'student' ? [] : ['Ben', 'Jade']);
  const canSeeBen = allowedKeys.includes('Ben');
  const canSeeJade = allowedKeys.includes('Jade');
  const isParentViewer = blackbaudStatus.role !== 'student';
  const unreadByAssignment = useMemo(() => {
    const ids = new Set();
    for (const item of familyNotifications) {
      if (!item?.read && item.assignmentId) ids.add(item.assignmentId);
    }
    return ids;
  }, [familyNotifications]);
  const signedInName = blackbaudStatus.displayName || blackbaudStatus.accountName || '';
  const studentPhoto = (name) => photoForStudent(
    blackbaudStatus.students,
    blackbaudGrades,
    blackbaudAssignments,
    name
  );
  const gradeGroups = useMemo(() => {
    const source = blackbaudGrades || {};
    const extra = Object.keys(source).filter((key) => key !== 'Ben' && key !== 'Jade');
    return ['Ben', 'Jade', ...extra]
      .filter((key) => {
        const rows = source[key];
        if (!Array.isArray(rows) || rows.length === 0) return false;
        if (selectedStudent !== 'All' && selectedStudent !== key) return false;
        if (key === 'Ben') return canSeeBen;
        if (key === 'Jade') return canSeeJade;
        return allowedKeys.length === 0 || allowedKeys.includes(key);
      })
      .map((key) => ({
        key,
        title: key === 'Ben' ? 'Ben · High School' : key === 'Jade' ? 'Jade · Middle School' : key,
        rows: source[key]
      }));
  }, [blackbaudGrades, selectedStudent, canSeeBen, canSeeJade, allowedKeys]);

  const mergedOfficialNotes = useMemo(
    () => mergeOfficialNotes(officialNotes, notesFromGmail(events, tasks)).map(withReadOverride),
    [officialNotes, events, tasks, readOverrides]
  );
  const notesUnreadCount = mergedOfficialNotes.filter((item) => (
    item.viewed === false
    && (selectedStudent === 'All' || item.student === selectedStudent || item.student === 'All')
  )).length;
  const newsUnreadCount = featuredNews.map(withReadOverride).filter((item) => item.viewed === false).length;
  const resourcesUnreadCount = schoolResources.map(withReadOverride).filter((item) => item.viewed === false).length;

  return (
    <div className={view === 'landing'
      ? 'wla-app min-h-dvh w-full flex items-center justify-center bg-zinc-950 text-zinc-100'
      : 'wla-app wla-shell min-h-dvh bg-base-200 text-base-content flex flex-col'
    }>
      <ToastViewport
        toasts={toasts}
        onDismiss={dismissToast}
        onActivate={handleToastActivate}
      />
      {view !== 'landing' && (
      <a href="#wla-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 btn btn-sm">
        Skip to content
      </a>
      )}
      {view === 'landing' && (
        <LandingPage
          onLogin={handleLoginWithBlackbaud}
          onOpenDashboard={() => setView('dashboard')}
          onReconnect={handleReconnectBlackbaud}
          onProbe={applyLoginProbe}
          connected={Boolean(blackbaudStatus.connected)}
          account={blackbaudStatus}
          signingIn={macWebviewStarting || showBlackbaudModal || loginBusy}
        />
      )}
      <div
        className={view === 'landing' ? 'hidden' : 'flex-1 flex flex-col min-h-0 w-full md:h-full md:overflow-hidden'}
        aria-hidden={view === 'landing' ? 'true' : undefined}
      >
        <FamilyFolder
          blackbaudStatus={blackbaudStatus}
          isSyncingBlackbaud={isSyncingBlackbaud}
          selectedStudent={selectedStudent}
          setSelectedStudent={setSelectedStudent}
          isParentViewer={isParentViewer}
          canSeeBen={canSeeBen}
          canSeeJade={canSeeJade}
          benOpenCount={benOpenCount}
          jadeOpenCount={jadeOpenCount}
          studentPhoto={studentPhoto}
          taskFilter={taskFilter}
          setTaskFilter={setTaskFilter}
          checklistCounts={checklistCounts}
          filteredTasks={filteredTasks}
          fridayLabel={fridayLabel}
          childLabel={childLabel}
          isAddingTask={isAddingTask}
          setIsAddingTask={setIsAddingTask}
          setNewTaskStudent={setNewTaskStudent}
          newTaskTitle={newTaskTitle}
          setNewTaskTitle={setNewTaskTitle}
          newTaskStudent={newTaskStudent}
          newTaskCourse={newTaskCourse}
          setNewTaskCourse={setNewTaskCourse}
          newTaskDue={newTaskDue}
          setNewTaskDue={setNewTaskDue}
          onAddTask={handleAddTask}
          onOpenTask={handleOpenTaskModal}
          onToggleTask={toggleTask}
          onMissingAck={handleMissingAck}
          unreadByAssignment={unreadByAssignment}
          gradeDisplay={gradeDisplay}
          setGradeDisplayMode={setGradeDisplayMode}
          gradeGroups={gradeGroups}
          onSelectCourse={setSelectedCourse}
          filteredEvents={filteredEvents}
          eventFilter={eventFilter}
          setEventFilter={setEventFilter}
          activeEventsCount={activeEventsCount}
          acknowledgedEventsCount={acknowledgedEventsCount}
          onSelectEvent={handleSelectCalendarEvent}
          calendarEventsCount={(calendarEvents || []).length}
          onRefreshBlackbaud={(opts) => handleSyncBlackbaud({ ...(opts || {}), openPortal: false })}
          onBlackbaudSettings={() => setShowBlackbaudModal(true)}
          onDisconnectBlackbaud={handleDisconnectBlackbaud}
          onOpenLanding={() => setView('landing')}
          sportsYouConnected={sportsYouCount > 0}
          instructionalConnected={instructionalCount > 0}
          officialNotes={mergedOfficialNotes}
          featuredNews={featuredNews.map(withReadOverride)}
          schoolResources={schoolResources.map(withReadOverride)}
          notesUnreadCount={notesUnreadCount}
          newsUnreadCount={newsUnreadCount}
          resourcesUnreadCount={resourcesUnreadCount}
          onOpenOfficialNote={handleOpenOfficialNote}
          onOpenFeaturedItem={handleOpenFeaturedItem}
          onOpenResource={handleOpenResource}
        />
      </div>

      {/* ---------------------------------------------------- */}
      {/* Google Cloud & OAuth Setup Modal                     */}
      {/* ---------------------------------------------------- */}
      {showAuthModal && (
        <div className="modal modal-open" onClick={() => setShowAuthModal(false)}>
          <div className="modal-box max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-info/10 text-info flex items-center justify-center border border-blue-500/20">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-base-content">Google Cloud & Gmail OAuth</h3>
                  <p className="text-xs text-base-content/70">Status & Integration Checklist</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="btn btn-sm btn-circle btn-ghost"
                aria-label="Close Gmail setup"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Client ID Check */}
              <div className="p-3 rounded-xl bg-base-200 border border-base-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-base-content">1. Google Client ID</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Configured
                  </span>
                </div>
                <div className="font-mono text-[11px] text-base-content/70 break-all select-all bg-base-100 p-2 rounded border border-base-300">
                  {authStatus.clientId || '82253624012-97aurejdlmr6nhrcrcf8fj6o0d6a5ge5.apps.googleusercontent.com'}
                </div>
              </div>

              {/* Client Secret Check */}
              <div className="p-3 rounded-xl bg-base-200 border border-base-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-base-content">2. Google Client Secret</span>
                  {authStatus.hasClientSecret ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Ready
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30 flex items-center gap-1">
                      Needs .env entry
                    </span>
                  )}
                </div>
                <p className="text-base-content/70 text-[11px] leading-relaxed">
                  In Google Cloud Console under Credentials &gt; OAuth 2.0 Client IDs, copy your Client Secret and add it to your <code className="bg-base-200 px-1 py-0.5 rounded text-base-content">.env</code> file:
                </p>
                <div className="font-mono text-[11px] text-warning bg-base-100 p-2 rounded border border-base-300">
                  GOOGLE_CLIENT_SECRET=your_secret_here
                </div>
              </div>

              {/* Redirect URI configuration */}
              <div className="p-3 rounded-xl bg-base-200 border border-base-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-base-content">3. Authorized Redirect URI</span>
                  <span className="text-[11px] text-base-content/70">Add to Cloud Console</span>
                </div>
                <p className="text-base-content/70 text-[11px]">
                  Ensure this URI is added under <strong>Authorized redirect URIs</strong> in Google Cloud Console:
                </p>
                <div className="font-mono text-[11px] text-primary break-all select-all bg-base-100 p-2 rounded border border-base-300">
                  {authStatus.redirectUri || 'http://localhost:5001/auth/google/callback'}
                </div>
              </div>

              {/* Required API & Scope */}
              <div className="p-3 rounded-xl bg-base-200 border border-base-300">
                <span className="font-semibold text-base-content">4. Gmail API Scope</span>
                <p className="text-base-content/70 text-[11px] mt-1">
                  Ensure <strong>Gmail API</strong> is enabled in your Google Cloud project library. Scope requested:
                </p>
                <code className="block font-mono text-[11px] text-base-content/70 mt-1 bg-base-100 p-1.5 rounded">
                  https://www.googleapis.com/auth/gmail.readonly
                </code>
              </div>
            </div>

            {/* Actions */}
            <div className="modal-action">
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="btn btn-ghost btn-sm"
              >
                Close
              </button>
              {authStatus.configured ? (
                <a href="/auth/google" className="btn btn-primary btn-sm">
                  Start Google OAuth Flow
                </a>
              ) : (
                <button type="button" disabled className="btn btn-disabled btn-sm">
                  Save Secret to Start
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Blackbaud Chromium (vertical auth VM)                */}
      {/* ---------------------------------------------------- */}
      {showBlackbaudModal && (macWebview.running || macWebviewStarting) && (
        <div
          className="fixed inset-0 z-50 bg-neutral/50 flex items-center justify-center p-4"
          onClick={() => setShowBlackbaudModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mac-auth-title"
            className="relative w-[min(100%,400px)] h-[min(90dvh,720px)] overflow-hidden border border-base-300 bg-base-100 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
              <h3 id="mac-auth-title" className="text-[13px] font-semibold text-base-content bg-base-100 rounded-full px-3 py-1.5">
                Sign in to Westlake
              </h3>
              <button
                type="button"
                aria-label="Close sign-in"
                onClick={() => setShowBlackbaudModal(false)}
                className="pointer-events-auto min-h-11 px-3 rounded-lg bg-base-100 text-[13px] font-semibold text-base-content hover:bg-base-200"
              >
                Close
              </button>
            </div>
            {macWebview.running ? (
              <>
                <iframe
                  ref={macFrameRef}
                  title="Westlake Chromium on this Mac"
                  src={`${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'}:${macWebview.port || 5055}`}
                  className="absolute inset-0 z-0 w-full h-full border-0 bg-base-100"
                  allow="clipboard-read; clipboard-write"
                  tabIndex={-1}
                  onLoad={focusMacKeys}
                  onPointerUp={focusMacKeys}
                />
                <textarea
                  ref={macKeysRef}
                  id="mac-webview-keys"
                  aria-label="Type into the Westlake sign-in window"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="absolute inset-0 z-[5] w-full h-full resize-none border-0 bg-transparent text-transparent caret-transparent opacity-0"
                  style={{ pointerEvents: 'none' }}
                  onKeyDown={handleMacWebviewKeyDown}
                  onKeyUp={handleMacWebviewKeyUp}
                  onChange={handleMacWebviewChange}
                  onPaste={handleMacWebviewPaste}
                />
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-base-content/70 text-sm">
                Starting Chromium…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Blackbaud Portal Connection Modal                    */}
      {/* ---------------------------------------------------- */}
      {showBlackbaudModal && !(macWebview.running || macWebviewStarting) && (
        <div className="modal modal-open" onClick={() => setShowBlackbaudModal(false)}>
          <div className="modal-box max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-warning/20 to-info/20 text-warning flex items-center justify-center border border-warning/30">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-base-content">Westlake Blackbaud Portal</h3>
                  <p className="text-xs text-base-content/70 font-mono">westlakelutheran.myschoolapp.com</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBlackbaudModal(false)}
                className="btn btn-sm btn-circle btn-ghost"
                aria-label="Close Blackbaud settings"
              >
                &times;
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-base-200 border border-base-300 space-y-3 text-xs">
              <span className="font-semibold text-base-content flex items-center gap-1.5">
                <GraduationCap className="w-3.5 h-3.5 text-warning" />
                Sign in on this Mac
              </span>
              <p className="text-base-content/70 text-[11px] leading-relaxed">
                Chrome on this Mac opens only when someone clicks Log in with Blackbaud.
                Each person gets their own dashboard session. Eric and Stefani see Ben and Jade;
                Ben and Jade only see their own grades and tasks.
              </p>
              {macWebview.canStart && !macWebview.running && (
                <p className="text-[11px] text-base-content/60 leading-relaxed">
                  Use Log in with Blackbaud on the landing page to start sign-in.
                </p>
              )}
              <p className="text-[11px] text-base-content/60 leading-relaxed">
                Refresh data from Blackbaud refreshes this signed-in account. Log in with Blackbaud is the only
                control that starts Chromium. Phones on Wi‑Fi use{' '}
                <code className="bg-base-200 px-1 py-0.5 rounded font-mono">http://&lt;this-mac&gt;:5173</code>.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-base-200 border border-base-300 space-y-3 text-xs">
              <span className="font-semibold text-base-content flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-primary" />
                Send grades from the portal
              </span>
              <p className="text-base-content/70 text-[11px] leading-relaxed">
                Sign in at the Westlake portal, then click this bookmark. It keeps that tab
                open, pulls grades there, and opens the dashboard in a new tab.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={typeof window !== 'undefined' ? buildBlackbaudBookmarklet(window.location.origin) : '#'}
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                  draggable
                  className="btn btn-primary btn-sm cursor-grab active:cursor-grabbing"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  Send t to dashboard
                </a>
                <button
                  type="button"
                  onClick={copyBlackbaudBookmarklet}
                  className="btn btn-ghost btn-sm"
                >
                  {bookmarkletCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  {bookmarkletCopied ? 'Copied' : 'Copy bookmarklet'}
                </button>
              </div>
              <p className="text-[11px] text-base-content/60 leading-relaxed">
                Drag the purple chip onto your bookmarks bar. Click it on the signed-in portal — it will not leave that tab.
              </p>
            </div>

            {/* Connect Form */}
            <form onSubmit={handleConnectBlackbaud} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-base-content mb-1">
                  Cookie t value from Web Inspector
                </label>
                <p className="text-[11px] text-base-content/60 mb-1.5 leading-relaxed">
                  Safari: Storage → Cookies → westlakelutheran.myschoolapp.com → cookie
                  {' '}<code className="bg-base-200 px-1 py-0.5 rounded text-warning font-mono">t</code>.
                  It is HttpOnly (scripts cannot read it). Copy the Value column and paste it here.
                </p>
                <textarea
                  required
                  rows={3}
                  value={blackbaudCookieInput}
                  onChange={(e) => setBlackbaudCookieInput(e.target.value)}
                  placeholder="Paste the t cookie value (GUID)"
                  className="textarea textarea-bordered w-full font-mono text-xs"
                />
              </div>

              {/* Student IDs (Optional) */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block font-medium text-base-content mb-1 text-[11px]">
                    Ben's Student ID <span className="text-base-content/60">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={blackbaudBenId}
                    onChange={(e) => setBlackbaudBenId(e.target.value)}
                    placeholder="Auto-detected"
                    className="input input-bordered input-sm w-full font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-base-content mb-1 text-[11px]">
                    Jade's Student ID <span className="text-base-content/60">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={blackbaudJadeId}
                    onChange={(e) => setBlackbaudJadeId(e.target.value)}
                    placeholder="Auto-detected"
                    className="input input-bordered input-sm w-full font-mono"
                  />
                </div>
              </div>

              {/* Status information if already connected */}
              {blackbaudStatus.connected && (
                <div className="p-3 rounded-xl bg-success/10 border border-success/30 flex items-center justify-between text-xs text-success">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                    <span>Currently connected to Westlake Lutheran Portal</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDisconnectBlackbaud}
                    className="btn btn-ghost btn-xs text-error"
                  >
                    Disconnect
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="modal-action">
                <button
                  type="button"
                  onClick={() => setShowBlackbaudModal(false)}
                  className="btn btn-ghost btn-sm"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isConnectingBlackbaud || !blackbaudCookieInput.trim()}
                  className="btn btn-primary btn-sm"
                >
                  {isConnectingBlackbaud ? (
                    <>
                      <span className="loading loading-spinner loading-xs" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Key className="w-3.5 h-3.5" />
                      Connect & Fetch Grades
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Assignment Detail & Family Comments Modal     */}
      {/* ---------------------------------------------------- */}
      {selectedTaskForModal && (
        <div
          className="modal modal-open"
          onClick={() => setSelectedTaskForModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignment-detail-title"
            className="modal-box assignment-detail-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="assignment-detail-topbar">
              <button
                type="button"
                onClick={() => setSelectedTaskForModal(null)}
                className="btn btn-sm btn-circle btn-ghost"
                aria-label="Close assignment details"
              >
                &times;
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-md border ${
                    selectedTaskForModal.student === 'Ben'
                      ? 'bg-info/10 text-info border-info/30'
                      : 'bg-secondary/10 text-secondary border-secondary/30'
                  }`}
                >
                  <ProfileAvatar
                    name={selectedTaskForModal.student}
                    photoUrl={selectedTaskForModal.studentPhoto || studentPhoto(selectedTaskForModal.student)}
                    size={18}
                  />
                  {selectedTaskForModal.student}
                </span>
                {selectedTaskForModal.course && (
                  <span className="text-[13px] px-2.5 py-1 rounded-md bg-base-200 text-base-content border border-base-300">
                    {decodeHtmlEntities(selectedTaskForModal.course)}
                  </span>
                )}
              </div>
            </div>

            <div className="assignment-detail-split">
              <div className="assignment-detail-main">
              {/* Task Details Info */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h2 id="assignment-detail-title" className="text-[17px] sm:text-lg font-semibold text-base-content leading-snug">
                    {decodeHtmlEntities(selectedTaskForModal.title)}
                  </h2>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-3 text-xs text-base-content">
                    <span className="flex items-center gap-1.5 text-warning font-medium">
                      <Clock className="w-3.5 h-3.5" />
                      Due: {selectedTaskForModal.dueDate || '—'}
                    </span>
                    {selectedTaskForModal.assignedDate && (
                      <>
                        <span className="text-base-content/50">&bull;</span>
                        <span className="text-base-content/70">Assigned {selectedTaskForModal.assignedDate}</span>
                      </>
                    )}
                  </div>

                  {/* Complete / Reopen Toggle Button */}
                  {String(selectedTaskForModal.id || '').startsWith('task_custom_') ? (
                  <button
                    type="button"
                    onClick={() => toggleTask(selectedTaskForModal.id)}
                    className={`btn btn-sm ${
                      selectedTaskForModal.completed ? 'btn-success btn-outline' : 'btn-outline'
                    }`}
                  >
                    {selectedTaskForModal.completed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                        Completed
                      </>
                    ) : (
                      <>
                        <Circle className="w-3.5 h-3.5 text-base-content/70" />
                        Mark Complete
                      </>
                    )}
                  </button>
                  ) : (
                    <div className="flex flex-col items-end gap-2">
                    {(selectedTaskForModal.status === 'missing'
                      || selectedTaskForModal.isMissing
                      || isZeroCreditMissing(selectedTaskForModal)
                      || assignmentPercent(selectedTaskForModal.pointsEarned, selectedTaskForModal.maxPoints) != null
                      || String(selectedTaskForModal.letter || selectedTaskForModal.letterGrade || '').trim()) ? (
                      <AssignmentScoreChip
                        earned={selectedTaskForModal.pointsEarned}
                        max={selectedTaskForModal.maxPoints}
                        letter={selectedTaskForModal.letter || selectedTaskForModal.letterGrade}
                        status={selectedTaskForModal.status}
                      />
                    ) : (
                    <span className={`text-[13px] ${gradeToneClass('none')} rounded-md border px-2 py-0.5`}>
                      {selectedTaskForModal.status === 'overdue'
                          ? 'Overdue'
                          : selectedTaskForModal.status === 'dueSoon'
                            ? 'Due soon'
                            : selectedTaskForModal.status === 'assigned'
                              ? 'Assigned'
                              : selectedTaskForModal.status === 'missing'
                                ? 'Missing'
                                : 'Ungraded'}
                    </span>
                    )}
                    {(selectedTaskForModal.status === 'missing' || selectedTaskForModal.status === 'overdue') && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => void handleMissingAck(selectedTaskForModal, true)}
                      >
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        Mark as done
                      </button>
                    )}
                    {(selectedTaskForModal.acknowledged || selectedTaskForModal.doneOverride) && (
                      <>
                        <p className="text-[12px] text-base-content/70">
                          Marked done by {selectedTaskForModal.acknowledgedBy || 'family'}
                          {selectedTaskForModal.acknowledgedAt
                            ? ` · ${formatAckStamp(selectedTaskForModal.acknowledgedAt)}`
                            : ''}
                        </p>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => void handleMissingAck(selectedTaskForModal, false)}
                        >
                          Undo
                        </button>
                      </>
                    )}
                    </div>
                  )}
                </div>
                {(String(selectedTaskForModal.id || '').startsWith('bb_') || selectedTaskForModal.comment || selectedTaskForModal.longDescription) && (
                <div className="rounded-xl border border-base-300 bg-base-100 p-3.5 space-y-2">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wider text-base-content/70">
                    Teacher note
                  </h3>
                  {selectedTaskForModal.teacher && (
                    <p className="text-[13px] text-base-content">{selectedTaskForModal.teacher}</p>
                  )}
                  {selectedTaskForModal.comment ? (
                    <p className="text-[15px] text-base-content leading-relaxed">
                      {decodeHtmlEntities(selectedTaskForModal.comment)}
                    </p>
                  ) : null}
                  {selectedTaskForModal.longDescription ? (
                    <div className={selectedTaskForModal.comment ? 'pt-2 border-t border-base-300' : ''}>
                      <h4 className="text-[12px] font-semibold uppercase tracking-wider text-base-content/70">
                        Directions
                      </h4>
                      <p className="mt-1 text-[15px] text-base-content leading-relaxed whitespace-pre-wrap">
                        {decodeHtmlEntities(selectedTaskForModal.longDescription)}
                      </p>
                    </div>
                  ) : assignmentDetailLoading ? (
                    <p className="text-[13px] text-base-content/70">Loading directions…</p>
                  ) : assignmentDetailError ? (
                    <p className="text-[13px] text-base-content/70">Directions could not be loaded.</p>
                  ) : !selectedTaskForModal.comment ? (
                    <p className="text-[13px] text-base-content/70">No teacher note or directions for this assignment.</p>
                  ) : null}
                </div>
                )}
              </div>

              {/* Email-derived assignment chrome hidden from the family folder UI. */}
            </div>

            <aside className="assignment-detail-sidebar" aria-label="Family comments">
              <FamilyThread
                comments={selectedTaskForModal.comments || []}
                status={blackbaudStatus}
                isParent={isParentViewer}
                student={selectedTaskForModal.student}
                commentText={commentText}
                onCommentText={setCommentText}
                onSend={handleAddComment}
                onDelete={(commentId) => handleDeleteComment(selectedTaskForModal.id, commentId)}
                unreadCount={(familyNotifications || []).filter((n) => (
                  n.assignmentId === selectedTaskForModal.id && !n.read
                )).length}
              />
            </aside>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Event & Full Email Detail Modal                      */}
      {/* ---------------------------------------------------- */}
      {selectedEventForModal && (
        <div
          className="modal modal-open"
          onClick={() => setSelectedEventForModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="modal-box max-w-2xl p-6 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Badges & Close Button */}
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-base-300 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* Student Badge */}
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                    selectedEventForModal.student === 'Ben'
                      ? 'bg-info/10 text-info border-info/30'
                      : selectedEventForModal.student === 'Jade'
                      ? 'bg-secondary/10 text-secondary border-secondary/30'
                      : 'bg-base-200 text-base-content border-base-300'
                  }`}
                >
                  {selectedEventForModal.student}
                </span>

                {/* Event Type Badge */}
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${
                    selectedEventForModal.type === 'sports'
                      ? 'bg-warning/10 text-warning border-warning/30'
                      : selectedEventForModal.type === 'instructional'
                      ? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
                      : selectedEventForModal.type === 'academic'
                      ? 'bg-emerald-500/10 text-success border-success/30'
                      : 'bg-primary/10 text-primary border-primary/30'
                  }`}
                >
                  {selectedEventForModal.type === 'sports' ? (
                    <Trophy className="w-3.5 h-3.5" />
                  ) : selectedEventForModal.type === 'instructional' ? (
                    <Calendar className="w-3.5 h-3.5" />
                  ) : (
                    <GraduationCap className="w-3.5 h-3.5" />
                  )}
                  <span className="capitalize">{selectedEventForModal.type ? selectedEventForModal.type.replace('_', ' ') : 'Event'}</span>
                </span>

                {/* Source Badge */}
                <span className="text-xs px-2 py-0.5 rounded bg-base-200/90 text-base-content/70 border border-base-300">
                  {selectedEventForModal.source}
                </span>

                {/* Status indicator */}
                {selectedEventForModal.acknowledged && (
                  <span className="text-[10px] font-medium text-success bg-success/10 px-2 py-0.5 rounded border border-success/20 inline-flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" />
                    <span>Acknowledged</span>
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedEventForModal(null)}
                className="btn btn-sm btn-circle btn-ghost"
                aria-label="Close event details"
              >
                &times;
              </button>
            </div>

            {/* Event Title & Schedule Info Bar */}
            <div className="py-4 border-b border-base-300 space-y-3 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base sm:text-lg font-bold text-base-content leading-snug">
                  {decodeHtmlEntities(selectedEventForModal.title)}
                </h2>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-3 text-xs text-base-content">
                  <span className="flex items-center gap-1.5 text-warning font-medium">
                    <Calendar className="w-3.5 h-3.5" />
                    {selectedEventForModal.date}
                  </span>
                  <span className="text-base-content/50">&bull;</span>
                  <span className="flex items-center gap-1 text-base-content font-mono">
                    <Clock className="w-3.5 h-3.5 text-base-content/70" />
                    {selectedEventForModal.time}
                  </span>
                  {decodeHtmlEntities(selectedEventForModal.location) ? (
                    <>
                      <span className="text-base-content/50">&bull;</span>
                      <MapsLocationLink
                        address={decodeHtmlEntities(selectedEventForModal.location)}
                        icon={<MapPin className="w-3.5 h-3.5 text-error shrink-0" aria-hidden="true" />}
                        linkClassName="flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline"
                        plainClassName="flex items-center gap-1 text-base-content"
                      />
                    </>
                  ) : null}
                </div>

                {/* Actions: Acknowledge & Delete */}
                <div className="flex items-center gap-2">
                  {!selectedEventForModal.acknowledged ? (
                    <button
                      type="button"
                      onClick={(e) => acknowledgeEvent(selectedEventForModal.id, e)}
                      className="btn btn-success btn-outline btn-sm"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Acknowledge
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => restoreEvent(selectedEventForModal.id, e)}
                      className="btn btn-outline btn-sm"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore to Active
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      if (window.confirm(`Delete "${decodeHtmlEntities(selectedEventForModal.title)}" from schedule?`)) {
                        deleteEvent(selectedEventForModal.id, selectedEventForModal.title, selectedEventForModal.date, e);
                      }
                    }}
                    className="btn btn-ghost btn-sm btn-square text-error"
                    title="Delete event permanently"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {selectedEventForModal.description ? (
            <div className="flex-1 flex flex-col min-h-0 pt-4">
              <p className="text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1.5">Details</p>
              <div className="flex-1 overflow-y-auto bg-base-200 border border-base-300 rounded-xl p-4 text-xs text-base-content leading-relaxed whitespace-pre-wrap">
                {decodeHtmlEntities(selectedEventForModal.description)}
              </div>
            </div>
            ) : null}

            {/* Modal Footer */}
            <div className="modal-action">
              <button
                type="button"
                onClick={() => setSelectedEventForModal(null)}
                className="btn btn-ghost btn-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedPost && (
        <PostDetail
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onToggleRead={(read) => persistPostRead(selectedPost, read)}
        />
      )}
      {selectedCourse && (
        <ClassDetailModal
          course={selectedCourse}
          assignments={checklistItems}
          onClose={() => setSelectedCourse(null)}
          onOpenTask={handleOpenTaskModal}
          onOpenPost={handleOpenClassPost}
          readOverrides={readOverrides}
          taskModalOpen={Boolean(selectedTaskForModal)}
        />
      )}
    </div>
  );
}
