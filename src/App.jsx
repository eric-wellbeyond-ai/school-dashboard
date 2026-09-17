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
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-full shrink-0 font-semibold bg-slate-800 text-slate-200 ${className}`}
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
  const [view, setView] = useState('landing');
  // Task collaboration & comment modal state
  const [selectedTaskForModal, setSelectedTaskForModal] = useState(null);
  const [commentText, setCommentText] = useState('');

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEventForModal, selectedTaskForModal, showBlackbaudModal]);

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

  // Open task detail & collaboration modal
  const handleOpenTaskModal = async (task) => {
    const fromPortal = (blackbaudAssignments || []).find((t) => t.id === task.id);
    const fromCustom = (tasks || []).find((t) => t.id === task.id);
    const current = fromPortal || fromCustom || task;
    setSelectedTaskForModal(current);
    if (!current.assignmentId) return;
    try {
      const res = await fetch(`/api/blackbaud/assignment/${current.assignmentId}`);
      if (!res.ok) return;
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
    setEvents(prev => {
      const updated = prev.map(ev => {
        if (ev.id === eventId) {
          return {
            ...ev,
            acknowledged: true,
            acknowledgedAt: new Date().toISOString()
          };
        }
        return ev;
      });
      persistDashboardState(undefined, updated);
      return updated;
    });
    setSelectedEventForModal(prev => (prev && prev.id === eventId ? { ...prev, acknowledged: true, acknowledgedAt: new Date().toISOString() } : prev));
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

    const nextEvents = events.filter(ev => ev.id !== eventId);
    const nextKeys = Array.from(new Set([...deletedEventKeys, eventKey]));
    setEvents(nextEvents);
    setDeletedEventKeys(nextKeys);
    persistDashboardState(undefined, nextEvents, nextKeys);
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

  // Filter events (excluding deleted, filtered by student and active/acknowledged tab)
  const filteredEvents = events.filter(event => {
    const key = (event.id || `${(event.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}_${event.date || ''}`).toLowerCase();
    if (deletedEventKeys.includes(key)) return false;

    const matchesStudent = selectedStudent === 'All' || event.student === selectedStudent || event.student === 'All';
    if (!matchesStudent) return false;

    if (eventFilter === 'active') return !event.acknowledged;
    if (eventFilter === 'acknowledged') return Boolean(event.acknowledged);
    return true;
  });

  const activeEventsCount = events.filter(ev => {
    const key = (ev.id || `${(ev.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}_${ev.date || ''}`).toLowerCase();
    return !deletedEventKeys.includes(key) && !ev.acknowledged && (selectedStudent === 'All' || ev.student === selectedStudent || ev.student === 'All');
  }).length;

  const acknowledgedEventsCount = events.filter(ev => {
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

  return (
    <div className="wla-app min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row antialiased font-sans">
      {view !== 'landing' && (
      <a href="#wla-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-100 focus:px-3 focus:py-2 focus:text-sm focus:text-[rgb(var(--wla-on-ink))]">
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
        className={view === 'landing' ? 'hidden' : 'flex-1 flex flex-col md:flex-row min-h-0 w-full'}
        aria-hidden={view === 'landing' ? 'true' : undefined}
      >
      {/* ---------------------------------------------------- */}
      {/* Sidebar: Navigation & Launch Portals                 */}
      {/* ---------------------------------------------------- */}
      <aside className="w-full md:w-72 bg-slate-950 border-r border-slate-800 flex flex-col justify-between p-5 shrink-0 wla-rule">
        <div>
          <div className="pb-6 border-b border-slate-800/80">
            <p className="font-serif text-[11px] tracking-[0.16em] uppercase text-indigo-400">
              Westlake Lutheran Academy
            </p>
            <h1 className="mt-1 font-serif text-xl font-semibold tracking-tight text-slate-100">
              Family folder
            </h1>
            <p className="mt-1 text-[13px] text-slate-400">
              {signedInName
                ? `${signedInName}${blackbaudStatus.role ? ` · ${blackbaudStatus.role}` : ''}`
                : 'Sign in to see grades'}
            </p>
          </div>

          {/* Direct Launch Portals */}
          <div className="mt-6">
            <h2 className="text-[13px] font-semibold text-slate-400 px-1 mb-3">
              Portals
            </h2>
            <div className="space-y-2">
              {/* Blackbaud Parent Portal */}
              <a
                href="https://westlakelutheran.myschoolapp.com"
                target="_blank"
                rel="noopener noreferrer"
                id="link-blackbaud"
                className="group flex items-center justify-between min-h-11 p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-colors">
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-200 group-hover:text-white flex items-center gap-1.5">
                      Blackbaud
                      {blackbaudStatus.connected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-500/50" title="Connected"></span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {blackbaudStatus.connected ? 'Connected • Live Grades' : 'Parent Portal'}
                    </div>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>

              {/* Classlink Portal */}
              <a
                href="https://launchpad.classlink.com"
                target="_blank"
                rel="noopener noreferrer"
                id="link-classlink"
                className="group flex items-center justify-between min-h-11 p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                    <LinkIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-200 group-hover:text-white">ClassLink</div>
                    <div className="text-[11px] text-slate-400">Single Sign-On</div>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>

              {/* sportsYou Portal */}
              <a
                href="https://www.sportsyou.com/login"
                target="_blank"
                rel="noopener noreferrer"
                id="link-sportsyou"
                className="group flex items-center justify-between min-h-11 p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center group-hover:bg-amber-500 group-hover:text-white transition-colors">
                    <Trophy className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-200 group-hover:text-white">sportsYou</div>
                    <div className="text-[11px] text-slate-400">Athletics & Teams</div>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-amber-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
            </div>
          </div>

          {/* Student Overview Cards in Sidebar */}
          <div className="mt-8">
            <h2 className="text-[13px] font-semibold text-slate-400 px-1 mb-3">
              Students
            </h2>
            <div className="space-y-2">
              {canSeeBen && (
              <button
                type="button"
                aria-pressed={selectedStudent === 'Ben'}
                onClick={() => setSelectedStudent('Ben')}
                className={`wla-tab w-full min-h-11 text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center justify-between ${
                  selectedStudent === 'Ben'
                    ? 'border-slate-700 text-slate-100'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div>
                    <div className="text-[15px] font-semibold text-slate-100">Ben</div>
                    <div className="text-[13px] text-slate-400">High school</div>
                </div>
                <span className="text-[13px] tabular-nums text-slate-400">
                  {benOpenCount} open
                </span>
              </button>
              )}

              {canSeeJade && (
              <button
                type="button"
                aria-pressed={selectedStudent === 'Jade'}
                onClick={() => setSelectedStudent('Jade')}
                className={`wla-tab w-full min-h-11 text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center justify-between ${
                  selectedStudent === 'Jade'
                    ? 'border-slate-700 text-slate-100'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div>
                    <div className="text-[15px] font-semibold text-slate-100">Jade</div>
                    <div className="text-[13px] text-slate-400">Middle school</div>
                </div>
                <span className="text-[13px] tabular-nums text-slate-400">
                  {jadeOpenCount} open
                </span>
              </button>
              )}
            </div>
          </div>
        </div>

        {/* Sync / Connectivity Status in Sidebar Footer */}
        <div className="mt-8 pt-4 border-t border-slate-800/80 space-y-3">
          {/* Gmail Status */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${authStatus.authenticated ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                {authStatus.authenticated ? 'Gmail Active' : 'Gmail Offline'}
              </span>
              <span className="font-mono text-[10px] text-slate-500">Inbox</span>
            </div>
            <button
              onClick={handleConnectGoogle}
              className="w-full min-h-11 py-2 px-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-[13px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              <span>{authStatus.authenticated ? 'Gmail Connected' : 'Connect Google Inbox'}</span>
            </button>
          </div>

          {/* Blackbaud Portal Status */}
          <div className="pt-2 border-t border-slate-900/80">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${blackbaudStatus.connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                {blackbaudStatus.connected ? 'Blackbaud Synced' : 'Blackbaud Offline'}
              </span>
              <span className="text-[10px] text-amber-400/80 font-mono">myschoolapp</span>
            </div>
            <button
              onClick={() => (blackbaudStatus.connected ? setShowBlackbaudModal(true) : setView('landing'))}
              className="w-full min-h-11 py-2 px-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-[13px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <GraduationCap className="w-3.5 h-3.5 text-amber-400" />
              <span>{blackbaudStatus.connected ? 'Blackbaud Settings' : 'Connect Blackbaud'}</span>
            </button>
            {blackbaudStatus.connected && (
              <div className="pt-2 text-center space-y-1.5">
                <p className="text-[11px] text-slate-400">
                  Signed in as {signedInName || 'family member'}
                  {blackbaudStatus.role ? ` · ${blackbaudStatus.role}` : ''}
                </p>
                <button
                  type="button"
                  onClick={handleDisconnectBlackbaud}
                  className="text-[11px] text-slate-500 hover:text-white underline cursor-pointer"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ---------------------------------------------------- */}
      {/* Main Content Area                                    */}
      {/* ---------------------------------------------------- */}
      <main id="wla-main" className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="sticky top-0 z-20 backdrop-blur-md bg-slate-900/90 border-b border-slate-800 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-xl font-semibold text-slate-100 tracking-tight">Grades and schoolwork</h2>
                <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 font-medium">
                  Fall 2026
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {lastSynced ? `Inbox synced at ${lastSynced}` : 'Ready to sync with school inbox & sportsYou'}
              </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Google OAuth Connect / Status Button */}
            {authStatus.authenticated ? (
              <div className="flex items-center gap-2 bg-slate-950/80 border border-emerald-500/40 px-3 py-2 rounded-xl text-xs text-emerald-400 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="font-medium">Gmail Linked</span>
                <button
                  onClick={handleDisconnectGoogle}
                  className="ml-1 text-[11px] text-slate-400 hover:text-red-400 underline cursor-pointer"
                  title="Disconnect Google Account"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                id="connect-google-btn"
                onClick={handleConnectGoogle}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700/80 transition-all shadow-sm cursor-pointer"
                title="Connect Google Account for live Gmail inbox sync"
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{authStatus.configured ? 'Connect Gmail' : 'Gmail OAuth Setup'}</span>
              </button>
            )}

            {/* Sync Inbox Button Group */}
            <div className="relative inline-flex items-center shadow-lg shadow-indigo-600/25">
              <button
                id="sync-inbox-button"
                onClick={() => handleSyncInbox('incremental')}
                disabled={isSyncing}
                title="Sync new emails since previous pull (capped at 2 weeks)"
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-l-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-semibold border-y border-l border-indigo-400/30 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync Inbox'}</span>
              </button>
              <button
                type="button"
                id="sync-options-dropdown-button"
                onClick={() => setSyncDropdownOpen(prev => !prev)}
                disabled={isSyncing}
                title="Sync options (Incremental vs Full 14-Day)"
                className="px-2 py-2.5 rounded-r-xl bg-indigo-700 hover:bg-indigo-600 text-white border-y border-r border-indigo-400/30 transition-all cursor-pointer disabled:opacity-60"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {/* Sync Options Dropdown */}
              {syncDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl z-50 p-2 text-xs backdrop-blur-xl">
                  <div className="px-2.5 py-1 text-slate-400 font-semibold border-b border-slate-800 mb-1">
                    Email Synchronization Window
                  </div>
                  <button
                    onClick={() => handleSyncInbox('incremental')}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex flex-col cursor-pointer"
                  >
                    <span className="font-semibold text-white">Sync Since Last Pull</span>
                    <span className="text-slate-400 text-[11px]">Syncs from previous pull (up to 2 weeks maximum)</span>
                  </button>
                  <button
                    onClick={() => handleSyncInbox('full')}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex flex-col cursor-pointer mt-1"
                  >
                    <span className="font-semibold text-white">Full 14-Day Rescan</span>
                    <span className="text-slate-400 text-[11px]">Re-analyzes all inbox emails over the last 14 days</span>
                  </button>
                  <div className="px-2.5 py-1 text-slate-400 font-semibold border-t border-b border-slate-800 my-1">
                    School Portal Sync
                  </div>
                  <button
                    onClick={() => {
                      setSyncDropdownOpen(false);
                      handleSyncBlackbaud();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex flex-col cursor-pointer"
                  >
                    <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5" />
                      Sync Blackbaud Portal
                    </span>
                    <span className="text-slate-400 text-[11px]">Opens the Mac Playwright sign-in and pulls live grades</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* OAuth Feedback Banner */}
        {authBanner && (
          <div className="px-6 pt-4">
            <div
              className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-medium shadow-md ${
                authBanner.type === 'success'
                  ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
                  : authBanner.type === 'error'
                  ? 'bg-red-950/70 border-red-500/50 text-red-300'
                  : 'bg-blue-950/70 border-blue-500/50 text-blue-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {authBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span>{authBanner.message}</span>
              </div>
              <button
                onClick={() => setAuthBanner(null)}
                className="text-slate-400 hover:text-slate-200 px-1 cursor-pointer"
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Dashboard Body */}
        <div className="p-6 space-y-6 max-w-7xl w-full mx-auto">
          {/* Top Controls: Student View Toggles & Summary Metrics */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-950/70 p-4 rounded-2xl border border-slate-800/80 shadow-md">
            {/* Student View Toggle Buttons */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> View:
              </span>
              <div className="inline-flex p-1 bg-slate-900 rounded-xl border border-slate-800" role="group">
                {isParentViewer && (
                <button
                  id="toggle-all"
                  type="button"
                  aria-pressed={selectedStudent === 'All'}
                  onClick={() => setSelectedStudent('All')}
                  className={`px-3.5 py-2 min-h-11 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                    selectedStudent === 'All'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:bg-slate-800'
                  }`}
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
                  className={`px-3.5 py-2 min-h-11 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                    selectedStudent === 'Ben'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:bg-slate-800'
                  }`}
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
                  className={`px-3.5 py-2 min-h-11 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                    selectedStudent === 'Jade'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  Jade
                </button>
                )}
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400">Open:</span>
                <span className="font-bold text-amber-400 font-mono text-sm">{pendingCount}</span>
              </div>
              <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400">Completed:</span>
                <span className="font-bold text-emerald-400 font-mono text-sm">{completedCount}</span>
              </div>
              <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400">Events:</span>
                <span className="font-bold text-indigo-400 font-mono text-sm">{filteredEvents.length}</span>
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------- */}
          {/* Blackbaud Academic Performance & Course Grades       */}
          {/* ---------------------------------------------------- */}
          <section className="bg-slate-950/70 rounded-2xl border border-slate-800/80 p-5 shadow-lg">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500/20 to-blue-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-inner">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white tracking-tight">Academic Course Grades</h2>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono border border-slate-700/60">
                      Fall Term 2026
                    </span>
                    {blackbaudStatus.connected ? (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/80">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        Blackbaud Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-950/70 text-amber-300 border border-amber-800/70">
                        Portal Offline
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Westlake Lutheran Academy Portal (<span className="font-mono text-slate-300">westlakelutheran.myschoolapp.com</span>)
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {blackbaudStatus.connected ? (
                  <>
                    <button
                      onClick={handleSyncBlackbaud}
                      disabled={isSyncingBlackbaud}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                      title="Sync grades and assignment center"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBlackbaud ? 'animate-spin' : ''}`} />
                      <span>{isSyncingBlackbaud ? 'Syncing...' : 'Sync Grades'}</span>
                    </button>
                    <button
                      onClick={() => setShowBlackbaudModal(true)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                    >
                      Portal Settings
                    </button>
                  </>
                ) : (
                    <button
                      onClick={() => setView('landing')}
                      className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-900/20 flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                    <Key className="w-3.5 h-3.5" />
                    <span>Log in with Blackbaud</span>
                  </button>
                )}
              </div>
            </div>

            {/* Missing Assignments Banner (if any) */}
            {visibleMissing.length > 0 && (
              <div className="mt-4 p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-amber-300">
                    {visibleMissing.length} missing assignment{visibleMissing.length > 1 ? 's' : ''} in Blackbaud
                  </h4>
                  <div className="mt-2 space-y-1.5">
                    {visibleMissing.map((m) => (
                      <div key={m.id || `${m.title}-${m.course}`} className="flex items-center justify-between text-xs text-slate-300 bg-slate-900/60 p-2 rounded-lg border border-amber-900/40">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-white truncate">{decodeHtmlEntities(m.AssignmentTitle || m.title || 'Missing Work')}</span>
                          <span className="text-slate-500">&bull;</span>
                          <span className="text-amber-300/90 text-[11px] truncate">{decodeHtmlEntities(m.ClassName || m.course || m.student)}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono shrink-0 ml-2">
                          Due: {m.DateDue || m.dueDate || 'Overdue'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Grades View */}
            <div className="mt-4">
              {(!blackbaudGrades.Ben || blackbaudGrades.Ben.length === 0) && (!blackbaudGrades.Jade || blackbaudGrades.Jade.length === 0) &&
              !Object.entries(blackbaudGrades).some(([key, rows]) => key !== 'Ben' && key !== 'Jade' && Array.isArray(rows) && rows.length > 0) ? (
                /* Unconnected / Empty State Card */
                <div className="p-6 rounded-xl bg-slate-900/40 border border-dashed border-slate-800 text-center flex flex-col items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">
                    {blackbaudStatus.connected ? 'No Course Grades Synced Yet' : 'Live Gradebook & Academic Overview'}
                  </h3>
                  <p className="text-xs text-slate-400 max-w-lg mb-4 leading-relaxed">
                    {blackbaudStatus.connected
                      ? 'Click Sync Grades to refresh this account from Westlake.'
                      : 'Use Log in with Blackbaud on the landing page. Chrome opens only after you click that button.'}
                  </p>
                  <button
                    onClick={() => (blackbaudStatus.connected ? handleSyncBlackbaud({ openPortal: false }) : setView('landing'))}
                    disabled={isSyncingBlackbaud || macWebviewStarting}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBlackbaud || macWebviewStarting ? 'animate-spin' : ''}`} />
                    <span>{isSyncingBlackbaud ? 'Syncing…' : (blackbaudStatus.connected ? 'Sync Grades' : 'Log in with Blackbaud')}</span>
                  </button>
                </div>
              ) : (
                /* Course Cards Grid */
                <div className="space-y-6">
                  {/* Ben's Course Grades */}
                  {(selectedStudent === 'All' || selectedStudent === 'Ben') && canSeeBen && (blackbaudGrades.Ben || []).length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 flex items-center justify-center text-xs font-bold">
                            B
                          </div>
                          <span className="text-xs font-bold text-white uppercase tracking-wider">
                            Ben &bull; High School
                          </span>
                          <span className="text-[11px] text-slate-400 font-normal">
                            ({(blackbaudGrades.Ben || []).length} Classes)
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {(blackbaudGrades.Ben || []).map((c, idx) => {
                          const letter = c.letterGrade || '';
                          const isA = letter.startsWith('A');
                          const isB = letter.startsWith('B');
                          const isC = letter.startsWith('C');
                          return (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/90 hover:border-slate-700/90 transition-all flex flex-col justify-between gap-2 shadow-sm"
                            >
                              <div>
                                <div className="flex items-start justify-between gap-2">
                                  <h4 className="text-xs font-bold text-white truncate" title={decodeHtmlEntities(c.course)}>
                                    {decodeHtmlEntities(c.course)}
                                  </h4>
                                  {c.letterGrade && (
                                    <span
                                      className={`px-2 py-0.5 rounded-md text-xs font-bold border shrink-0 ${
                                        isA
                                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                          : isB
                                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                          : isC
                                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                          : 'bg-slate-800 text-slate-300 border-slate-700'
                                      }`}
                                    >
                                      {c.letterGrade}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-400 mt-1 truncate">
                                  {decodeHtmlEntities(c.teacher || 'Teacher TBA')} {c.room ? `• Rm ${c.room}` : ''}
                                </p>
                              </div>
                              {c.percentage && (
                                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                                  <span className="text-slate-500">Cumulative:</span>
                                  <span className="font-mono font-bold text-slate-200">{c.percentage}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Jade's Course Grades */}
                  {(selectedStudent === 'All' || selectedStudent === 'Jade') && canSeeJade && (blackbaudGrades.Jade || []).length > 0 && (
                    <div className={selectedStudent === 'All' ? 'pt-4 border-t border-slate-800/80' : ''}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300 flex items-center justify-center text-xs font-bold">
                            J
                          </div>
                          <span className="text-xs font-bold text-white uppercase tracking-wider">
                            Jade &bull; Middle School
                          </span>
                          <span className="text-[11px] text-slate-400 font-normal">
                            ({(blackbaudGrades.Jade || []).length} Classes)
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {(blackbaudGrades.Jade || []).map((c, idx) => {
                          const letter = c.letterGrade || '';
                          const isA = letter.startsWith('A');
                          const isB = letter.startsWith('B');
                          const isC = letter.startsWith('C');
                          return (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/90 hover:border-slate-700/90 transition-all flex flex-col justify-between gap-2 shadow-sm"
                            >
                              <div>
                                <div className="flex items-start justify-between gap-2">
                                  <h4 className="text-xs font-bold text-white truncate" title={decodeHtmlEntities(c.course)}>
                                    {decodeHtmlEntities(c.course)}
                                  </h4>
                                  {c.letterGrade && (
                                    <span
                                      className={`px-2 py-0.5 rounded-md text-xs font-bold border shrink-0 ${
                                        isA
                                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                          : isB
                                          ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                                          : isC
                                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                          : 'bg-slate-800 text-slate-300 border-slate-700'
                                      }`}
                                    >
                                      {c.letterGrade}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-400 mt-1 truncate">
                                  {decodeHtmlEntities(c.teacher || 'Teacher TBA')} {c.room ? `• Rm ${c.room}` : ''}
                                </p>
                              </div>
                              {c.percentage && (
                                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                                  <span className="text-slate-500">Cumulative:</span>
                                  <span className="font-mono font-bold text-slate-200">{c.percentage}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Grid Layout: Assignments Checklist (Left) & Events Schedule (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* ---------------------------------------------------- */}
            {/* Left Column: Assignment Checklist                    */}
            {/* ---------------------------------------------------- */}
            <section className="lg:col-span-7 bg-slate-950/60 rounded-2xl border border-slate-800/80 p-5 shadow-lg flex flex-col">
              <div className="flex flex-col gap-4 pb-4 border-b border-slate-800/80">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                      <CheckSquare className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-white">Assignment Checklist</h2>
                      <p className="text-[13px] text-slate-400">
                        {childLabel} · Westlake portal
                        {taskFilter === 'dueSoon' ? ` · through ${fridayLabel}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedStudent === 'Ben' || selectedStudent === 'Jade') setNewTaskStudent(selectedStudent);
                      setIsAddingTask(!isAddingTask);
                    }}
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:text-slate-100"
                    aria-expanded={isAddingTask}
                    aria-label="Add family reminder"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div
                  role="tablist"
                  aria-label="Assignment status"
                  className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-lg border border-slate-800 bg-slate-900"
                >
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
                      className={`wla-seg min-h-11 px-2 rounded-md text-[13px] font-medium transition-colors ${
                        taskFilter === tab.id ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      onClick={() => setTaskFilter(tab.id)}
                    >
                      {tab.label}
                      <span className="ml-1 tabular-nums text-slate-400" aria-hidden="true">{tab.count}</span>
                      <span className="sr-only"> {tab.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Add Custom Task Form Modal / Inline Box */}
              {isAddingTask && (
                <form onSubmit={handleAddTask} className="mt-4 p-4 rounded-xl bg-slate-900/90 border border-indigo-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Quick Add Assignment
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAddingTask(false)}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. Bring poster board for history presentation"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-950 rounded-lg border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={newTaskStudent}
                      onChange={(e) => setNewTaskStudent(e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-slate-950 rounded-lg border border-slate-700 text-slate-300 focus:outline-none"
                    >
                      <option value="Ben">Ben (High School)</option>
                      <option value="Jade">Jade (Middle School)</option>
                    </select>
                    <select
                      value={newTaskCourse}
                      onChange={(e) => setNewTaskCourse(e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-slate-950 rounded-lg border border-slate-700 text-slate-300 focus:outline-none"
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
                      className="px-2.5 py-1.5 text-xs bg-slate-950 rounded-lg border border-slate-700 text-slate-300 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Save Assignment
                  </button>
                </form>
              )}

              {/* Task Items List */}
              <div className="mt-2 flex-1 overflow-y-auto max-h-[620px]">
                {filteredTasks.length === 0 ? (
                  <div className="text-center py-12 px-6 rounded-xl border border-dashed border-slate-800 text-slate-400 bg-slate-950/30">
                    {!blackbaudStatus.connected ? (
                      <>
                        <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-500" />
                        <p className="text-[15px] font-semibold text-slate-200">Sign in to load assignments</p>
                        <p className="text-[13px] text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
                          Log in with Blackbaud, then sync grades for {childLabel}.
                        </p>
                        <button
                          type="button"
                          onClick={() => setView('landing')}
                          className="mt-4 min-h-11 inline-flex items-center gap-2 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold"
                        >
                          <Key className="w-3.5 h-3.5" />
                          Log in with Blackbaud
                        </button>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-500" />
                        <p className="text-[15px] font-semibold text-slate-200">
                          {taskFilter === 'overdue' && `No overdue work for ${childLabel}`}
                          {taskFilter === 'dueSoon' && `Nothing due through ${fridayLabel}`}
                          {taskFilter === 'assigned' && `No assigned work in range`}
                          {taskFilter === 'done' && `No graded assignments yet`}
                        </p>
                        <p className="text-[13px] text-slate-500 mt-1 max-w-sm mx-auto">
                          {blackbaudAssignments.length === 0
                            ? 'Sync grades to pull the current gradebook.'
                            : 'Choose another status, or sync grades to refresh.'}
                        </p>
                        <button
                          type="button"
                          onClick={handleSyncBlackbaud}
                          disabled={isSyncingBlackbaud}
                          className="mt-4 min-h-11 inline-flex items-center gap-2 px-3.5 rounded-lg bg-slate-800 text-slate-200 text-[13px] font-medium border border-slate-700 disabled:opacity-60"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBlackbaud ? 'animate-spin' : ''}`} />
                          {isSyncingBlackbaud ? 'Syncing...' : 'Sync Grades'}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-800">
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
                              className="mt-0.5 min-h-11 min-w-11 inline-flex items-center justify-center text-slate-400 shrink-0"
                              aria-label={task.completed ? 'Mark as open' : 'Mark as done'}
                            >
                              {task.completed ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                              ) : (
                                <Circle className="w-5 h-5 text-slate-500" />
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
                                  ? 'rgb(var(--wla-miss))'
                                  : task.status === 'dueSoon'
                                    ? 'rgb(var(--wla-gold))'
                                    : task.status === 'done'
                                      ? 'rgb(var(--wla-mute))'
                                      : 'rgb(var(--wla-ink) / 0.45)'
                              }} aria-hidden="true" />
                            )}

                            <div className="min-w-0 flex-1">
                              <p className={`text-[15px] font-medium leading-snug ${task.status === 'done' ? 'text-slate-400' : 'text-slate-100'}`}>
                                {decodeHtmlEntities(task.title)}
                              </p>
                              <p className="mt-1 text-[13px] text-slate-400">
                                <span className={isBen ? 'text-[rgb(var(--wla-ben))]' : 'text-[rgb(var(--wla-jade))]'}>
                                  {task.student}
                                </span>
                                {task.course ? ` · ${decodeHtmlEntities(task.course)}` : ''}
                                {task.type ? ` · ${decodeHtmlEntities(task.type)}` : ''}
                              </p>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className={`text-[13px] tabular-nums ${task.status === 'overdue' ? 'text-[rgb(var(--wla-miss))]' : 'text-slate-300'}`}>
                                {task.dueDate || 'No due date'}
                              </p>
                              {task.status === 'done' && task.pointsEarned != null ? (
                                <p className="text-[12px] text-slate-400 tabular-nums">
                                  {task.pointsEarned}{task.maxPoints ? `/${task.maxPoints}` : ''}
                                </p>
                              ) : task.assignedDate ? (
                                <p className="text-[12px] text-slate-500">Assigned {task.assignedDate}</p>
                              ) : null}
                              {task.isMissing && (
                                <p className="text-[12px] text-[rgb(var(--wla-miss))]">Missing</p>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 mt-1 text-slate-500 shrink-0" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            {/* ---------------------------------------------------- */}
            {/* Right Column: Events & Sports Schedule Widget        */}
            {/* ---------------------------------------------------- */}
            <section className="lg:col-span-5 bg-slate-950/60 rounded-2xl border border-slate-800/80 p-5 shadow-lg flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      Events & Sports
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-normal">
                        {activeEventsCount} active
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400">From sportsYou & Westlake calendar</p>
                  </div>
                </div>

                {/* Active vs Acknowledged Filter Tabs */}
                <div className="inline-flex rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setEventFilter('active')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      eventFilter === 'active'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Active ({activeEventsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventFilter('acknowledged')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      eventFilter === 'acknowledged'
                        ? 'bg-slate-800 text-slate-200 border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Acknowledged ({acknowledgedEventsCount})
                  </button>
                </div>
              </div>

              {/* Event Cards List */}
              <div className="mt-4 space-y-3 flex-1 overflow-y-auto max-h-[620px] pr-1">
                {filteredEvents.length === 0 ? (
                  <div className="text-center py-12 px-6 rounded-xl border border-dashed border-slate-800 text-slate-400 bg-slate-950/30">
                    <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                    <p className="text-sm font-semibold text-slate-200">
                      {eventFilter === 'acknowledged' ? 'No Acknowledged Events' : 'No Events Scheduled'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                      {eventFilter === 'acknowledged'
                        ? 'Events that you acknowledge from the active list will appear here.'
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
                            ? 'bg-slate-900/40 border-slate-800/60 hover:border-slate-700 opacity-80'
                            : 'bg-slate-900/90 border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/95 hover:shadow-md'
                        }`}
                      >
                        {/* Top Header Row: Date/Time on left, Compact Actions on right */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                            <Calendar className="w-3.5 h-3.5 shrink-0" />
                            <span>{event.date}</span>
                            <span className="text-slate-600">&bull;</span>
                            <span className="text-slate-300 flex items-center gap-1 font-mono text-[11px]">
                              <Clock className="w-3 h-3 text-slate-400 shrink-0" />
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
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800/80 hover:bg-emerald-500/15 text-slate-400 hover:text-emerald-300 border border-slate-700/80 hover:border-emerald-500/30 text-[11px] font-medium transition-all cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span className="hidden sm:inline">Acknowledge</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => deleteEvent(event.id, event.title, event.date, e)}
                                  title="Delete event permanently"
                                  className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="text-[10px] font-medium text-emerald-400/90 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/20 inline-flex items-center gap-1">
                                  <CheckCheck className="w-3 h-3" />
                                  <span>Ack'd</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => restoreEvent(event.id, e)}
                                  title="Restore to active schedule"
                                  className="p-1 rounded-md text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => deleteEvent(event.id, event.title, event.date, e)}
                                  title="Delete event permanently"
                                  className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Title: Unobstructed full width */}
                        <h3 className="text-sm font-bold text-slate-100 mt-2 leading-snug group-hover:text-white transition-colors">
                          {decodeHtmlEntities(event.title)}
                        </h3>

                        {/* Sender info if present */}
                        {event.emailFrom && (
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1.5">
                            <Mail className="w-3 h-3 text-slate-500 shrink-0" />
                            <span className="truncate">
                              <span className="text-slate-500">From:</span>{' '}
                              <span className="text-slate-300 font-medium">{decodeHtmlEntities(event.emailFrom)}</span>
                            </span>
                          </div>
                        )}

                        {/* Description / note if present */}
                        {event.description && (
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">
                            {decodeHtmlEntities(event.description)}
                          </p>
                        )}

                        {/* Meta items: Location, Student, Source */}
                        <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-slate-400">
                          <span className="flex items-center gap-1 bg-slate-950/80 px-2 py-0.5 rounded-md border border-slate-800 text-slate-300">
                            <MapPin className="w-3 h-3 text-red-400 shrink-0" />
                            <span className="truncate max-w-[150px]">{decodeHtmlEntities(event.location)}</span>
                          </span>

                          {/* Student Tag */}
                          <span
                            className={`font-semibold px-2 py-0.5 rounded-md border text-[10px] ${
                              isBen
                                ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                                : isJade
                                ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {event.student}
                          </span>

                          {/* Source Pill */}
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-md font-medium flex items-center gap-1 ${
                              isSports
                                ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                                : 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30'
                            }`}
                          >
                            {isSports ? <Trophy className="w-2.5 h-2.5" /> : <GraduationCap className="w-2.5 h-2.5" />}
                            {event.source}
                          </span>

                          {/* Open email indicator */}
                          <span className="text-[10px] text-slate-500 group-hover:text-indigo-400 flex items-center gap-1 ml-auto font-medium transition-colors">
                            <span>Open email</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Google Cloud & Gmail OAuth</h3>
                  <p className="text-xs text-slate-400">Status & Integration Checklist</p>
                </div>
              </div>
              <button
                onClick={() => setShowAuthModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Client ID Check */}
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">1. Google Client ID</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Configured
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-400 break-all select-all bg-slate-900 p-2 rounded border border-slate-800">
                  {authStatus.clientId || '82253624012-97aurejdlmr6nhrcrcf8fj6o0d6a5ge5.apps.googleusercontent.com'}
                </div>
              </div>

              {/* Client Secret Check */}
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">2. Google Client Secret</span>
                  {authStatus.hasClientSecret ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Ready
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                      Needs .env entry
                    </span>
                  )}
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  In Google Cloud Console under Credentials &gt; OAuth 2.0 Client IDs, copy your Client Secret and add it to your <code className="bg-slate-800 px-1 py-0.5 rounded text-slate-200">.env</code> file:
                </p>
                <div className="font-mono text-[11px] text-amber-300 bg-slate-900 p-2 rounded border border-slate-800">
                  GOOGLE_CLIENT_SECRET=your_secret_here
                </div>
              </div>

              {/* Redirect URI configuration */}
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">3. Authorized Redirect URI</span>
                  <span className="text-[11px] text-slate-400">Add to Cloud Console</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Ensure this URI is added under <strong>Authorized redirect URIs</strong> in Google Cloud Console:
                </p>
                <div className="font-mono text-[11px] text-indigo-300 break-all select-all bg-slate-900 p-2 rounded border border-slate-800">
                  {authStatus.redirectUri || 'http://localhost:5001/auth/google/callback'}
                </div>
              </div>

              {/* Required API & Scope */}
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="font-semibold text-slate-200">4. Gmail API Scope</span>
                <p className="text-slate-400 text-[11px] mt-1">
                  Ensure <strong>Gmail API</strong> is enabled in your Google Cloud project library. Scope requested:
                </p>
                <code className="block font-mono text-[11px] text-slate-400 mt-1 bg-slate-900 p-1.5 rounded">
                  https://www.googleapis.com/auth/gmail.readonly
                </code>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              {authStatus.configured ? (
                <a
                  href="/auth/google"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer transition-colors"
                >
                  Start Google OAuth Flow
                </a>
              ) : (
                <button
                  disabled
                  className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-500 text-xs font-semibold cursor-not-allowed"
                >
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
          className="fixed inset-0 z-50 bg-[rgb(var(--wla-ink)/0.45)] flex items-center justify-center p-4"
          onClick={() => setShowBlackbaudModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mac-auth-title"
            className="relative w-[min(100%,400px)] h-[min(90dvh,720px)] overflow-hidden border border-slate-800 bg-slate-900 shadow-xl wla-rule"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
              <h3 id="mac-auth-title" className="text-[13px] font-semibold text-slate-100 bg-slate-900/90 rounded-full px-3 py-1.5">
                Sign in to Westlake
              </h3>
              <button
                type="button"
                aria-label="Close sign-in"
                onClick={() => setShowBlackbaudModal(false)}
                className="pointer-events-auto min-h-11 px-3 rounded-lg bg-slate-900/95 text-[13px] font-semibold text-slate-100 hover:bg-slate-800"
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
                  className="absolute inset-0 z-0 w-full h-full border-0 bg-slate-900"
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
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500/20 to-blue-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Westlake Blackbaud Portal</h3>
                  <p className="text-xs text-slate-400 font-mono">westlakelutheran.myschoolapp.com</p>
                </div>
              </div>
              <button
                onClick={() => setShowBlackbaudModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3 text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <GraduationCap className="w-3.5 h-3.5 text-amber-400" />
                Sign in on this Mac
              </span>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                Chrome on this Mac opens only when someone clicks Log in with Blackbaud.
                Each person gets their own dashboard session. Eric and Stefani see Ben and Jade;
                Ben and Jade only see their own grades and tasks.
              </p>
              {macWebview.canStart && !macWebview.running && (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Use Log in with Blackbaud on the landing page to start sign-in.
                </p>
              )}
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Sync Grades refreshes this signed-in account. Log in with Blackbaud is the only
                control that starts Chromium. Phones on Wi‑Fi use{' '}
                <code className="bg-slate-800 px-1 py-0.5 rounded font-mono">http://&lt;this-mac&gt;:5173</code>.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3 text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
                Send grades from the portal
              </span>
              <p className="text-slate-400 text-[11px] leading-relaxed">
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
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-200 font-semibold cursor-grab active:cursor-grabbing"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  Send t to dashboard
                </a>
                <button
                  type="button"
                  onClick={copyBlackbaudBookmarklet}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
                >
                  {bookmarkletCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {bookmarkletCopied ? 'Copied' : 'Copy bookmarklet'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Drag the purple chip onto your bookmarks bar. Click it on the signed-in portal — it will not leave that tab.
              </p>
            </div>

            {/* Connect Form */}
            <form onSubmit={handleConnectBlackbaud} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-200 mb-1">
                  Cookie t value from Web Inspector
                </label>
                <p className="text-[11px] text-slate-500 mb-1.5 leading-relaxed">
                  Safari: Storage → Cookies → westlakelutheran.myschoolapp.com → cookie
                  {' '}<code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300 font-mono">t</code>.
                  It is HttpOnly (scripts cannot read it). Copy the Value column and paste it here.
                </p>
                <textarea
                  required
                  rows={3}
                  value={blackbaudCookieInput}
                  onChange={(e) => setBlackbaudCookieInput(e.target.value)}
                  placeholder="Paste the t cookie value (GUID)"
                  className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-100 placeholder-slate-500 font-mono text-[11px] focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {/* Student IDs (Optional) */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block font-medium text-slate-300 mb-1 text-[11px]">
                    Ben's Student ID <span className="text-slate-500">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={blackbaudBenId}
                    onChange={(e) => setBlackbaudBenId(e.target.value)}
                    placeholder="Auto-detected"
                    className="w-full px-3 py-1.5 bg-slate-950 rounded-lg border border-slate-700 text-slate-200 placeholder-slate-500 font-mono text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1 text-[11px]">
                    Jade's Student ID <span className="text-slate-500">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={blackbaudJadeId}
                    onChange={(e) => setBlackbaudJadeId(e.target.value)}
                    placeholder="Auto-detected"
                    className="w-full px-3 py-1.5 bg-slate-950 rounded-lg border border-slate-700 text-slate-200 placeholder-slate-500 font-mono text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Status information if already connected */}
              {blackbaudStatus.connected && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Currently connected to Westlake Lutheran Portal</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDisconnectBlackbaud}
                    className="text-xs text-red-400 hover:text-red-300 underline cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowBlackbaudModal(false)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isConnectingBlackbaud || !blackbaudCookieInput.trim()}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-indigo-600/20 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isConnectingBlackbaud ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Key className="w-3.5 h-3.5" />
                      <span>Connect & Fetch Grades</span>
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
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setSelectedTaskForModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignment-detail-title"
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedTaskForModal(null)}
                className="min-h-11 min-w-11 -ml-2 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100"
                aria-label="Close assignment details"
              >
                &times;
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={`text-[13px] font-semibold px-2.5 py-1 rounded-md border ${
                    selectedTaskForModal.student === 'Ben'
                      ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                      : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                  }`}
                >
                  {selectedTaskForModal.student}
                </span>
                {selectedTaskForModal.course && (
                  <span className="text-[13px] px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
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
                  <h2 id="assignment-detail-title" className="text-[17px] sm:text-lg font-semibold text-white leading-snug">
                    {decodeHtmlEntities(selectedTaskForModal.title)}
                  </h2>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                      <Clock className="w-3.5 h-3.5" />
                      Due: {selectedTaskForModal.dueDate || '—'}
                    </span>
                    {selectedTaskForModal.assignedDate && (
                      <>
                        <span className="text-slate-600">&bull;</span>
                        <span className="text-slate-400">Assigned {selectedTaskForModal.assignedDate}</span>
                      </>
                    )}
                  </div>

                  {/* Complete / Reopen Toggle Button */}
                  {String(selectedTaskForModal.id || '').startsWith('task_custom_') ? (
                  <button
                    type="button"
                    onClick={() => toggleTask(selectedTaskForModal.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                      selectedTaskForModal.completed
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-600 hover:text-white'
                    }`}
                  >
                    {selectedTaskForModal.completed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        Completed
                      </>
                    ) : (
                      <>
                        <Circle className="w-3.5 h-3.5 text-slate-400" />
                        Mark Complete
                      </>
                    )}
                  </button>
                  ) : (
                    <span className="text-[13px] text-slate-400">
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
                {selectedTaskForModal.teacher && (
                  <p className="text-[13px] text-slate-400">{selectedTaskForModal.teacher}</p>
                )}
                {selectedTaskForModal.longDescription && (
                  <p className="text-[15px] text-slate-300 leading-relaxed">
                    {decodeHtmlEntities(selectedTaskForModal.longDescription)}
                  </p>
                )}
                {selectedTaskForModal.comment && (
                  <p className="text-[13px] text-slate-400">{decodeHtmlEntities(selectedTaskForModal.comment)}</p>
                )}
              </div>

              {/* Original Email Announcement / Notification */}
              {(selectedTaskForModal.emailBody || selectedTaskForModal.emailSubject || selectedTaskForModal.emailFrom) && (
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Email Sender</div>
                        <div className="text-xs font-semibold text-slate-200 truncate">
                          {decodeHtmlEntities(selectedTaskForModal.emailFrom || selectedTaskForModal.source || 'Teacher Announcement')}
                        </div>
                      </div>
                    </div>

                    {/* Copy Button */}
                    {selectedTaskForModal.emailBody && (
                      <button
                        type="button"
                        onClick={() => handleCopyEmailText(selectedTaskForModal.emailBody)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors cursor-pointer shrink-0"
                        title="Copy full email text"
                      >
                        {copiedEmailText ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400 font-semibold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                            <span>Copy Email</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Subject Line */}
                  {selectedTaskForModal.emailSubject && (
                    <div className="pt-2 border-t border-slate-800/80 text-xs text-slate-300 flex items-baseline gap-2">
                      <span className="text-slate-500 shrink-0 font-medium">Subject:</span>
                      <span className="text-slate-200 font-semibold truncate">{decodeHtmlEntities(selectedTaskForModal.emailSubject)}</span>
                    </div>
                  )}

                  {/* Sent Date */}
                  {selectedTaskForModal.emailDate && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <span>Sent:</span>
                      <span className="text-slate-400">
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
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-indigo-400" />
                          Full Email Message
                        </span>
                        <span className="text-[10px] text-slate-500">Scroll to view entire text</span>
                      </div>
                      <div className="max-h-[220px] overflow-y-auto bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap select-text selection:bg-indigo-500/40 font-mono">
                        {decodeHtmlEntities(selectedTaskForModal.emailBody)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Collaboration & Comments Thread */}
              <div className="pt-2">
                <div className="flex items-center justify-between pb-3">
                  <h3 className="text-[13px] font-semibold text-slate-300">Notes</h3>
                  <span className="text-[13px] tabular-nums text-slate-500">
                    {(selectedTaskForModal.comments || []).length}
                  </span>
                </div>

                <div className="space-y-2.5 min-h-[90px] max-h-[200px] overflow-y-auto pr-1">
                  {(selectedTaskForModal.comments || []).length === 0 ? (
                    <div className="text-center py-6 px-4 rounded-xl border border-dashed border-slate-800 text-slate-500">
                      <p className="text-[13px] font-medium text-slate-400">No notes yet</p>
                      <p className="text-[13px] text-slate-500 mt-0.5">Add a note as {blackbaudStatus.displayName || blackbaudStatus.accountName || 'the signed-in account'}.</p>
                    </div>
                  ) : (
                    (selectedTaskForModal.comments || []).map(comment => (
                      <div
                        key={comment.id}
                        className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/90"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <ProfileAvatar name={comment.author} photoUrl={comment.authorPhoto} size={28} />
                            <span className="text-[13px] font-semibold text-slate-200 truncate">{comment.author}</span>
                            <span className="text-[12px] text-slate-500 shrink-0">{comment.timestamp}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(selectedTaskForModal.id, comment.id)}
                            className="min-h-11 min-w-11 inline-flex items-center justify-center text-slate-500 hover:text-red-400"
                            aria-label="Delete note"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-[13px] text-slate-300 mt-2 leading-relaxed whitespace-pre-wrap pl-9">
                          {decodeHtmlEntities(comment.text)}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleAddComment} className="pt-3 mt-3 border-t border-slate-800/80">
                  <div className="flex items-start gap-2">
                    <ProfileAvatar
                      name={blackbaudStatus.displayName || blackbaudStatus.accountName || 'Family'}
                      photoUrl={blackbaudStatus.photoUrl}
                      size={36}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-slate-200">
                        {blackbaudStatus.displayName || blackbaudStatus.accountName || 'Family'}
                      </p>
                      {blackbaudStatus.email && (
                        <p className="text-[12px] text-slate-500 truncate">{blackbaudStatus.email}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <textarea
                          placeholder="Add a note"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          rows={2}
                          aria-label="Assignment note"
                          className="flex-1 px-3 py-2 text-[15px] bg-slate-950 rounded-lg border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none resize-none"
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
                          className="min-h-11 px-4 bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-lg flex items-center justify-center gap-1.5 shrink-0"
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
            <div className="pt-3 border-t border-slate-800 flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedTaskForModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
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
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedEventForModal(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Badges & Close Button */}
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* Student Badge */}
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                    selectedEventForModal.student === 'Ben'
                      ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                      : selectedEventForModal.student === 'Jade'
                      ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {selectedEventForModal.student}
                </span>

                {/* Event Type Badge */}
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${
                    selectedEventForModal.type === 'sports'
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      : selectedEventForModal.type === 'academic'
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
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
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800/90 text-slate-400 border border-slate-700/60">
                  {selectedEventForModal.source}
                </span>

                {/* Status indicator */}
                {selectedEventForModal.acknowledged && (
                  <span className="text-[10px] font-medium text-emerald-400/90 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20 inline-flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" />
                    <span>Acknowledged</span>
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedEventForModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Event Title & Schedule Info Bar */}
            <div className="py-4 border-b border-slate-800/80 space-y-3 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base sm:text-lg font-bold text-white leading-snug">
                  {decodeHtmlEntities(selectedEventForModal.title)}
                </h2>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                  <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                    <Calendar className="w-3.5 h-3.5" />
                    {selectedEventForModal.date}
                  </span>
                  <span className="text-slate-600">&bull;</span>
                  <span className="flex items-center gap-1 text-slate-300 font-mono">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {selectedEventForModal.time}
                  </span>
                  <span className="text-slate-600">&bull;</span>
                  <span className="flex items-center gap-1 text-slate-300">
                    <MapPin className="w-3.5 h-3.5 text-red-400" />
                    {decodeHtmlEntities(selectedEventForModal.location)}
                  </span>
                </div>

                {/* Actions: Acknowledge & Delete */}
                <div className="flex items-center gap-2">
                  {!selectedEventForModal.acknowledged ? (
                    <button
                      type="button"
                      onClick={(e) => acknowledgeEvent(selectedEventForModal.id, e)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-slate-800 hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-300 border border-slate-700 hover:border-emerald-500/40 transition-all cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Acknowledge</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => restoreEvent(selectedEventForModal.id, e)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-slate-800 hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-300 border border-slate-700 hover:border-indigo-500/40 transition-all cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Restore to Active</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      if (window.confirm(`Delete "${decodeHtmlEntities(selectedEventForModal.title)}" from schedule?`)) {
                        deleteEvent(selectedEventForModal.id, selectedEventForModal.title, selectedEventForModal.date, e);
                      }
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-all cursor-pointer"
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
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Email Sender</div>
                      <div className="text-xs font-semibold text-slate-200 truncate">
                        {decodeHtmlEntities(selectedEventForModal.emailFrom || selectedEventForModal.rawEmailFrom || 'sportsYou / School Notification')}
                      </div>
                      {selectedEventForModal.rawEmailFrom && selectedEventForModal.emailFrom !== selectedEventForModal.rawEmailFrom && (
                        <div className="text-[10px] text-slate-500 truncate">
                          via {decodeHtmlEntities(selectedEventForModal.rawEmailFrom)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Copy Button */}
                  <button
                    type="button"
                    onClick={() => handleCopyEmailText(selectedEventForModal.emailBody || selectedEventForModal.description || '')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors cursor-pointer shrink-0"
                    title="Copy full email text"
                  >
                    {copiedEmailText ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>Copy Text</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Email Subject */}
                {selectedEventForModal.emailSubject && (
                  <div className="pt-2 border-t border-slate-800/80 text-xs text-slate-300 flex items-baseline gap-2">
                    <span className="text-slate-500 shrink-0 font-medium">Subject:</span>
                    <span className="text-slate-200 font-semibold truncate">{decodeHtmlEntities(selectedEventForModal.emailSubject)}</span>
                  </div>
                )}

                {/* Email Date if present */}
                {selectedEventForModal.emailDate && (
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <span>Sent:</span>
                    <span className="text-slate-400">
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
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    Full Email Message
                  </span>
                  <span className="text-[11px] text-slate-500">Original message content</span>
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-950/90 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap select-text selection:bg-indigo-500/40 font-mono">
                  {selectedEventForModal.emailBody ? (
                    decodeHtmlEntities(selectedEventForModal.emailBody)
                  ) : selectedEventForModal.description ? (
                    decodeHtmlEntities(selectedEventForModal.description)
                  ) : (
                    <span className="text-slate-500 italic">No additional email text body available.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-4 mt-3 border-t border-slate-800 flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedEventForModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
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
