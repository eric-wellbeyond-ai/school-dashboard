import React, { useState, useEffect, useRef } from 'react';
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
  RotateCcw,
  CheckCheck
} from 'lucide-react';

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
  const [taskFilter, setTaskFilter] = useState('all'); // 'all' | 'pending' | 'completed'
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
  // Task collaboration & comment modal state
  const [selectedTaskForModal, setSelectedTaskForModal] = useState(null);
  const [commentAuthor, setCommentAuthor] = useState(() => {
    try {
      return localStorage.getItem('family_author_name') || '';
    } catch {
      return '';
    }
  });
  const [commentText, setCommentText] = useState('');

  // Persistent state: rehydrates from browser localStorage immediately
  const [tasks, setTasks] = useState(() => {
    try {
      const saved = localStorage.getItem('school_dashboard_tasks');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [events, setEvents] = useState(() => {
    try {
      const saved = localStorage.getItem('school_dashboard_events');
      return saved ? JSON.parse(saved) : [];
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
  const persistDashboardState = (newTasks, newEvents, newDeletedKeys) => {
    const t = newTasks !== undefined ? newTasks : tasks;
    const ev = newEvents !== undefined ? newEvents : events;
    const dk = newDeletedKeys !== undefined ? newDeletedKeys : deletedEventKeys;

    try {
      localStorage.setItem('school_dashboard_tasks', JSON.stringify(t));
      localStorage.setItem('school_dashboard_events', JSON.stringify(ev));
      localStorage.setItem('school_dashboard_deleted_events', JSON.stringify(dk));
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }

    fetch('/api/dashboard/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: t, events: ev, deletedEventKeys: dk })
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
      const data = await res.json();
      
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
        const data = await res.json();
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
    fetchAuthStatus();
    loadDashboardState();

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
  }, []);

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
  const handleOpenTaskModal = (task) => {
    const current = tasks.find(t => t.id === task.id) || task;
    setSelectedTaskForModal(current);
  };

  // Add a new comment to the selected task
  const handleAddComment = (e) => {
    e.preventDefault();
    if (!commentText.trim() || !selectedTaskForModal) return;

    const authorName = commentAuthor.trim() || 'Parent / Family';
    try {
      localStorage.setItem('family_author_name', authorName);
    } catch {}

    const newComment = {
      id: `comm_${Date.now()}`,
      author: authorName,
      text: commentText.trim(),
      timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setTasks(prev => {
      const updated = prev.map(task => {
        if (task.id === selectedTaskForModal.id) {
          const u = {
            ...task,
            comments: [...(task.comments || []), newComment]
          };
          setSelectedTaskForModal(u);
          return u;
        }
        return task;
      });
      persistDashboardState(updated);
      return updated;
    });

    setCommentText('');
  };

  // Delete a comment from the task
  const handleDeleteComment = (taskId, commentId) => {
    setTasks(prev => {
      const updated = prev.map(task => {
        if (task.id === taskId) {
          const u = {
            ...task,
            comments: (task.comments || []).filter(c => c.id !== commentId)
          };
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

  // Add a new manual task
  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const newTask = {
      id: `task_custom_${Date.now()}`,
      title: newTaskTitle.trim(),
      student: newTaskStudent,
      course: newTaskCourse,
      dueDate: newTaskDue || 'Due soon',
      source: 'Westlake Lutheran Academy',
      completed: false,
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

    setAuthBanner({
      type: 'info',
      message: 'Event deleted from schedule.'
    });
    setTimeout(() => {
      setAuthBanner(prev => (prev?.message?.includes('deleted') ? null : prev));
    }, 3500);
  };

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    const studentMatch = selectedStudent === 'All' || task.student === selectedStudent;
    if (!studentMatch) return false;

    if (taskFilter === 'pending') return !task.completed;
    if (taskFilter === 'completed') return task.completed;
    return true;
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

  // Statistics
  const benTasks = tasks.filter(t => t.student === 'Ben');
  const jadeTasks = tasks.filter(t => t.student === 'Jade');
  const pendingCount = tasks.filter(t => !t.completed).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const completionPercentage = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row antialiased font-sans selection:bg-indigo-500 selection:text-white">
      {/* ---------------------------------------------------- */}
      {/* Sidebar: Navigation & Launch Portals                 */}
      {/* ---------------------------------------------------- */}
      <aside className="w-full md:w-72 bg-slate-950 border-r border-slate-800 flex flex-col justify-between p-5 shrink-0">
        <div>
          {/* School Brand Header */}
          <div className="flex items-center gap-3 pb-6 border-b border-slate-800/80">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-amber-500 flex items-center justify-center shadow-lg shadow-indigo-600/20 ring-1 ring-white/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-white flex items-center gap-1.5">
                Westlake Hub
              </h1>
              <p className="text-xs text-slate-400 font-medium">Lutheran Academy</p>
            </div>
          </div>

          {/* Direct Launch Portals */}
          <div className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-2 mb-3">
              Direct Portals
            </h2>
            <div className="space-y-2">
              {/* Blackbaud Parent Portal */}
              <a
                href="https://myea.blackbaudschool.com"
                target="_blank"
                rel="noopener noreferrer"
                id="link-blackbaud"
                className="group flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/60 hover:bg-slate-800/80 transition-all duration-200 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-colors">
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-200 group-hover:text-white">Blackbaud</div>
                    <div className="text-[11px] text-slate-400">Parent Portal</div>
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
                className="group flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/60 hover:bg-slate-800/80 transition-all duration-200 shadow-sm"
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
                className="group flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-amber-500/60 hover:bg-slate-800/80 transition-all duration-200 shadow-sm"
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
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-2 mb-3">
              Students Summary
            </h2>
            <div className="space-y-2.5">
              {/* Ben Summary */}
              <button
                onClick={() => setSelectedStudent('Ben')}
                className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center justify-between ${
                  selectedStudent === 'Ben'
                    ? 'bg-blue-600/20 border-blue-500/70 text-white shadow-md shadow-blue-900/20 ring-1 ring-blue-500/30'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-400/40 text-blue-300 flex items-center justify-center text-xs font-bold">
                    B
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Ben</div>
                    <div className="text-[11px] text-slate-400">High School &bull; Athletics</div>
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950/80 border border-blue-800/60 text-blue-300 font-mono">
                  {benTasks.filter(t => !t.completed).length} open
                </span>
              </button>

              {/* Jade Summary */}
              <button
                onClick={() => setSelectedStudent('Jade')}
                className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center justify-between ${
                  selectedStudent === 'Jade'
                    ? 'bg-purple-600/20 border-purple-500/70 text-white shadow-md shadow-purple-900/20 ring-1 ring-purple-500/30'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-400/40 text-purple-300 flex items-center justify-center text-xs font-bold">
                    J
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Jade</div>
                    <div className="text-[11px] text-slate-400">Middle School &bull; Volleyball</div>
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-800/60 text-purple-300 font-mono">
                  {jadeTasks.filter(t => !t.completed).length} open
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Sync / Connectivity Status in Sidebar Footer */}
        <div className="mt-8 pt-4 border-t border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${authStatus.authenticated ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
              {authStatus.authenticated ? 'Gmail API Active' : 'Gmail Disconnected'}
            </span>
            <span className="font-mono text-[11px] text-slate-500">v1.0.0</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
            Auto-extracts assignments & game schedules from Westlake Lutheran and sportsYou.
          </p>
          <button
            onClick={handleConnectGoogle}
            className="w-full py-1.5 px-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            <span>{authStatus.authenticated ? 'Gmail Connected' : 'Connect Google Inbox'}</span>
          </button>
        </div>
      </aside>

      {/* ---------------------------------------------------- */}
      {/* Main Content Area                                    */}
      {/* ---------------------------------------------------- */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-20 backdrop-blur-md bg-slate-900/85 border-b border-slate-800 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">Family School Dashboard</h2>
                <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 font-medium">
                  Fall 2026
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {lastSynced ? `Inbox synced at ${lastSynced}` : 'Ready to sync with school inbox & sportsYou'}
              </p>
            </div>
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
                <button
                  id="toggle-all"
                  onClick={() => setSelectedStudent('All')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${
                    selectedStudent === 'All'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  All Students
                </button>
                <button
                  id="toggle-ben"
                  onClick={() => setSelectedStudent('Ben')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex items-center gap-1.5 cursor-pointer ${
                    selectedStudent === 'Ben'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-300"></span>
                  Ben
                </button>
                <button
                  id="toggle-jade"
                  onClick={() => setSelectedStudent('Jade')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex items-center gap-1.5 cursor-pointer ${
                    selectedStudent === 'Jade'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-purple-300"></span>
                  Jade
                </button>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400">Open Tasks:</span>
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

          {/* Grid Layout: Assignments Checklist (Left) & Events Schedule (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* ---------------------------------------------------- */}
            {/* Left Column: Assignment Checklist                    */}
            {/* ---------------------------------------------------- */}
            <section className="lg:col-span-7 bg-slate-950/60 rounded-2xl border border-slate-800/80 p-5 shadow-lg flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                    <CheckSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      Assignment Checklist
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-normal">
                        {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400">Extracted from teacher emails & weekly newsletters</p>
                  </div>
                </div>

                {/* Filter and Add Task buttons */}
                <div className="flex items-center gap-2">
                  <div className="inline-flex p-0.5 bg-slate-900 rounded-lg border border-slate-800 text-[11px]">
                    <button
                      onClick={() => setTaskFilter('all')}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        taskFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setTaskFilter('pending')}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        taskFilter === 'pending' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Open
                    </button>
                    <button
                      onClick={() => setTaskFilter('completed')}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        taskFilter === 'completed' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Done
                    </button>
                  </div>

                  <button
                    onClick={() => setIsAddingTask(!isAddingTask)}
                    className="p-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600 hover:text-white transition-colors cursor-pointer"
                    title="Add custom task"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
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
              <div className="mt-4 space-y-2.5 flex-1 overflow-y-auto max-h-[620px] pr-1">
                {filteredTasks.length === 0 ? (
                  <div className="text-center py-12 px-6 rounded-xl border border-dashed border-slate-800 text-slate-400 bg-slate-950/30">
                    {!authStatus.authenticated ? (
                      <>
                        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                          <Inbox className="w-6 h-6" />
                        </div>
                        <p className="text-sm font-semibold text-slate-200">Connect Gmail to Sync Real Assignments</p>
                        <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
                          Link your Google account to automatically scan emails from Westlake Lutheran Academy and sportsYou for Ben and Jade.
                        </p>
                        <button
                          onClick={handleConnectGoogle}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
                        >
                          <Shield className="w-3.5 h-3.5" />
                          <span>Connect Gmail Account</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                        <p className="text-sm font-semibold text-slate-200">No Assignments Found</p>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                          {taskFilter !== 'all'
                            ? 'No assignments match the selected filter.'
                            : 'No assignment emails detected in the last 14 days. Click "Sync Inbox" to check again.'}
                        </p>
                        <button
                          onClick={() => handleSyncInbox('incremental')}
                          disabled={isSyncing}
                          className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-medium border border-slate-700 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                          <span>{isSyncing ? 'Syncing...' : 'Sync Inbox Now'}</span>
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  filteredTasks.map(task => {
                    const isBen = task.student === 'Ben';
                    return (
                      <div
                        key={task.id}
                        onClick={() => handleOpenTaskModal(task)}
                        className={`group p-3.5 rounded-xl border transition-all duration-150 flex items-start justify-between gap-3 cursor-pointer ${
                          task.completed
                            ? 'bg-slate-900/40 border-slate-800/60 opacity-60 hover:opacity-90'
                            : 'bg-slate-900/90 border-slate-800 hover:border-indigo-500/50 hover:bg-slate-850 shadow-sm'
                        }`}
                      >
                        {/* Checkbox and Title */}
                        <div className="flex items-start gap-3 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTask(task.id);
                            }}
                            className="mt-0.5 text-slate-400 group-hover:text-indigo-400 transition-colors focus:outline-none"
                            title={task.completed ? "Mark as open" : "Mark as completed"}
                          >
                            {task.completed ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-400 fill-emerald-500/20" />
                            ) : (
                              <Circle className="w-5 h-5 text-slate-500 group-hover:text-indigo-400" />
                            )}
                          </button>

                          <div className="min-w-0">
                            <p
                              className={`text-sm font-medium leading-snug break-words ${
                                task.completed
                                  ? 'line-through text-slate-500'
                                  : 'text-slate-100 group-hover:text-white'
                              }`}
                            >
                              {task.title}
                            </p>

                            {/* Badges: Student, Course, Due Date, Comments, Source */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              {/* Student Tag */}
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                                  isBen
                                    ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                                    : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                                }`}
                              >
                                {task.student}
                              </span>

                              {/* Course Tag */}
                              {task.course && (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60">
                                  {task.course}
                                </span>
                              )}

                              {/* Due Date */}
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                {task.dueDate}
                              </span>

                              {/* Comments count indicator */}
                              {task.comments && task.comments.length > 0 ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 font-medium">
                                  <MessageSquare className="w-2.5 h-2.5" />
                                  {task.comments.length}
                                </span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                  <MessageSquare className="w-2.5 h-2.5" /> Note
                                </span>
                              )}

                              {/* Source Badge */}
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400">
                                {task.source === 'sportsYou' ? 'sportsYou' : 'Westlake'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Action buttons (Comment & Delete) */}
                        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenTaskModal(task);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800"
                            title="View details & comments"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => deleteTask(task.id, e)}
                            className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800"
                            title="Delete task"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
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
                        className={`group relative p-3.5 rounded-xl transition-all duration-150 shadow-sm border ${
                          event.acknowledged
                            ? 'bg-slate-900/40 border-slate-800/60 opacity-80'
                            : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
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
                          <div className="flex items-center gap-1 shrink-0">
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
                        <h3 className="text-sm font-bold text-slate-100 mt-2 leading-snug">
                          {event.title}
                        </h3>

                        {/* Description / note if present */}
                        {event.description && (
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                            {event.description}
                          </p>
                        )}

                        {/* Meta items: Location, Student, Source */}
                        <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-slate-400">
                          <span className="flex items-center gap-1 bg-slate-950/80 px-2 py-0.5 rounded-md border border-slate-800 text-slate-300">
                            <MapPin className="w-3 h-3 text-red-400 shrink-0" />
                            <span className="truncate max-w-[160px]">{event.location}</span>
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
      {/* Assignment Detail & Collaboration Comments Modal     */}
      {/* ---------------------------------------------------- */}
      {selectedTaskForModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* Student Tag */}
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                    selectedTaskForModal.student === 'Ben'
                      ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                      : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                  }`}
                >
                  {selectedTaskForModal.student}
                </span>
                {/* Course Tag */}
                {selectedTaskForModal.course && (
                  <span className="text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                    {selectedTaskForModal.course}
                  </span>
                )}
                {/* Source Badge */}
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800/90 text-slate-400 border border-slate-700/60">
                  {selectedTaskForModal.source}
                </span>
              </div>
              <button
                onClick={() => setSelectedTaskForModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Task Details Info */}
            <div className="py-4 border-b border-slate-800/80 space-y-3 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-bold text-white leading-snug">
                  {selectedTaskForModal.title}
                </h2>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3 text-xs text-slate-300">
                  <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    Due: {selectedTaskForModal.dueDate}
                  </span>
                  <span className="text-slate-600">&bull;</span>
                  <span className="text-slate-400">
                    Priority: <span className="capitalize text-slate-200">{selectedTaskForModal.priority || 'medium'}</span>
                  </span>
                </div>

                {/* Complete / Reopen Toggle Button */}
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
              </div>
            </div>

            {/* Collaboration & Comments Thread */}
            <div className="flex-1 flex flex-col min-h-0 pt-4">
              <div className="flex items-center justify-between pb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-indigo-400" />
                  Family Notes & Collaboration
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-normal">
                    {(selectedTaskForModal.comments || []).length}
                  </span>
                </h3>
                <span className="text-[11px] text-slate-500">Visible to family members</span>
              </div>

              {/* Scrollable comments list */}
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[140px] max-h-[260px]">
                {(selectedTaskForModal.comments || []).length === 0 ? (
                  <div className="text-center py-8 px-4 rounded-xl border border-dashed border-slate-800 text-slate-500">
                    <MessageCircle className="w-6 h-6 mx-auto mb-1.5 text-slate-600" />
                    <p className="text-xs font-medium text-slate-400">No notes or comments yet</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">Leave a comment below to coordinate with family members.</p>
                  </div>
                ) : (
                  (selectedTaskForModal.comments || []).map(comment => (
                    <div
                      key={comment.id}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/90 hover:border-slate-700/80 transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 flex items-center justify-center text-[10px] font-bold">
                            {comment.author ? comment.author.charAt(0).toUpperCase() : 'F'}
                          </div>
                          <span className="text-xs font-semibold text-slate-200">{comment.author}</span>
                          <span className="text-[10px] text-slate-500">&bull;</span>
                          <span className="text-[10px] text-slate-500 font-mono">{comment.timestamp}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteComment(selectedTaskForModal.id, comment.id)}
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 text-xs transition-opacity p-0.5 cursor-pointer"
                          title="Delete note"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-xs text-slate-300 mt-2 leading-relaxed whitespace-pre-wrap pl-8">
                        {comment.text}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {/* Comment input form */}
              <form onSubmit={handleAddComment} className="pt-3 mt-3 border-t border-slate-800/80 space-y-2.5 shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Your name (e.g. Mom, Dad, Ben)"
                    value={commentAuthor}
                    onChange={(e) => setCommentAuthor(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-slate-950 rounded-lg border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-44"
                  />
                  <div className="flex items-center gap-1">
                    {['Mom', 'Dad', 'Ben', 'Jade'].map(quickName => (
                      <button
                        key={quickName}
                        type="button"
                        onClick={() => setCommentAuthor(quickName)}
                        className="px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-[10px] text-slate-400 hover:text-white transition-colors cursor-pointer"
                      >
                        {quickName}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <textarea
                    placeholder="Add a comment, note, or update on this assignment..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={2}
                    className="flex-1 px-3 py-2 text-xs bg-slate-950 rounded-lg border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
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
                    className="px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Post</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
