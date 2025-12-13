import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from 'tailwindcss';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    open: false,
    strictPort: true,
    host: false
  },
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  }
});
