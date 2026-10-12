import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.coloyond',
  appName: 'coloyond',
  webDir: 'dist',
  android: { path: 'apps/android', allowMixedContent: false, backgroundColor: '#EFECE6' },
  server: { androidScheme: 'https', hostname: 'localhost', appStartPath: '/app' },
  plugins: { StatusBar: { backgroundColor: '#EFECE6', style: 'LIGHT', overlaysWebView: false } },
};
export default config;
