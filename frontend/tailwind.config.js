/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0a1628',
        sky: '#00B0F0',
        accent: '#16a34a',
        surface: '#f6f7f9',
        elevated: '#ffffff',
        border: 'rgba(10,22,40,0.1)',
        'border-strong': 'rgba(10,22,40,0.18)',
        fg: '#0a1020',
        'fg-muted': '#4b5563',
        'fg-subtle': '#6b7280',
        'fg-faint': '#9ca3af',
      },
      fontFamily: {
        sans: ['Oxanium', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        md: '0.75rem',
        lg: '1rem',
      },
      boxShadow: {
        soft: '0 1px 3px rgba(10,22,40,0.04), 0 1px 2px rgba(10,22,40,0.02)',
        raised: '0 4px 12px rgba(10,22,40,0.06)',
      },
    },
  },
  plugins: [],
}
