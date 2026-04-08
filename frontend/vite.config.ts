import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/reports': {
        target: 'http://localhost:3000',
        timeout: 300000
      },
      '/auth': 'http://localhost:3000',
      '/health': 'http://localhost:3000'
    }
  }
});
