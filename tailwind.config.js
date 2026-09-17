/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        slate: {
          50: 'rgb(var(--wla-paper) / <alpha-value>)',
          100: 'rgb(var(--wla-ink) / <alpha-value>)',
          200: 'rgb(var(--wla-ink) / <alpha-value>)',
          300: 'rgb(var(--wla-ink-2) / <alpha-value>)',
          400: 'rgb(var(--wla-mute) / <alpha-value>)',
          500: 'rgb(var(--wla-mute) / <alpha-value>)',
          600: 'rgb(var(--wla-line-strong) / <alpha-value>)',
          700: 'rgb(var(--wla-line) / <alpha-value>)',
          750: 'rgb(var(--wla-paper-2) / <alpha-value>)',
          800: 'rgb(var(--wla-line) / <alpha-value>)',
          850: 'rgb(var(--wla-paper-2) / <alpha-value>)',
          900: 'rgb(var(--wla-paper) / <alpha-value>)',
          950: 'rgb(var(--wla-paper-2) / <alpha-value>)'
        },
        indigo: {
          300: 'rgb(var(--wla-gold) / <alpha-value>)',
          400: 'rgb(var(--wla-gold) / <alpha-value>)',
          500: 'rgb(var(--wla-ink) / <alpha-value>)',
          600: 'rgb(var(--wla-ink) / <alpha-value>)',
          900: 'rgb(var(--wla-paper-2) / <alpha-value>)',
          950: 'rgb(var(--wla-paper-2) / <alpha-value>)'
        },
        blue: {
          300: 'rgb(var(--wla-ben) / <alpha-value>)',
          400: 'rgb(var(--wla-ben) / <alpha-value>)',
          500: 'rgb(var(--wla-ben) / <alpha-value>)',
          600: 'rgb(var(--wla-ben) / <alpha-value>)',
          800: 'rgb(var(--wla-line) / <alpha-value>)',
          900: 'rgb(var(--wla-paper-2) / <alpha-value>)',
          950: 'rgb(var(--wla-paper-2) / <alpha-value>)'
        },
        purple: {
          300: 'rgb(var(--wla-jade) / <alpha-value>)',
          400: 'rgb(var(--wla-jade) / <alpha-value>)',
          500: 'rgb(var(--wla-jade) / <alpha-value>)',
          600: 'rgb(var(--wla-jade) / <alpha-value>)',
          800: 'rgb(var(--wla-line) / <alpha-value>)',
          900: 'rgb(var(--wla-paper-2) / <alpha-value>)',
          950: 'rgb(var(--wla-paper-2) / <alpha-value>)'
        }
      },
      fontFamily: {
        serif: ['"Source Serif 4"', 'Iowan Old Style', 'Palatino', 'Georgia', 'serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'Segoe UI', 'sans-serif']
      },
      minHeight: {
        11: '2.75rem'
      },
      minWidth: {
        11: '2.75rem'
      }
    }
  },
  plugins: []
};
