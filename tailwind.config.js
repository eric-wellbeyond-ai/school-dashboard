/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      minHeight: {
        11: '2.75rem'
      },
      minWidth: {
        11: '2.75rem'
      },
      colors: {
        'base-100': '#18181b',
        'base-200': '#09090b',
        'base-300': '#27272a',
        'base-content': '#f4f4f5',
        primary: {
          DEFAULT: '#2563eb',
          content: '#ffffff'
        },
        secondary: {
          DEFAULT: '#a78bfa',
          content: '#09090b'
        },
        success: {
          DEFAULT: '#22c55e',
          content: '#052e16'
        },
        error: {
          DEFAULT: '#ef4444',
          content: '#fff'
        },
        warning: {
          DEFAULT: '#f59e0b',
          content: '#09090b'
        },
        info: {
          DEFAULT: '#38bdf8',
          content: '#082f49'
        }
      }
    }
  },
  plugins: []
};
