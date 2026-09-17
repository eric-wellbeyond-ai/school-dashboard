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
import CalendarBoard from './CalendarBoard.jsx';
import ClassDetailModal from './ClassDetailModal.jsx';
import CourseGradeList from './CourseGradeList.jsx';
import {
  classifyAssignment,
  formatAssignmentDate,
  fridayOfCurrentWeek,
  parsePortalDate,
  assignmentSortValue,
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
  if (zeroMissing && status !== 'done') {
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
  const band = zeroMissing ? 'missing' : gradeBandFromLetterOrPercent(letterText, score.percent);
  return (
    <span className={`inline-flex flex-col items-end gap-0.5 ${className}`}>
      <span className={`${GRADE_CHIP_CLASS} ${gradeToneClass(band)}`}>
        {zeroMissing ? (score.raw || '0') : (score.percentLabel || letterText)}
      </span>
      {score.raw && !zeroMissing ? (
        <span className="text-[11px] tabular-nums text-base-content/60">{score.raw}</span>
      ) : null}
    </span>
  );
}

function familyFirstName(name) {
  const n = String(name || '').trim();
  if (!n) return 'Family';
  return n.split(/\s+/)[0];
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
          <h3 id="family-thread-title" className="family-thread-title">Family comments</h3>
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

function ProfileAvatar({ name, photoUrl, size = 28, className = '' }) {
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
      className={`inline-flex items-center justify-center rounded-full shrink-0 font-semibold bg-base-200 text-base-content ${className}`}
      style={{ width: dim, height: dim, fontSize: Math.max(11, Math.round(size * 0.4)) }}
    >
      {initial}
    </span>
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
  const consumedBbHash = useRef(false);
  const portalSyncPoll = useRef(null);
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
  identityRef.current = blackbaudStatus;

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

  const loadSportsYouCalendar = async () => {
    try {
      const res = await fetch('/api/calendar/sportsyou');
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.events)) {
        setCalendarEvents(applyCalendarAcks(data.events));
      }
    } catch (err) {
      console.warn('sportsYou calendar unavailable:', err.message);
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
      await loadSportsYouCalendar();
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
    loadSportsYouCalendar();
    (async () => {
      const status = await fetchBlackbaudStatus();
      if (status?.connected) {
        await loadDashboardState();
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
        if (selectedEventForModal) setSelectedEventForModal(null);
        if (selectedTaskForModal) setSelectedTaskForModal(null);
        if (showBlackbaudModal) setShowBlackbaudModal(false);
        if (showAuthModal) setShowAuthModal(false);
        if (syncDropdownOpen) setSyncDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEventForModal, selectedTaskForModal, showBlackbaudModal, showAuthModal, syncDropdownOpen]);

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
    const id = setInterval(() => {
      void loadFamilyNotifications();
    }, 20000);
    return () => clearInterval(id);
  }, [view, blackbaudStatus.connected]);

  const fetchBlackbaudStatus = async () => {
    try {
      const res = await fetch('/api/blackbaud/status');
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
      const res = await fetch('/api/blackbaud/mac-webview');
      if (res.ok) {
        setMacWebview(await res.json());
      }
    } catch {}
  };

  const startMacWebview = async () => {
    setMacWebviewStarting(true);
    try {
      await fetch('/api/blackbaud/mac-webview/start', { method: 'POST' });
      for (let i = 0; i < 30; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const res = await fetch('/api/blackbaud/mac-webview');
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
      await fetch('/api/blackbaud/disconnect', { method: 'POST' });
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
        const wvRes = await fetch('/api/blackbaud/mac-webview');
        if (wvRes.ok) {
          const wv = await wvRes.json();
          setMacWebview(wv);
          if (wv.posted && (wv.homeReady || /\/app\/(parent|student)(?:\/|\?|#|$)/i.test(wv.url || ''))) {
            if (wv.claimToken && claimedMacToken.current !== wv.claimToken) {
              claimedMacToken.current = wv.claimToken;
              const claimRes = await fetch('/api/blackbaud/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claimToken: wv.claimToken })
              });
              if (claimRes.ok) {
                const claimed = await claimRes.json();
                setBlackbaudStatus({ connected: true, ...(claimed.data || {}) });
              }
            }
            const syncRes = await fetch('/api/blackbaud/sync');
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
    let running = macWebview.running;
    try {
      const wvRes = await fetch('/api/blackbaud/mac-webview');
      if (wvRes.ok) {
        const wv = await wvRes.json();
        setMacWebview(wv);
        running = Boolean(wv.running);
      }
    } catch {}
    if (!running) {
      void startMacWebview();
    }
  };

  const handleLoginWithBlackbaud = () => {
    claimedMacToken.current = null;
    void handleSyncBlackbaud({ openPortal: true });
  };

  const handleSyncBlackbaud = async ({ openPortal = false } = {}) => {
    if (openPortal) {
      closedAuthPopup.current = false;
      setShowBlackbaudModal(true);
      startPortalGradePoll();
      setAuthBanner({
        type: 'info',
        message: 'Opening the Mac sign-in. It stays open through redirects and closes once /app/parent or /app/student loads.'
      });
      let running = macWebview.running;
      try {
        const wvRes = await fetch('/api/blackbaud/mac-webview');
        if (wvRes.ok) {
          const wv = await wvRes.json();
          setMacWebview(wv);
          running = Boolean(wv.running);
        }
      } catch {}
      if (!running) {
        void startMacWebview();
      }
      return;
    }
    setIsSyncingBlackbaud(true);
    showToast({
      id: 'blackbaud-refresh',
      type: 'info',
      message: 'Refreshing from Blackbaud...',
      duration: 12000
    });
    try {
      const res = await fetch('/api/blackbaud/sync');
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
        showToast({
          id: 'blackbaud-refresh',
          type: 'error',
          message: "Couldn't refresh — sign in again"
        });
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
      showToast({
        id: 'blackbaud-refresh',
        type: 'success',
        message: 'Grades and assignments updated'
      });
      void loadFamilyNotifications();
    } catch (err) {
      console.error('Failed to sync Blackbaud:', err);
      showToast({
        id: 'blackbaud-refresh',
        type: 'error',
        message: "Couldn't refresh from Blackbaud"
      });
    } finally {
      setIsSyncingBlackbaud(false);
    }
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
    if (String(eventId).startsWith('sy_')) {
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
    if (String(eventId).startsWith('sy_')) {
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
      const familyDone = item.doneOverride === true;
      const status = classifyAssignment({
        assignedAt,
        dueAt,
        now,
        doneOverride: familyDone,
        completed: familyDone,
        done: familyDone,
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
    return [...fromPortal, ...custom];
  }, [blackbaudAssignments, tasks]);

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
    .sort((a, b) => {
      const dir = taskFilter === 'done' ? -1 : 1;
      return dir * (assignmentSortValue(a) - assignmentSortValue(b));
    });

  const scheduleEvents = useMemo(() => {
    const tagged = (list, feed) => (list || []).map((ev) => {
      const classified = classifySportsYouEvent(ev.title || '');
      const mapped = classified.sport === 'CC' || classified.sport === 'Volleyball' || classified.sport === 'Boys BB'
        ? { ...ev, sport: ev.sport || classified.sport, student: classified.student }
        : { ...ev, feed: ev.feed || feed };
      return { ...mapped, feed: ev.feed || feed };
    });
    const inbox = tagged(events, 'inbox');
    const calendar = tagged(calendarEvents, 'calendar');
    if (eventSource === 'calendar') return calendar;
    if (eventSource === 'inbox') return inbox;
    const seen = new Set(calendar.map((ev) => `${(ev.title || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${ev.date}`));
    const extraInbox = inbox.filter((ev) => {
      const key = `${(ev.title || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${ev.date}`;
      return !seen.has(key);
    });
    return [...calendar, ...extraInbox].sort((a, b) => (a.sortAt || 0) - (b.sortAt || 0) || String(a.date).localeCompare(String(b.date)));
  }, [events, calendarEvents, eventSource]);

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
  const visibleMissing = (blackbaudMissing || []).filter((m) => (
    selectedStudent === 'All' || m.student === selectedStudent
  ));
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

  return (
    <div className={view === 'landing'
      ? 'wla-app min-h-dvh w-full flex items-center justify-center bg-zinc-950 text-zinc-100'
      : 'wla-app wla-shell min-h-dvh bg-base-200 text-base-content flex flex-col md:flex-row'
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
          connected={Boolean(blackbaudStatus.connected)}
          account={blackbaudStatus}
          signingIn={macWebviewStarting || showBlackbaudModal}
        />
      )}
      <div
        className={view === 'landing' ? 'hidden' : 'flex-1 flex flex-col md:flex-row min-h-0 w-full md:h-full md:overflow-hidden'}
        aria-hidden={view === 'landing' ? 'true' : undefined}
      >
      {/* ---------------------------------------------------- */}
      {/* Sidebar: Navigation & Launch Portals                 */}
      {/* ---------------------------------------------------- */}
      <aside className="w-full md:w-72 md:h-full md:min-h-0 bg-base-200 border-r border-base-300 flex flex-col shrink-0 md:overflow-hidden">
        <div className="flex-1 min-h-0 md:overflow-y-auto p-4">
          <div className="flex items-start gap-3 px-2 pb-4">
            <ProfileAvatar name={signedInName || 'Family'} photoUrl={blackbaudStatus.photoUrl} size={40} />
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-base-content/60">Westlake Lutheran Academy</p>
              <h1 className="text-lg font-semibold leading-tight">Family folder</h1>
              <p className="text-sm text-base-content/70 truncate">
                {signedInName
                  ? `${signedInName}${blackbaudStatus.role ? ` · ${blackbaudStatus.role}` : ''}`
                  : 'Sign in to see grades'}
              </p>
              {blackbaudStatus.email && (
                <p className="text-xs text-base-content/50 truncate">{blackbaudStatus.email}</p>
              )}
            </div>
          </div>

          <ul className="menu p-0">
            <li className="menu-title">Portals</li>
            <li>
              <a href="https://westlakelutheran.myschoolapp.com" target="_blank" rel="noopener noreferrer" id="link-blackbaud">
                <GraduationCap className="w-4 h-4" />
                <span>
                  Blackbaud
                  <span className="block text-xs font-normal opacity-60">Parent portal</span>
                </span>
                {blackbaudStatus.connected && <span className="badge badge-success badge-xs" aria-label="Connected" />}
                <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-50" />
              </a>
            </li>
            <li>
              <a href="https://launchpad.classlink.com" target="_blank" rel="noopener noreferrer" id="link-classlink">
                <LinkIcon className="w-4 h-4" />
                <span>
                  ClassLink
                  <span className="block text-xs font-normal opacity-60">Single sign-on</span>
                </span>
                <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-50" />
              </a>
            </li>
            <li>
              <a href="https://www.sportsyou.com/login" target="_blank" rel="noopener noreferrer" id="link-sportsyou">
                <Trophy className="w-4 h-4" />
                <span>
                  sportsYou
                  <span className="block text-xs font-normal opacity-60">Athletics &amp; teams</span>
                </span>
                <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-50" />
              </a>
            </li>
            <li className="menu-title">Students</li>
            {canSeeBen && (
              <li>
                <button type="button" aria-pressed={selectedStudent === 'Ben'} className={selectedStudent === 'Ben' ? 'active' : ''} onClick={() => setSelectedStudent('Ben')}>
                  <ProfileAvatar name="Ben" photoUrl={studentPhoto('Ben')} size={28} />
                  <span>
                    Ben
                    <span className="block text-xs font-normal opacity-60">High school</span>
                  </span>
                  <span className="badge badge-ghost">{benOpenCount} open</span>
                </button>
              </li>
            )}
            {canSeeJade && (
              <li>
                <button type="button" aria-pressed={selectedStudent === 'Jade'} className={selectedStudent === 'Jade' ? 'active' : ''} onClick={() => setSelectedStudent('Jade')}>
                  <ProfileAvatar name="Jade" photoUrl={studentPhoto('Jade')} size={28} />
                  <span>
                    Jade
                    <span className="block text-xs font-normal opacity-60">Middle school</span>
                  </span>
                  <span className="badge badge-ghost">{jadeOpenCount} open</span>
                </button>
              </li>
            )}
          </ul>
        </div>

        <div className="p-4 border-t border-base-300 space-y-2 shrink-0">
          <button type="button" onClick={handleConnectGoogle} className="btn btn-outline btn-sm btn-block">
            <Shield className="w-4 h-4" />
            {authStatus.authenticated
              ? 'Gmail connected'
              : authStatus.configured
                ? 'Connect Gmail'
                : 'Gmail OAuth Setup'}
          </button>
          <button
            type="button"
            onClick={() => (blackbaudStatus.connected ? setShowBlackbaudModal(true) : setView('landing'))}
            className="btn btn-outline btn-sm btn-block"
          >
            <GraduationCap className="w-4 h-4" />
            {blackbaudStatus.connected ? 'Blackbaud settings' : 'Connect Blackbaud'}
          </button>
          {blackbaudStatus.connected && (
            <button type="button" onClick={handleDisconnectBlackbaud} className="btn btn-ghost btn-xs btn-block">
              Sign out
            </button>
          )}
        </div>
      </aside>

      {/* ---------------------------------------------------- */}
      {/* Main Content Area                                    */}
      {/* ---------------------------------------------------- */}
      <main id="wla-main" className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto bg-base-200">
        <header className="app-topbar navbar sticky top-0 z-30 min-h-14 px-4 bg-zinc-950">
          <div className="flex-1 min-w-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-zinc-50">Grades and schoolwork</h2>
                <span className="badge badge-outline">Fall 2026</span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {lastSynced ? `Inbox synced at ${lastSynced}` : 'Ready to sync with school inbox & sportsYou'}
              </p>
            </div>
          </div>
          <div className="flex-none flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="refresh-blackbaud-button"
              onClick={() => void handleSyncBlackbaud({ openPortal: false })}
              disabled={isSyncingBlackbaud}
              aria-busy={isSyncingBlackbaud}
              className="btn btn-primary min-h-11"
            >
              {isSyncingBlackbaud
                ? <span className="loading loading-spinner loading-xs" aria-hidden="true" />
                : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
              Refresh data from Blackbaud
            </button>
            {authStatus.authenticated ? (
              <div className="flex items-center gap-2">
                <span className="badge badge-success badge-outline">Gmail linked</span>
                <button type="button" onClick={handleDisconnectGoogle} className="btn btn-ghost btn-xs" title="Disconnect Google Account">Disconnect</button>
              </div>
            ) : (
              <button
                id="connect-google-btn"
                type="button"
                onClick={handleConnectGoogle}
                className="btn btn-ghost btn-sm"
                title="Connect Google Account for live Gmail inbox sync"
              >
                {authStatus.configured ? 'Connect Gmail' : 'Gmail OAuth Setup'}
              </button>
            )}
            <div className="relative" ref={syncMenuRef}>
              <div className="join">
                <button
                  id="sync-inbox-button"
                  type="button"
                  onClick={() => handleSyncInbox('incremental')}
                  disabled={isSyncing}
                  title="Sync new emails since previous pull (capped at 2 weeks)"
                  className="btn btn-primary btn-sm join-item"
                >
                  {isSyncing ? <span className="loading loading-spinner loading-xs" /> : <RefreshCw className="w-4 h-4" />}
                  {isSyncing ? 'Syncing...' : 'Sync Inbox'}
                </button>
                <button
                  type="button"
                  id="sync-options-dropdown-button"
                  onClick={() => setSyncDropdownOpen((prev) => !prev)}
                  disabled={isSyncing}
                  className="btn btn-primary btn-sm join-item"
                  aria-label="Sync options"
                  title="Sync options (Incremental vs Full 14-Day)"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              {syncDropdownOpen && (
                <ul className="absolute right-0 top-full mt-2 menu bg-base-100 rounded-box z-50 w-72 p-2 shadow border border-base-300">
                  <li className="menu-title">Email</li>
                  <li>
                    <button type="button" onClick={() => handleSyncInbox('incremental')}>
                      <span>
                        Sync since last pull
                        <span className="block text-xs font-normal opacity-60">From previous pull, up to 2 weeks</span>
                      </span>
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={() => handleSyncInbox('full')}>
                      <span>
                        Full 14-day rescan
                        <span className="block text-xs font-normal opacity-60">Re-analyze inbox mail from the last 14 days</span>
                      </span>
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </header>

        {/* Dashboard Body */}
        <div className="p-6 space-y-6 max-w-7xl w-full mx-auto">
          {/* Top Controls: Student View Toggles & Summary Metrics */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="join">
                {isParentViewer && (
                <button
                  id="toggle-all"
                  type="button"
                  aria-pressed={selectedStudent === 'All'}
                  onClick={() => setSelectedStudent('All')}
                  className={`btn join-item ${selectedStudent === 'All' ? 'btn-active' : ''}`}
                >
                  All
                </button>
                )}
                {canSeeBen && (
                <button
                  id="toggle-ben"
                  type="button"
                  aria-pressed={selectedStudent === 'Ben'}
                  onClick={() => setSelectedStudent('Ben')}
                  className={`btn join-item ${selectedStudent === 'Ben' ? 'btn-active' : ''}`}
                >
                  <ProfileAvatar name="Ben" photoUrl={studentPhoto('Ben')} size={18} />
                  Ben
                </button>
                )}
                {canSeeJade && (
                <button
                  id="toggle-jade"
                  type="button"
                  aria-pressed={selectedStudent === 'Jade'}
                  onClick={() => setSelectedStudent('Jade')}
                  className={`btn join-item ${selectedStudent === 'Jade' ? 'btn-active' : ''}`}
                >
                  <ProfileAvatar name="Jade" photoUrl={studentPhoto('Jade')} size={18} />
                  Jade
                </button>
                )}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="badge badge-lg badge-outline">Open {pendingCount}</span>
              <span className="badge badge-lg badge-outline">Done {completedCount}</span>
              <span className="badge badge-lg badge-outline">Events {filteredEvents.length}</span>
            </div>
          </div>

          {/* Classes left; assignments over calendar on the right */}
          <div className="grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-[auto_auto] gap-6 items-start">
            <section className="order-1 lg:col-start-1 lg:row-start-1 lg:row-span-2 min-w-0 card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="card-title text-base">Classes</h2>
                  <p className="text-sm text-base-content/70">
                    Fall 2026{blackbaudStatus.connected ? ' · Live' : ''}
                  </p>
                </div>
                <div role="radiogroup" aria-label="Grade display" className="join shrink-0">
                  {[
                    { id: 'letter', label: 'Letter' },
                    { id: 'percent', label: 'Percent' }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={gradeDisplay === opt.id}
                      className={`btn btn-sm join-item ${gradeDisplay === opt.id ? 'btn-active' : ''}`}
                      onClick={() => setGradeDisplayMode(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {blackbaudStatus.connected ? (
                  <button type="button" onClick={() => setShowBlackbaudModal(true)} className="btn btn-ghost btn-sm">
                    Settings
                  </button>
                ) : (
                  <button type="button" onClick={() => setView('landing')} className="btn btn-primary btn-sm">
                    Log in with Blackbaud
                  </button>
                )}
              </div>

              {visibleMissing.length > 0 && (
                <div className="mt-3 p-3 rounded-xl bg-warning/10 border border-warning/40">
                  <h3 className="text-[13px] font-semibold text-warning">
                    {visibleMissing.length} missing assignment{visibleMissing.length > 1 ? 's' : ''}
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {visibleMissing.map((m) => (
                      <li key={m.id || `${m.title}-${m.course}`} className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="min-w-0 truncate text-base-content">
                          {decodeHtmlEntities(m.AssignmentTitle || m.title || 'Missing work')}
                        </span>
                        <span className="shrink-0 tabular-nums text-base-content/70">
                          {m.DateDue || m.dueDate || 'Overdue'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3">
                {gradeGroups.length === 0 ? (
                  <div className="py-8 px-3 text-center">
                    <p className="text-[15px] font-semibold text-base-content">
                      {blackbaudStatus.connected ? 'No classes synced yet' : 'Sign in to load classes'}
                    </p>
                    <p className="text-[13px] text-base-content/70 mt-1 leading-relaxed">
                      {blackbaudStatus.connected
                        ? 'Use Refresh data from Blackbaud in the top bar to pull the current term.'
                        : 'Use Log in with Blackbaud on the landing page.'}
                    </p>
                    {!blackbaudStatus.connected && (
                      <button
                        type="button"
                        onClick={() => setView('landing')}
                        className="mt-4 btn btn-primary"
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>Log in with Blackbaud</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <CourseGradeList groups={gradeGroups} mode={gradeDisplay} onSelectCourse={setSelectedCourse} />
                )}
              </div>
              </div>
            </section>

            {/* ---------------------------------------------------- */}
            {/* Assignments next to classes; calendar below */}
            {/* ---------------------------------------------------- */}
            <section className="order-2 lg:col-start-2 lg:row-start-1 min-w-0 card bg-base-100 border border-base-300 shadow-sm flex flex-col">
              <div className="card-body p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="card-title text-base">Assignments</h2>
                  <p className="text-sm text-base-content/70 inline-flex items-center gap-2">
                    {selectedStudent !== 'All' ? (
                      <ProfileAvatar name={selectedStudent} photoUrl={studentPhoto(selectedStudent)} size={20} />
                    ) : null}
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
                  className="btn btn-ghost btn-sm btn-square"
                  aria-expanded={isAddingTask}
                  aria-label="Add family reminder"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div role="tablist" aria-label="Assignment status" className="tabs tabs-boxed">
                {[
                  { id: 'overdue', label: 'Overdue', count: checklistCounts.overdue },
                  { id: 'dueSoon', label: 'Due Soon', count: checklistCounts.dueSoon },
                  { id: 'assigned', label: 'Assigned', count: checklistCounts.assigned },
                  { id: 'missing', label: 'Missing', count: checklistCounts.missing },
                  { id: 'done', label: 'Done', count: checklistCounts.done }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={taskFilter === tab.id}
                    className={`tab ${taskFilter === tab.id ? 'tab-active' : ''}`}
                    onClick={() => setTaskFilter(tab.id)}
                  >
                    {tab.label}
                    <span className="ml-1 opacity-60">{tab.count}</span>
                  </button>
                ))}
              </div>

              {/* Add Custom Task Form Modal / Inline Box */}
              {isAddingTask && (
                <form onSubmit={handleAddTask} className="mt-4 p-4 rounded-xl bg-base-100 border border-primary/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Quick Add Assignment
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAddingTask(false)}
                      className="text-xs text-base-content/60 hover:text-base-content"
                    >
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
                  <button
                    type="submit"
                    className="btn btn-primary btn-block"
                  >
                    Save Assignment
                  </button>
                </form>
              )}

              {/* Task Items List */}
              <div className="mt-2 flex-1 overflow-y-auto max-h-[620px]">
                {filteredTasks.length === 0 ? (
                  <div className="text-center py-12 px-6 rounded-xl border border-dashed border-base-300 text-base-content/70 bg-base-200">
                    {!blackbaudStatus.connected ? (
                      <>
                        <Inbox className="w-8 h-8 mx-auto mb-2 text-base-content/60" />
                        <p className="text-[15px] font-semibold text-base-content">Sign in to load assignments</p>
                        <p className="text-[13px] text-base-content/70 max-w-sm mx-auto mt-1 leading-relaxed">
                          Log in with Blackbaud, then use Refresh data from Blackbaud for {childLabel}.
                        </p>
                        <button
                          type="button"
                          onClick={() => setView('landing')}
                          className="btn btn-primary mt-4"
                        >
                          <Key className="w-3.5 h-3.5" />
                          Log in with Blackbaud
                        </button>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-base-content/60" />
                        <p className="text-[15px] font-semibold text-base-content">
                          {taskFilter === 'overdue' && `No overdue work for ${childLabel}`}
                          {taskFilter === 'dueSoon' && `Nothing due through ${fridayLabel}`}
                          {taskFilter === 'assigned' && `No assigned work in range`}
                          {taskFilter === 'missing' && `No missing work for ${childLabel}`}
                          {taskFilter === 'done' && `No graded assignments yet`}
                        </p>
                        <p className="text-[13px] text-base-content/60 mt-1 max-w-sm mx-auto">
                          {blackbaudAssignments.length === 0
                            ? 'Use Refresh data from Blackbaud in the top bar to pull the current gradebook.'
                            : 'Choose another status, or refresh from the top bar.'}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <ul className="divide-y divide-base-300">
                    {filteredTasks.map((task) => {
                      const isCustom = String(task.id || '').startsWith('task_custom_');
                      const isBen = task.student === 'Ben';
                      return (
                        <li key={task.id} className="flex items-start gap-1">
                          {isCustom && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTask(task.id);
                              }}
                              className="mt-0.5 min-h-11 min-w-11 inline-flex items-center justify-center text-base-content/70 shrink-0"
                              aria-label={task.completed ? 'Mark as open' : 'Mark as done'}
                            >
                              {task.completed ? (
                                <CheckCircle2 className="w-5 h-5 text-success" />
                              ) : (
                                <Circle className="w-5 h-5 text-base-content/60" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenTaskModal(task)}
                            aria-haspopup="dialog"
                            className="group flex-1 min-w-0 text-left py-3 px-1 flex items-start gap-3"
                          >
                            {!isCustom && (
                              <span className="mt-2 w-2 h-2 rounded-full shrink-0" style={{
                                background: task.status === 'overdue'
                                  ? '#ef4444'
                                  : task.status === 'missing'
                                    ? '#b91c1c'
                                    : task.status === 'dueSoon'
                                      ? '#f59e0b'
                                      : '#71717a'
                              }} aria-hidden="true" />
                            )}

                            <div className="min-w-0 flex-1">
                              <p className={`text-[15px] font-medium leading-snug ${task.status === 'done' ? 'text-base-content/70' : 'text-base-content'}`}>
                                {decodeHtmlEntities(task.title)}
                              </p>
                              <p className="mt-1 text-[13px] text-base-content/70 inline-flex items-center gap-1.5 min-w-0">
                                <ProfileAvatar
                                  name={task.student}
                                  photoUrl={task.studentPhoto || studentPhoto(task.student)}
                                  size={18}
                                />
                                <span className={isBen ? 'text-info' : 'text-secondary'}>
                                  {task.student}
                                </span>
                                {task.course ? ` · ${decodeHtmlEntities(task.course)}` : ''}
                                {task.type ? ` · ${decodeHtmlEntities(task.type)}` : ''}
                              </p>
                              {task.comment && (
                                <p className="mt-1 text-[12px] text-base-content/70 truncate">
                                  Teacher note: {decodeHtmlEntities(task.comment)}
                                </p>
                              )}
                              {(task.comments || []).length > 0 && (
                                <p className="mt-1 text-[12px] text-base-content/70 inline-flex items-center gap-1.5">
                                  <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                  Family comments · {(task.comments || []).length}
                                  {unreadByAssignment.has(task.id) ? (
                                    <span className="family-thread-unread">New</span>
                                  ) : null}
                                </p>
                              )}
                              {unreadByAssignment.has(task.id) && !(task.comments || []).length ? (
                                <p className="mt-1 text-[12px] text-base-content/70 inline-flex items-center gap-1.5">
                                  <span className="family-thread-unread">New family comment</span>
                                </p>
                              ) : null}
                            </div>

                            <div className="shrink-0 text-right">
                              <p className={`text-[13px] tabular-nums ${task.status === 'overdue' || task.status === 'missing' ? 'text-error' : 'text-base-content'}`}>
                                {task.dueDate || 'No due date'}
                              </p>
                              {task.status === 'missing' || isZeroCreditMissing(task)
                                || assignmentPercent(task.pointsEarned, task.maxPoints) != null
                                || String(task.letter || task.letterGrade || '').trim() ? (
                                <div className="mt-1">
                                  <AssignmentScoreChip
                                    earned={task.pointsEarned}
                                    max={task.maxPoints}
                                    letter={task.letter || task.letterGrade}
                                    status={task.status}
                                  />
                                </div>
                              ) : task.assignedDate ? (
                                <p className="text-[12px] text-base-content/60">Assigned {task.assignedDate}</p>
                              ) : null}
                            </div>
                            <ChevronRight className="w-4 h-4 mt-1 text-base-content/60 shrink-0" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              </div>
            </section>

            <section className="order-3 lg:col-start-2 lg:row-start-2 min-w-0 min-h-[36rem] overflow-visible relative z-0 card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="card-title text-base">
                      Events
                      <span className="badge badge-ghost font-normal">{activeEventsCount} active</span>
                    </h2>
                    <p className="text-sm text-base-content/70">Live sportsYou calendar</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                <div className="join">
                  <button
                    type="button"
                    onClick={() => setEventSource('calendar')}
                    className={`btn btn-sm join-item ${eventSource === 'calendar' ? 'btn-active' : ''}`}
                  >
                    Calendar
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventSource('inbox')}
                    className={`btn btn-sm join-item ${eventSource === 'inbox' ? 'btn-active' : ''}`}
                  >
                    Inbox
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventSource('all')}
                    className={`btn btn-sm join-item ${eventSource === 'all' ? 'btn-active' : ''}`}
                  >
                    All
                  </button>
                </div>
                <div className="join">
                  <button
                    type="button"
                    onClick={() => setEventFilter('active')}
                    className={`btn btn-sm join-item ${eventFilter === 'active' ? 'btn-active' : ''}`}
                  >
                    Active ({activeEventsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventFilter('acknowledged')}
                    className={`btn btn-sm join-item ${eventFilter === 'acknowledged' ? 'btn-active' : ''}`}
                  >
                    Acknowledged ({acknowledgedEventsCount})
                  </button>
                </div>
                </div>
              </div>

              <CalendarBoard events={filteredEvents} onSelect={setSelectedEventForModal} />
              </div>
            </section>
          </div>
        </div>
      </main>
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
            className="modal-box max-w-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-base-300 shrink-0">
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

            {/* Scrollable Modal Content */}
            <div className="flex-1 overflow-y-auto pr-1 min-h-0 space-y-4 py-3">
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
                    (selectedTaskForModal.status === 'missing'
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
                    )
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

              {/* Original Email Announcement / Notification */}
              {(selectedTaskForModal.emailBody || selectedTaskForModal.emailSubject || selectedTaskForModal.emailFrom) && (
                <div className="bg-base-100 border border-base-300 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 text-primary flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] text-base-content/60 uppercase font-bold tracking-wider">Email Sender</div>
                        <div className="text-xs font-semibold text-base-content truncate">
                          {decodeHtmlEntities(selectedTaskForModal.emailFrom || selectedTaskForModal.source || 'Teacher Announcement')}
                        </div>
                      </div>
                    </div>

                    {/* Copy Button */}
                    {selectedTaskForModal.emailBody && (
                      <button
                        type="button"
                        onClick={() => handleCopyEmailText(selectedTaskForModal.emailBody)}
                        className="btn btn-ghost btn-xs shrink-0"
                        title="Copy full email text"
                      >
                        {copiedEmailText ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-success" />
                            <span className="text-success font-semibold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-base-content/70" />
                            <span>Copy Email</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Subject Line */}
                  {selectedTaskForModal.emailSubject && (
                    <div className="pt-2 border-t border-base-300 text-xs text-base-content flex items-baseline gap-2">
                      <span className="text-base-content/60 shrink-0 font-medium">Subject:</span>
                      <span className="text-base-content font-semibold truncate">{decodeHtmlEntities(selectedTaskForModal.emailSubject)}</span>
                    </div>
                  )}

                  {/* Sent Date */}
                  {selectedTaskForModal.emailDate && (
                    <div className="text-[11px] text-base-content/60 flex items-center gap-1.5">
                      <span>Sent:</span>
                      <span className="text-base-content/70">
                        {isNaN(new Date(selectedTaskForModal.emailDate).getTime())
                          ? selectedTaskForModal.emailDate
                          : new Date(selectedTaskForModal.emailDate).toLocaleString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit'
                            })}
                      </span>
                    </div>
                  )}

                  {/* Scrollable Email Body */}
                  {selectedTaskForModal.emailBody && (
                    <div className="pt-2">
                      <div className="flex items-center justify-between pb-1.5">
                        <span className="text-[10px] font-semibold text-base-content/70 uppercase tracking-wider flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-primary" />
                          Full Email Message
                        </span>
                        <span className="text-[10px] text-base-content/60">Scroll to view entire text</span>
                      </div>
                      <div className="max-h-[220px] overflow-y-auto bg-base-200 border border-base-300 rounded-xl p-3.5 text-xs text-base-content leading-relaxed whitespace-pre-wrap select-text selection:bg-primary/40 font-mono">
                        {decodeHtmlEntities(selectedTaskForModal.emailBody)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Family comments — not Blackbaud, not teachers */}
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
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-base-300 flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedTaskForModal(null)}
                className="btn btn-ghost btn-sm"
              >
                Close
              </button>
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
                      : selectedEventForModal.type === 'academic'
                      ? 'bg-emerald-500/10 text-success border-success/30'
                      : 'bg-primary/10 text-primary border-primary/30'
                  }`}
                >
                  {selectedEventForModal.type === 'sports' ? (
                    <Trophy className="w-3.5 h-3.5" />
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

            {/* Email Metadata & Full Body Section */}
            <div className="flex-1 flex flex-col min-h-0 pt-4 space-y-3">
              {/* Sender & Subject Header Box */}
              <div className="bg-base-100 border border-base-300 rounded-xl p-3.5 space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 text-primary flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-base-content/60 uppercase font-bold tracking-wider">Email Sender</div>
                      <div className="text-xs font-semibold text-base-content truncate">
                        {decodeHtmlEntities(selectedEventForModal.emailFrom || selectedEventForModal.rawEmailFrom || 'sportsYou / School Notification')}
                      </div>
                      {selectedEventForModal.rawEmailFrom && selectedEventForModal.emailFrom !== selectedEventForModal.rawEmailFrom && (
                        <div className="text-[10px] text-base-content/60 truncate">
                          via {decodeHtmlEntities(selectedEventForModal.rawEmailFrom)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Copy Button */}
                  <button
                    type="button"
                    onClick={() => handleCopyEmailText(selectedEventForModal.emailBody || selectedEventForModal.description || '')}
                    className="btn btn-ghost btn-xs"
                    title="Copy full email text"
                  >
                    {copiedEmailText ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-success" />
                        <span className="text-success font-semibold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-base-content/70" />
                        <span>Copy Text</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Email Subject */}
                {selectedEventForModal.emailSubject && (
                  <div className="pt-2 border-t border-base-300 text-xs text-base-content flex items-baseline gap-2">
                    <span className="text-base-content/60 shrink-0 font-medium">Subject:</span>
                    <span className="text-base-content font-semibold truncate">{decodeHtmlEntities(selectedEventForModal.emailSubject)}</span>
                  </div>
                )}

                {/* Email Date if present */}
                {selectedEventForModal.emailDate && (
                  <div className="text-[11px] text-base-content/60 flex items-center gap-1.5">
                    <span>Sent:</span>
                    <span className="text-base-content/70">
                      {isNaN(new Date(selectedEventForModal.emailDate).getTime())
                        ? selectedEventForModal.emailDate
                        : new Date(selectedEventForModal.emailDate).toLocaleString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                    </span>
                  </div>
                )}
              </div>

              {/* Scrollable Email Text Body */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between pb-1.5">
                  <span className="text-xs font-semibold text-base-content/70 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    Full Email Message
                  </span>
                  <span className="text-[11px] text-base-content/60">Original message content</span>
                </div>

                <div className="flex-1 overflow-y-auto bg-base-200 border border-base-300 rounded-xl p-4 text-xs text-base-content leading-relaxed whitespace-pre-wrap select-text selection:bg-primary/40 font-mono">
                  {selectedEventForModal.emailBody ? (
                    decodeHtmlEntities(selectedEventForModal.emailBody)
                  ) : selectedEventForModal.description ? (
                    decodeHtmlEntities(selectedEventForModal.description)
                  ) : (
                    <span className="text-base-content/60 italic">No additional email text body available.</span>
                  )}
                </div>
              </div>
            </div>

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
      {selectedCourse && (
        <ClassDetailModal
          course={selectedCourse}
          assignments={checklistItems}
          onClose={() => setSelectedCourse(null)}
        />
      )}
    </div>
  );
}
