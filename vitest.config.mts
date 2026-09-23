import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/renderer/src/test-setup.ts'],
    include: ['tests/**/*.test.{ts,tsx,mts}'],
    exclude: ['src/app/**', 'node_modules/**', 'out/**', 'dist/**'],
  },
})
