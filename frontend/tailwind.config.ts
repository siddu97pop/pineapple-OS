import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mapped to theme CSS vars (see styles/globals.css) so every
        // navy-*/electric utility follows the active data-theme.
        navy: {
          950: 'rgb(var(--c-base) / <alpha-value>)',
          900: 'rgb(var(--c-surface) / <alpha-value>)',
          800: 'rgb(var(--c-surface2) / <alpha-value>)',
          700: 'rgb(var(--c-elevated) / <alpha-value>)',
          600: 'rgb(var(--c-border) / <alpha-value>)',
        },
        electric: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          dim: 'rgb(var(--c-accent-dim) / <alpha-value>)',
          glow: 'rgb(var(--c-accent-bright) / <alpha-value>)',
          faint: 'rgb(var(--c-accent) / 0.15)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'spin-slow': 'spin 2s linear infinite',
        'shake': 'shake 0.4s ease-in-out',
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '15%': { transform: 'translateX(-5px)' },
          '45%': { transform: 'translateX(5px)' },
          '75%': { transform: 'translateX(-3px)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      }
    },
  },
  plugins: [],
} satisfies Config
