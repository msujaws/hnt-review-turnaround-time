import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      spacing: {
        '30': '7.5rem',
      },
      fontFamily: {
        sans: [
          '"Mozilla Text"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        display: [
          '"Mozilla Headline"',
          '"Mozilla Text"',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
      },
      keyframes: {
        'pop-in': {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '70%': { transform: 'scale(1.04)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'soft-pulse': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.12)', opacity: '0.85' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-5deg)' },
          '75%': { transform: 'rotate(5deg)' },
        },
      },
      animation: {
        'pop-in': 'pop-in 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'soft-pulse': 'soft-pulse 2.4s ease-in-out infinite',
        wiggle: 'wiggle 700ms ease-in-out',
      },
      transitionTimingFunction: {
        bouncy: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
