/**
 * Utility to trigger browser desktop notifications and custom audio feedback
 */

// Helper to request browser notification permission
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!('Notification' in window)) {
    console.warn('[Notification API] This browser does not support desktop notifications.');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
};

// Play a futuristic success retro chime using Web Audio API (no external assets needed!)
export const playRetroSuccessSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    
    // Low pass filter for a warmer retro tone
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, ctx.currentTime);
    
    // First note
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc1.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
    osc1.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
    osc1.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.3); // C6
    
    gain1.gain.setValueAtTime(0, ctx.currentTime);
    gain1.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    
    osc1.connect(gain1);
    gain1.connect(filter);
    filter.connect(ctx.destination);
    
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.error('[AudioFeedback] Failed to play retro chime:', e);
  }
};

// Send browser desktop notification
export const sendBrowserNotification = async (title: string, body: string, actionUrl?: string) => {
  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    console.log('[Notification fallback]', title, body);
    return;
  }

  try {
    const notification = new Notification(title, {
      body,
      icon: '/app-icon.svg',
      badge: '/app-icon.svg',
      tag: 'commander-notification',
      requireInteraction: false,
    });

    if (actionUrl) {
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  } catch (e) {
    console.error('[Notification API] Error showing notification:', e);
  }
};
