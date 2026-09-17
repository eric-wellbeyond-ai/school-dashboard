import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('School Dashboard Runtime Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-950 border border-slate-800 p-6 space-y-4 wla-rule">
            <div>
              <h2 className="font-serif text-lg font-semibold text-slate-100">Unable to load the folder</h2>
              <p className="text-[15px] text-slate-400 mt-1">
                Reload this page. If it happens again, sign in again from the landing page.
              </p>
            </div>
            <div className="p-3 bg-slate-900 rounded-lg text-[13px] font-mono text-slate-400 overflow-x-auto border border-slate-800">
              {this.state.error?.message || 'Unknown error'}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full min-h-11 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[15px] font-semibold cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

