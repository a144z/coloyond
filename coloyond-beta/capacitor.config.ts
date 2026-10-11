import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android shell: the built SPA is served from the WebView's local assets,
 * so the whole product runs offline except devnet RPC + price feeds.
 */
const config: CapacitorConfig = {
  appId: 'app.coloyond.devnet',
  appName: 'coloyond',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    StatusBar: {
      backgroundColor: '#EDE6D6',
      style: 'LIGHT',
      overlaysWebView: false,
    },
  },
};

export default config;
