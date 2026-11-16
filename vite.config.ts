import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { loadEnv } from 'vite'
import { resolveConfig } from './src/cloud/config'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig(({ mode, command }) => {
  const config = resolveConfig(loadEnv(mode, process.cwd(), 'VITE_'), command === 'serve')
  return {
    server: {
      watch: { ignored: ['**/.cache/**', '**/test-results/**', '**/release/**', '**/backups/**'] },
    },
    plugins: [
      react(),
      tailwind(),
      {
        name: 'herfit-pages-headers',
        apply: 'build',
        generateBundle() {
          const template = readFileSync(
            new URL('./config/cloudflare-headers.txt', import.meta.url),
            'utf8',
          )
          this.emitFile({
            type: 'asset',
            fileName: '_headers',
            source: template.replace(
              ' {{supabase}}',
              config.mode === 'cloud' ? ' ' + config.url : '',
            ),
          })
        },
      },
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'HerFit · 照顾好自己',
          short_name: 'HerFit',
          description: '私人健康与运动管理',
          theme_color: '#FFF9F7',
          background_color: '#FFF9F7',
          display: 'standalone',
          start_url: '/',
          lang: 'zh-CN',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,png,svg,webp,woff2,ttf}'],
          navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
          runtimeCaching: [],
        },
      }),
    ],
    test: { include: ['tests/**/*.test.ts'] },
  }
})
