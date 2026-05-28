import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 프론트는 CLOVA를 직접 호출하지 않고 로컬 프록시(VITE_API_BASE)를 경유한다.
// 프로덕션은 EC2의 sub-path /giant/clova/ 에 서빙되므로 base를 맞춘다. dev는 루트.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/giant/clova/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
}));
