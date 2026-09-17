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
import {
  classifyAssignment,
  formatAssignmentDate,
  fridayOfCurrentWeek,
  parsePortalDate,
  assignmentSortValue
} from './lib/assignmentBuckets.js';

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

function CourseGradeList({ groups, mode }) {
  if (!groups.length) return null;
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key} className="overflow-x-auto">
          {groups.length > 1 && (
            <h3 className="font-semibold text-sm mb-2">{group.title}</h3>
          )}
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Class</th>
                <th>Teacher</th>
                <th className="text-right">Grade</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((c, idx) => (
                <tr key={`${group.key}-${c.course || idx}`}>
                  <td className="font-medium">{decodeHtmlEntities(c.course)}</td>
                  <td className="text-base-content/70">
                    {decodeHtmlEntities(c.teacher || 'Teacher TBA')}
                    {c.room ? ` · Rm ${c.room}` : ''}
                  </td>
                  <td className="text-right font-semibold tabular-nums">{courseGradeValue(c, mode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
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
  const [taskFilter, setTaskFilter] = useState('overdue'); // overdue | dueSoon | assigned | done
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
  const [authBanner, setAuthBanner] = useState(null);

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
  const [gradeDisplay, setGradeDisplay] = useState(() => {
    try {
      return localStorage.getItem(GRADE_DISPLAY_KEY) === 'percent' ? 'percent' : 'letter';
    } catch {
      return 'letter';
    }
  });

  // Event & email detail modal state
  const [selectedEventForModal, setSelectedEventForModal] = useState(null);
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
      if (!res.ok) return;
      const data = await res.json();
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
        if (data.lastSyncedAt) {
          const timeStr = new Date(data.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setLastSynced(timeStr);
          try {
            localStorage.setItem('school_dashboard_last_synced', timeStr);
          } catch {}
        }
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
      void startMacWebview();
      return;
    }
    setIsSyncingBlackbaud(true);
    try {
      const res = await fetch('/api/blackbaud/sync');
      const data = applyBlackbaudSync(await res.json());
      if (data.connected) {
        const gradeCount = gradeCountFrom(data);
        if (gradeCount === 0 && openPortal) {
          setAuthBanner({
            type: 'info',
            message: 'Sign in inside the Mac window. It stays open through the white redirect screens and closes on the parent or student home.'
          });
        } else if (gradeCount > 0 && !openPortal) {
          finishMacSignIn(data, { closePopup: false });
        }
      } else if (openPortal) {
        setShowBlackbaudModal(true);
      }
    } catch (err) {
      console.error('Failed to sync Blackbaud:', err);
      setAuthBanner({
        type: 'info',
        message: 'Could not refresh grades yet. Sign in inside the Mac Playwright window.'
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

  // Open task detail & collaboration modal
  const handleOpenTaskModal = async (task) => {
    const fromPortal = (blackbaudAssignments || []).find((t) => t.id === task.id);
    const fromCustom = (tasks || []).find((t) => t.id === task.id);
    const current = fromPortal || fromCustom || task;
    setSelectedTaskForModal(current);
    setAssignmentDetailError(false);
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

  const handleAddComment = (e) => {
    e.preventDefault();
    if (!commentText.trim() || !selectedTaskForModal) return;
    const profile = {
      name: blackbaudStatus.displayName || blackbaudStatus.accountName || 'Family',
      userId: blackbaudStatus.userId || null,
      photoUrl: blackbaudStatus.photoUrl || null
    };
    const newComment = {
      id: `comm_${Date.now()}`,
      author: profile.name,
      authorUserId: profile.userId,
      authorPhoto: profile.photoUrl,
      text: commentText.trim(),
      timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const apply = (list) => list.map((item) => {
      if (item.id !== selectedTaskForModal.id) return item;
      const u = { ...item, comments: [...(item.comments || []), newComment] };
      setSelectedTaskForModal(u);
      return u;
    });

    if (String(selectedTaskForModal.id || '').startsWith('bb_')) {
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

    setCommentText('');
  };

  const handleDeleteComment = (taskId, commentId) => {
    const apply = (list) => list.map((item) => {
      if (item.id !== taskId) return item;
      const u = {
        ...item,
        comments: (item.comments || []).filter((c) => c.id !== commentId)
      };
      if (selectedTaskForModal && selectedTaskForModal.id === taskId) {
        setSelectedTaskForModal(u);
      }
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
      const done = Boolean(item.done || item.completed);
      const status = classifyAssignment({ assignedAt, dueAt, done, now });
      return {
        ...item,
        status,
        completed: done,
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
    done: scopedChecklist.filter((i) => i.status === 'done').length
  };

  const filteredTasks = scopedChecklist
    .filter((item) => item.status === taskFilter)
    .sort((a, b) => {
      const dir = taskFilter === 'done' ? -1 : 1;
      return dir * (assignmentSortValue(a) - assignmentSortValue(b));
    });

  const scheduleEvents = useMemo(() => {
    const inbox = (events || []).map((ev) => ({ ...ev, feed: ev.feed || 'inbox' }));
    const calendar = calendarEvents || [];
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
  const pendingCount = checklistCounts.overdue + checklistCounts.dueSoon + checklistCounts.assigned;
  const completedCount = checklistCounts.done;
  const visibleMissing = (blackbaudMissing || []).filter((m) => (
    selectedStudent === 'All' || m.student === selectedStudent
  ));
  const allowedKeys = blackbaudStatus.allowedStudentKeys
    || (blackbaudStatus.role === 'student' ? [] : ['Ben', 'Jade']);
  const canSeeBen = allowedKeys.includes('Ben');
  const canSeeJade = allowedKeys.includes('Jade');
  const isParentViewer = blackbaudStatus.role !== 'student';
  const signedInName = blackbaudStatus.displayName || blackbaudStatus.accountName || '';
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
        <header className="navbar bg-base-100 border-b border-base-300 sticky top-0 z-20 min-h-16 px-4">
          <div className="flex-1 min-w-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Grades and schoolwork</h2>
                <span className="badge badge-outline">Fall 2026</span>
              </div>
              <p className="text-xs text-base-content/60 mt-0.5">
                {lastSynced ? `Inbox synced at ${lastSynced}` : 'Ready to sync with school inbox & sportsYou'}
              </p>
            </div>
          </div>
          <div className="flex-none gap-2">
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
                  <li className="menu-title">School portal</li>
                  <li>
                    <button type="button" onClick={() => { setSyncDropdownOpen(false); handleSyncBlackbaud(); }}>
                      <span>
                        Sync Blackbaud
                        <span className="block text-xs font-normal opacity-60">Refresh grades and assignments</span>
                      </span>
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </header>

        {/* OAuth Feedback Banner */}
        {authBanner && (
          <div className="px-4 pt-4">
            <div role="alert" className={`alert ${authBanner.type === 'success' ? 'alert-success' : authBanner.type === 'error' ? 'alert-error' : 'alert-info'}`}>
              <span>{authBanner.message}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAuthBanner(null)} aria-label="Dismiss">Close</button>
            </div>
          </div>
        )}

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

          {/* Assignments on top; classes and calendar side by side below */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <section className="order-2 card bg-base-100 border border-base-300 shadow-sm">
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
                  <>
                    <button type="button" onClick={handleSyncBlackbaud} disabled={isSyncingBlackbaud} className="btn btn-primary btn-sm">
                      {isSyncingBlackbaud ? <span className="loading loading-spinner loading-xs" /> : <RefreshCw className="w-4 h-4" />}
                      {isSyncingBlackbaud ? 'Syncing...' : 'Sync Grades'}
                    </button>
                    <button type="button" onClick={() => setShowBlackbaudModal(true)} className="btn btn-ghost btn-sm">
                      Settings
                    </button>
                  </>
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
                        ? 'Sync grades to pull the current term.'
                        : 'Use Log in with Blackbaud on the landing page.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => (blackbaudStatus.connected ? handleSyncBlackbaud({ openPortal: false }) : setView('landing'))}
                      disabled={isSyncingBlackbaud || macWebviewStarting}
                      className="mt-4 btn btn-primary"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBlackbaud || macWebviewStarting ? 'animate-spin' : ''}`} />
                      <span>{isSyncingBlackbaud ? 'Syncing…' : (blackbaudStatus.connected ? 'Sync Grades' : 'Log in with Blackbaud')}</span>
                    </button>
                  </div>
                ) : (
                  <CourseGradeList groups={gradeGroups} mode={gradeDisplay} />
                )}
              </div>
              </div>
            </section>

            {/* ---------------------------------------------------- */}
            {/* Assignments stacked beside classes                   */}
            {/* ---------------------------------------------------- */}
            <section className="order-1 lg:col-span-2 card bg-base-100 border border-base-300 shadow-sm flex flex-col">
              <div className="card-body p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="card-title text-base">Assignments</h2>
                  <p className="text-sm text-base-content/70">
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
                          Log in with Blackbaud, then sync grades for {childLabel}.
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
                          {taskFilter === 'done' && `No graded assignments yet`}
                        </p>
                        <p className="text-[13px] text-base-content/60 mt-1 max-w-sm mx-auto">
                          {blackbaudAssignments.length === 0
                            ? 'Sync grades to pull the current gradebook.'
                            : 'Choose another status, or sync grades to refresh.'}
                        </p>
                        <button
                          type="button"
                          onClick={handleSyncBlackbaud}
                          disabled={isSyncingBlackbaud}
                          className="btn btn-primary mt-4"
                        >
                          {isSyncingBlackbaud ? <span className="loading loading-spinner loading-xs" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          {isSyncingBlackbaud ? 'Syncing...' : 'Sync Grades'}
                        </button>
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
                                  : task.status === 'dueSoon'
                                    ? '#f59e0b'
                                    : '#71717a'
                              }} aria-hidden="true" />
                            )}

                            <div className="min-w-0 flex-1">
                              <p className={`text-[15px] font-medium leading-snug ${task.status === 'done' ? 'text-base-content/70' : 'text-base-content'}`}>
                                {decodeHtmlEntities(task.title)}
                              </p>
                              <p className="mt-1 text-[13px] text-base-content/70">
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
                            </div>

                            <div className="shrink-0 text-right">
                              <p className={`text-[13px] tabular-nums ${task.status === 'overdue' ? 'text-error' : 'text-base-content'}`}>
                                {task.dueDate || 'No due date'}
                              </p>
                              {task.status === 'done' && task.pointsEarned != null ? (
                                <p className="text-[12px] text-base-content/70 tabular-nums">
                                  {task.pointsEarned}{task.maxPoints ? `/${task.maxPoints}` : ''}
                                </p>
                              ) : task.assignedDate ? (
                                <p className="text-[12px] text-base-content/60">Assigned {task.assignedDate}</p>
                              ) : null}
                              {task.isMissing && (
                                <p className="text-[12px] text-error">Missing</p>
                              )}
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

            <section className="order-3 card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="card-title text-base">
                      Events
                      <span className="badge badge-ghost font-normal">{activeEventsCount} active</span>
                    </h2>
                    <p className="text-sm text-base-content/70">sportsYou calendar and inbox</p>
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

              {/* Event Cards List */}
              <div className="mt-4 space-y-3 flex-1 overflow-y-auto max-h-[620px] pr-1">
                {filteredEvents.length === 0 ? (
                  <div className="text-center py-12 px-6 rounded-xl border border-dashed border-base-300 text-base-content/70 bg-base-200">
                    <Calendar className="w-8 h-8 mx-auto mb-2 text-base-content/50" />
                    <p className="text-sm font-semibold text-base-content">
                      {eventFilter === 'acknowledged' ? 'No Acknowledged Events' : 'No Events Scheduled'}
                    </p>
                    <p className="text-xs text-base-content/60 mt-1 max-w-xs mx-auto">
                      {eventFilter === 'acknowledged'
                        ? 'Events that you acknowledge from the active list will appear here.'
                        : eventSource === 'calendar'
                        ? 'Upcoming volleyball, boys basketball, cross country, and athletics from sportsYou.'
                        : !authStatus.authenticated
                        ? 'Connect your Gmail account to scan for games, practices, and school chapel schedules.'
                        : 'All scheduled events have been acknowledged or no upcoming events were found.'}
                    </p>
                  </div>
                ) : (
                  filteredEvents.map(event => {
                    const isSports = event.type === 'sports';
                    const isBen = event.student === 'Ben';
                    const isJade = event.student === 'Jade';

                    return (
                      <div
                        key={event.id}
                        onClick={() => setSelectedEventForModal(event)}
                        className={`group relative p-3.5 rounded-xl transition-all duration-150 shadow-sm border cursor-pointer ${
                          event.acknowledged
                            ? 'bg-base-200 border-base-300 hover:border-base-300 opacity-80'
                            : 'bg-base-100 border-base-300 hover:border-primary/50 hover:bg-base-100 hover:shadow-md'
                        }`}
                      >
                        {/* Top Header Row: Date/Time on left, Compact Actions on right */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-warning">
                            <Calendar className="w-3.5 h-3.5 shrink-0" />
                            <span>{event.date}</span>
                            <span className="text-base-content/50">&bull;</span>
                            <span className="text-base-content flex items-center gap-1 font-mono text-[11px]">
                              <Clock className="w-3 h-3 text-base-content/70 shrink-0" />
                              {event.time}
                            </span>
                          </div>

                          {/* Seamless Integrated Actions */}
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {!event.acknowledged ? (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => acknowledgeEvent(event.id, e)}
                                  title="Acknowledge (remove from active list)"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-base-200 hover:bg-success/10 text-base-content/70 hover:text-success border border-base-300 hover:border-success/30 text-[11px] font-medium transition-all cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5 text-success" />
                                  <span className="hidden sm:inline">Acknowledge</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => deleteEvent(event.id, event.title, event.date, e)}
                                  title="Delete event permanently"
                                  className="p-1 rounded-md text-base-content/60 hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="text-[10px] font-medium text-success bg-success/10 px-1.5 py-0.5 rounded border border-success/20 inline-flex items-center gap-1">
                                  <CheckCheck className="w-3 h-3" />
                                  <span>Ack'd</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => restoreEvent(event.id, e)}
                                  title="Restore to active schedule"
                                  className="p-1 rounded-md text-base-content/70 hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => deleteEvent(event.id, event.title, event.date, e)}
                                  title="Delete event permanently"
                                  className="p-1 rounded-md text-base-content/60 hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Title: Unobstructed full width */}
                        <h3 className="text-sm font-bold text-base-content mt-2 leading-snug group-hover:text-base-content transition-colors">
                          {decodeHtmlEntities(event.title)}
                        </h3>

                        {/* Sender info if present */}
                        {event.emailFrom && (
                          <div className="flex items-center gap-1.5 text-[11px] text-base-content/70 mt-1.5">
                            <Mail className="w-3 h-3 text-base-content/60 shrink-0" />
                            <span className="truncate">
                              <span className="text-base-content/60">From:</span>{' '}
                              <span className="text-base-content font-medium">{decodeHtmlEntities(event.emailFrom)}</span>
                            </span>
                          </div>
                        )}

                        {/* Description / note if present */}
                        {event.description && (
                          <p className="text-xs text-base-content/70 mt-1 leading-relaxed line-clamp-2">
                            {decodeHtmlEntities(event.description)}
                          </p>
                        )}

                        {/* Meta items: Location, Student, Source */}
                        <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-base-content/70">
                          <span className="flex items-center gap-1 bg-base-200 px-2 py-0.5 rounded-md border border-base-300 text-base-content">
                            <MapPin className="w-3 h-3 text-error shrink-0" />
                            <span className="truncate max-w-[150px]">{decodeHtmlEntities(event.location)}</span>
                          </span>

                          {/* Student Tag */}
                          <span
                            className={`font-semibold px-2 py-0.5 rounded-md border text-[10px] ${
                              isBen
                                ? 'bg-info/10 text-info border-info/30'
                                : isJade
                                ? 'bg-secondary/10 text-secondary border-secondary/30'
                                : 'bg-base-200 text-base-content border-base-300'
                            }`}
                          >
                            {event.student === 'All' ? 'Ben & Jade' : event.student}
                          </span>

                          {event.sport && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-warning/10 text-warning border border-warning/30">
                              {event.sport}
                            </span>
                          )}

                          {/* Source Pill */}
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-md font-medium flex items-center gap-1 ${
                              isSports
                                ? 'bg-warning/10 text-warning border border-warning/30'
                                : 'bg-primary/10 text-primary border border-primary/30'
                            }`}
                          >
                            {isSports ? <Trophy className="w-2.5 h-2.5" /> : <GraduationCap className="w-2.5 h-2.5" />}
                            {event.source}
                          </span>

                          {/* Open email indicator */}
                          <span className="text-[10px] text-base-content/60 group-hover:text-primary flex items-center gap-1 ml-auto font-medium transition-colors">
                            <span>Open email</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
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
                Sync Grades refreshes this signed-in account. Log in with Blackbaud is the only
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
      {/* Assignment Detail & Collaboration Comments Modal     */}
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
                  className={`text-[13px] font-semibold px-2.5 py-1 rounded-md border ${
                    selectedTaskForModal.student === 'Ben'
                      ? 'bg-info/10 text-info border-info/30'
                      : 'bg-secondary/10 text-secondary border-secondary/30'
                  }`}
                >
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
                    <span className="text-[13px] text-base-content/70">
                      {selectedTaskForModal.pointsEarned != null
                        ? `${selectedTaskForModal.pointsEarned}${selectedTaskForModal.maxPoints ? ` / ${selectedTaskForModal.maxPoints}` : ''}`
                        : selectedTaskForModal.status === 'overdue'
                          ? 'Overdue'
                          : selectedTaskForModal.status === 'dueSoon'
                            ? 'Due soon'
                            : selectedTaskForModal.status === 'assigned'
                              ? 'Assigned'
                              : 'From Blackbaud'}
                    </span>
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

              {/* Collaboration & Comments Thread */}
              <div className="pt-2">
                <div className="flex items-center justify-between pb-3">
                  <h3 className="text-[13px] font-semibold text-base-content">Notes</h3>
                  <span className="text-[13px] tabular-nums text-base-content/60">
                    {(selectedTaskForModal.comments || []).length}
                  </span>
                </div>

                <div className="space-y-2.5 min-h-[90px] max-h-[200px] overflow-y-auto pr-1">
                  {(selectedTaskForModal.comments || []).length === 0 ? (
                    <div className="text-center py-6 px-4 rounded-xl border border-dashed border-base-300 text-base-content/60">
                      <p className="text-[13px] font-medium text-base-content/70">No notes yet</p>
                      <p className="text-[13px] text-base-content/60 mt-0.5">Add a note as {blackbaudStatus.displayName || blackbaudStatus.accountName || 'the signed-in account'}.</p>
                    </div>
                  ) : (
                    (selectedTaskForModal.comments || []).map(comment => (
                      <div
                        key={comment.id}
                        className="p-3 rounded-xl bg-base-200 border border-base-300"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <ProfileAvatar name={comment.author} photoUrl={comment.authorPhoto} size={28} />
                            <span className="text-[13px] font-semibold text-base-content truncate">{comment.author}</span>
                            <span className="text-[12px] text-base-content/60 shrink-0">{comment.timestamp}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(selectedTaskForModal.id, comment.id)}
                            className="min-h-11 min-w-11 inline-flex items-center justify-center text-base-content/60 hover:text-error"
                            aria-label="Delete note"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-[13px] text-base-content mt-2 leading-relaxed whitespace-pre-wrap pl-9">
                          {decodeHtmlEntities(comment.text)}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleAddComment} className="pt-3 mt-3 border-t border-base-300">
                  <div className="flex items-start gap-2">
                    <ProfileAvatar
                      name={blackbaudStatus.displayName || blackbaudStatus.accountName || 'Family'}
                      photoUrl={blackbaudStatus.photoUrl}
                      size={36}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-base-content">
                        {blackbaudStatus.displayName || blackbaudStatus.accountName || 'Family'}
                      </p>
                      {blackbaudStatus.email && (
                        <p className="text-[12px] text-base-content/60 truncate">{blackbaudStatus.email}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <textarea
                          placeholder="Add a note"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          rows={2}
                          aria-label="Assignment note"
                          className="textarea textarea-bordered textarea-sm flex-1"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleAddComment(e);
                            }
                          }}
                        />
                        <button
                          type="submit"
                          disabled={!commentText.trim()}
                          className="btn btn-primary btn-sm shrink-0"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Post
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </div>
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
                  <span className="text-base-content/50">&bull;</span>
                  <span className="flex items-center gap-1 text-base-content">
                    <MapPin className="w-3.5 h-3.5 text-error" />
                    {decodeHtmlEntities(selectedEventForModal.location)}
                  </span>
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
    </div>
  );
}
