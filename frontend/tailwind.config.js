/** @type {import('tailwindcss').Config} */
export default {
  content: [
      './index.html',
      './src/**/*.{js,ts,jsx,tsx}',
      "./frontend/**/*.{js,ts,jsx,tsx}",

  ],
  theme: {
        extend: {
            fontFamily: {
                unbounded: ['Unbounded', 'sans-serif'],
                inter: ['Inter', 'sans-serif'],
            },
            colors: {
                primary: '#080809',
                secondary: '#eeeeee',
                ui_1: '#16162a',
                ui_2: '#322e6cff',
            },
            keyframes: {
                shine: {
                    '0%': { 'background-position': '100%' },
                    '100%': { 'background-position': '-100%' },
                },
            },
            animation: {
                shine: 'shine 5s linear infinite',
            },
        },
  },
  plugins: [],
};
