import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        wine: { DEFAULT: '#741d17', dark: '#4b100d', soft: '#9d3c32' },
        artisan: {
          cream: '#fff9ed',
          paper: '#f7eddc',
          ink: '#2b211b',
          muted: '#78685d',
          gold: '#d9a438',
          green: '#176b2c',
          line: '#e7d6bd',
        },
      },
      fontFamily: {
        display: ['Georgia', 'Times New Roman', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        artisan: '0 18px 45px rgba(77, 32, 18, 0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
