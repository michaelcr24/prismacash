import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Los cobros no pueden fallar por caché: la API siempre va a la red.
        navigateFallbackDenylist: [/^\/api/, /^\/functions/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/') || url.pathname.startsWith('/functions/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'PrismaCash',
        short_name: 'PrismaCash',
        description: 'Pagos NFC/QR sin contacto para eventos',
        theme_color: '#B5691A',
        background_color: '#EFEEE6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
})
