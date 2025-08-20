/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'glass': {
          50: 'rgba(255, 255, 255, 0.1)',
          100: 'rgba(255, 255, 255, 0.15)',
          200: 'rgba(255, 255, 255, 0.2)',
          300: 'rgba(255, 255, 255, 0.25)',
        },
        'dark-glass': {
          50: 'rgba(0, 0, 0, 0.1)',
          100: 'rgba(0, 0, 0, 0.15)',
          200: 'rgba(0, 0, 0, 0.2)',
          300: 'rgba(0, 0, 0, 0.3)',
        }
      },
      backdropBlur: {
        'xs': '2px',
      },
      animation: {
        'glow': 'glow 2s ease-in-out infinite alternate',
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(250, 204, 21, 0.4)' },
          '100%': { boxShadow: '0 0 40px rgba(250, 204, 21, 0.8)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-glow': {
          '0%, 100%': { 
            opacity: '1',
            boxShadow: '0 0 30px rgba(250, 204, 21, 0.5)'
          },
          '50%': { 
            opacity: '.8',
            boxShadow: '0 0 60px rgba(250, 204, 21, 0.8)'
          },
        },
      }
    },
  },
  plugins: [
    require('daisyui'),
  ],
  daisyui: {
    themes: [
      {
        cyberpunk: {
          "primary": "#facc15",
          "secondary": "#fbbf24", 
          "accent": "#f59e0b",
          "neutral": "#0f0f0f",
          "base-100": "#1a1a1a",
          "base-200": "#262626",
          "base-300": "#404040",
          "info": "#facc15",
          "success": "#84cc16",
          "warning": "#f59e0b",
          "error": "#ef4444",
        },
      },
      "dark",
    ],
  },
}
