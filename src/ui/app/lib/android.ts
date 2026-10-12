import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useStore } from './store.js';

/**
 * Android shell integration (Capacitor). All of this no-ops on the desktop
 * web build; it only activates inside the native WebView.
 *
 *  - pulp status bar to match the lacquerboard theme
 *  - hardware back walks the screen stack, exits from tab level
 */
export async function wireAndroid(): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#EFECE6' });
  } catch {
    // older Android WebView without the status bar plugin — cosmetic only
  }

  const listener = await CapApp.addListener('backButton', () => {
    const st = useStore.getState();
    if (st.flow) {
      if (st.flow.finishedAt || st.flow.error) st.dismissFlow();
      return;
    }
    if (document.querySelector('[role=dialog]')) {
      window.dispatchEvent(new Event('coloyond:back'));
      return;
    }
    if (st.stack.length > 1) {
      st.popScreen();
    } else {
      void CapApp.exitApp();
    }
  });
  return () => { void listener.remove(); };
}
