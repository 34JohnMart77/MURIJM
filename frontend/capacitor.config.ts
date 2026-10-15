import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.muri.learn',
  appName: 'Muri',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
