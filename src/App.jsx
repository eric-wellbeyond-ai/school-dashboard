import React, { useState, useEffect } from 'react';
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
  Link as LinkIcon
} from 'lucide-react';

export default function App() {
  const [selectedStudent, setSelectedStudent] = useState('All'); // 'All' | 'Ben' | 'Jade'
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [syncSource, setSyncSource] = useState('sample_mode');
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

  // Initial State populated with default school and sports items
  const [tasks, setTasks] = useState([
    {
      id: 'task_b1',
      title: 'Complete Chapter 4 Pre-Algebra Problem Set #1-25',
      student: 'Ben',
      course: 'Mathematics',
      dueDate: 'Friday, Sep 19',
      source: 'Westlake Lutheran Academy',
      completed: false,
      priority: 'high'
    },
    {
      id: 'task_b2',
      title: 'Science Fair Project Hypothesis and Materials List',
      student: 'Ben',
      course: 'Science',
      dueDate: 'Monday, Sep 22',
      source: 'Westlake Lutheran Academy',
      completed: false,
      priority: 'high'
    },
    {
      id: 'task_b3',
      title: 'Turn in signed soccer concussion waiver to Coach Henderson',
      student: 'Ben',
      course: 'Athletics',
      dueDate: 'Wednesday, Sep 17',
      source: 'sportsYou',
      completed: true,
      priority: 'medium'
    },
    {
      id: 'task_b4',
      title: 'Read chapters 3-5 of The Giver for English Literature',
      student: 'Ben',
      course: 'English / ELA',
      dueDate: 'Thursday, Sep 18',
      source: 'Westlake Lutheran Academy',
      completed: false,
      priority: 'medium'
    },
    {
      id: 'task_j1',
      title: 'Spelling Unit 4 test preparation & word cards',
      student: 'Jade',
      course: 'English / ELA',
      dueDate: 'Friday, Sep 19',
      source: 'Westlake Lutheran Academy',
      completed: false,
      priority: 'high'
    },
    {
      id: 'task_j2',
      title: 'Texas History state symbols worksheet packet',
      student: 'Jade',
      course: 'History / Social Studies',
      dueDate: 'Thursday, Sep 18',
      source: 'Westlake Lutheran Academy',
      completed: false,
      priority: 'medium'
    },
    {
      id: 'task_j3',
      title: 'Bring leaf samples for photosynthesis lab science project',
      student: 'Jade',
      course: 'Science',
      dueDate: 'Wednesday, Sep 17',
      source: 'Westlake Lutheran Academy',
      completed: true,
      priority: 'low'
    },
    {
      id: 'task_j4',
      title: 'Pack volleyball kneepads and water bottle for clinic',
      student: 'Jade',
      course: 'Athletics',
      dueDate: 'Wednesday, Sep 17',
      source: 'sportsYou',
      completed: false,
      priority: 'medium'
    }
  ]);

  const [events, setEvents] = useState([
    {
      id: 'ev_1',
      title: 'All-School Chapel Service',
      student: 'All',
      date: 'Wed, Sep 17',
      time: '8:30 AM - 9:15 AM',
      location: 'WLA Sanctuary',
      source: 'Westlake Lutheran Academy',
      type: 'school_event',
      description: 'Formal uniform dress code required'
    },
    {
      id: 'ev_2',
      title: 'Boys Soccer: Home Game vs Concordia Lutheran',
      student: 'Ben',
      date: 'Thu, Sep 18',
      time: '4:30 PM (Arrive 3:45 PM)',
      location: 'Westlake Athletic Field',
      source: 'sportsYou',
      type: 'sports',
      description: 'Wear royal blue game kits'
    },
    {
      id: 'ev_3',
      title: 'Girls Youth Volleyball Clinic & Practice',
      student: 'Jade',
      date: 'Wed, Sep 17',
      time: '4:00 PM - 5:15 PM',
      location: 'WLA Auxiliary Gym',
      source: 'sportsYou',
      type: 'sports',
      description: 'Focus on underhand serving and passing'
    },
    {
      id: 'ev_4',
      title: 'Westlake Lutheran Spirit Day & Pep Rally',
      student: 'All',
      date: 'Fri, Sep 19',
      time: '2:15 PM - 3:00 PM',
      location: 'Main Gym',
      source: 'Westlake Lutheran Academy',
      type: 'school_event',
      description: 'Wear blue and gold spirit shirts'
    },
    {
      id: 'ev_5',
      title: 'Middle School Soccer Tournament Match',
      student: 'Ben',
      date: 'Sat, Sep 20',
      time: '10:00 AM',
      location: "St. John's Athletic Complex",
      source: 'sportsYou',
      type: 'sports',
      description: 'Tournament Round 1'
    },
    {
      id: 'ev_6',
      title: 'Volleyball Scrimmage vs St. Paul',
      student: 'Jade',
      date: 'Sat, Sep 20',
      time: '11:30 AM',
      location: 'Westlake Main Gym',
      source: 'sportsYou',
      type: 'sports',
      description: 'Parent volunteers needed for score table'
    }
  ]);

  // Sync Inbox function calling backend Express API
  const handleSyncInbox = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/dashboard/sync');
      if (!res.ok) {
        throw new Error(`Sync failed with status: ${res.status}`);
      }
      const data = await res.json();
      
      if (data.tasks && data.tasks.length > 0) {
        // Merge fetched tasks preserving existing completed status where matched
        setTasks(prevTasks => {
          const completedIds = new Set(prevTasks.filter(t => t.completed).map(t => t.title.toLowerCase()));
          return data.tasks.map(t => ({
            ...t,
            completed: completedIds.has(t.title.toLowerCase()) || Boolean(t.completed)
          }));
        });
      }

      if (data.events && data.events.length > 0) {
        setEvents(data.events);
      }

      setSyncSource(data.source || 'sample_mode');
      setLastSynced(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('Failed to sync with server API:', err);
      // Fallback timestamp if offline
      setLastSynced(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
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

  useEffect(() => {
    fetchAuthStatus();

    // Check OAuth return params
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      setAuthBanner({
        type: 'success',
        message: 'Google Account successfully linked! Live Gmail synchronization is now active.'
      });
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchAuthStatus();
      handleSyncInbox();
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
    setTasks(prev =>
      prev.map(task =>
        task.id === taskId ? { ...task, completed: !task.completed } : task
      )
    );
  };

  // Delete a task
  const deleteTask = (taskId, e) => {
    e.stopPropagation();
    setTasks(prev => prev.filter(t => t.id !== taskId));
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
      priority: 'medium'
    };

    setTasks(prev => [newTask, ...prev]);
    setNewTaskTitle('');
    setIsAddingTask(false);
  };

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    const studentMatch = selectedStudent === 'All' || task.student === selectedStudent;
    if (!studentMatch) return false;

    if (taskFilter === 'pending') return !task.completed;
    if (taskFilter === 'completed') return task.completed;
    return true;
  });

  // Filter events
  const filteredEvents = events.filter(event => {
    if (selectedStudent === 'All') return true;
    return event.student === selectedStudent || event.student === 'All';
  });

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
                    <div className="text-[11px] text-slate-400">Middle School &bull; Soccer</div>
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
                    <div className="text-[11px] text-slate-400">Elementary &bull; Volleyball</div>
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
              <span className={`w-2 h-2 rounded-full ${authStatus.authenticated ? 'bg-emerald-400 animate-pulse' : 'bg-blue-400'}`}></span>
              {authStatus.authenticated ? 'Gmail API Active' : 'Sample Sync Mode'}
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
            <span>{authStatus.authenticated ? 'Gmail Connected' : 'Google OAuth Setup'}</span>
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

            {/* Sync Inbox Button */}
            <button
              id="sync-inbox-button"
              onClick={handleSyncInbox}
              disabled={isSyncing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/30 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing Inbox...' : 'Sync Inbox'}</span>
            </button>
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
                      <option value="Ben">Ben (Middle School)</option>
                      <option value="Jade">Jade (Elementary)</option>
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
                  <div className="text-center py-12 px-4 rounded-xl border border-dashed border-slate-800 text-slate-400">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                    <p className="text-sm font-medium text-slate-300">No tasks found</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {taskFilter !== 'all' ? 'Try switching your filter or click "Sync Inbox"' : 'All tasks are cleared for this view!'}
                    </p>
                  </div>
                ) : (
                  filteredTasks.map(task => {
                    const isBen = task.student === 'Ben';
                    return (
                      <div
                        key={task.id}
                        onClick={() => toggleTask(task.id)}
                        className={`group p-3.5 rounded-xl border transition-all duration-150 flex items-start justify-between gap-3 cursor-pointer ${
                          task.completed
                            ? 'bg-slate-900/40 border-slate-800/60 opacity-60 hover:opacity-90'
                            : 'bg-slate-900/90 border-slate-800 hover:border-slate-700 hover:bg-slate-850 shadow-sm'
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

                            {/* Badges: Student, Course, Due Date, Source */}
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

                              {/* Source Badge */}
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400">
                                {task.source === 'sportsYou' ? 'sportsYou' : 'Westlake'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Action buttons (Delete) */}
                        <div className="shrink-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
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
              <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      Events & Sports
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-normal">
                        {filteredEvents.length} upcoming
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400">From sportsYou & Westlake calendar</p>
                  </div>
                </div>
              </div>

              {/* Event Cards List */}
              <div className="mt-4 space-y-3 flex-1 overflow-y-auto max-h-[620px] pr-1">
                {filteredEvents.length === 0 ? (
                  <div className="text-center py-12 px-4 rounded-xl border border-dashed border-slate-800 text-slate-400">
                    <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                    <p className="text-sm font-medium text-slate-300">No events scheduled</p>
                    <p className="text-xs text-slate-500 mt-1">No upcoming sports or school events for this selection.</p>
                  </div>
                ) : (
                  filteredEvents.map(event => {
                    const isSports = event.type === 'sports';
                    const isBen = event.student === 'Ben';
                    const isJade = event.student === 'Jade';

                    return (
                      <div
                        key={event.id}
                        className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-all duration-150 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {/* Date & Time Header */}
                            <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                              <Calendar className="w-3.5 h-3.5" />
                              <span>{event.date}</span>
                              <span className="text-slate-600">&bull;</span>
                              <span className="text-slate-300 flex items-center gap-1 font-mono text-[11px]">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {event.time}
                              </span>
                            </div>

                            {/* Title */}
                            <h3 className="text-sm font-bold text-slate-100 mt-1.5 leading-snug">
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
                                <span className="truncate max-w-[140px]">{event.location}</span>
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
    </div>
  );
}
