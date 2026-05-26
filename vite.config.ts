import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 프론트는 CLOVA를 직접 호출하지 않고 로컬 프록시(VITE_API_BASE)를 경유한다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
});
