/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Benjamin Moore house palette
        calm: {
          DEFAULT: '#E6E4DF', // BM OC-22 Calm
          50: '#F7F6F3',
          100: '#E6E4DF',
          200: '#D9D6CF',
        },
        shale: {
          DEFAULT: '#C3BDB1', // BM 861 Shale
          300: '#D4CFC6',
          400: '#C3BDB1',
          500: '#A89F90',
          600: '#8F8578',
          700: '#766C61',
        },
        tawny: {
          DEFAULT: '#D4B385', // BM 1110 Tawny Bisque
          200: '#EBD9BC',
          300: '#E4CDAA',
          400: '#D4B385',
          500: '#C49A68',
          600: '#A87F4E',
          700: '#8A6740',
        },
        sienna: {
          DEFAULT: '#A5594E', // BM 1203 Warm Sienna — primary accent
          100: '#F0E0DD',
          200: '#E0C1BB',
          300: '#D09E95',
          400: '#C07B70',
          500: '#B5665A',
          600: '#A5594E',
          700: '#8A4A41',
          800: '#6F3C35',
          900: '#542E28',
          950: '#3A201C',
        },
        chocolate: {
          DEFAULT: '#8C6D5E', // BM 1014 Chocolate Pudding
          300: '#B39A8C',
          400: '#A08575',
          500: '#8C6D5E',
          600: '#755A4E',
          700: '#5E483F',
          800: '#473630',
          900: '#302420',
          950: '#1F1714', // deep cocoa (kept for light-mode accents; dark uses cursor)
        },
        // Cursor IDE dark-mode surfaces (dark mode only)
        cursor: {
          DEFAULT: '#0A0A0A', // page bg
          surface: '#141414', // cards
          elevated: '#1C1C1C', // modals / dropdowns
          border: '#2A2A2A',
          'border-subtle': '#1E1E1E',
          text: '#F0F0F0',
          secondary: '#A0A0A0',
          muted: '#606060',
          accent: '#4D9EFF',
          'accent-hover': '#3B8AE6',
        },
      },
    },
  },
  plugins: [],
}
