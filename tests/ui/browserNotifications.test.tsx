/**
 * Tests de browserNotifications: notificaciones nativas + sonido retro.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  requestNotificationPermission,
  sendBrowserNotification,
  playRetroSuccessSound,
} from '../../src/utils/browserNotifications';

describe('browserNotifications', () => {
  let notificationInstances: any[] = [];

  beforeEach(() => {
    notificationInstances = [];
    // Mock del constructor Notification
    (globalThis as any).Notification = vi.fn(function (this: any, title: string, opts: any) {
      this.title = title;
      this.body = opts?.body;
      this.onclick = null;
      this.close = vi.fn();
      notificationInstances.push(this);
    });
    (globalThis as any).Notification.permission = 'granted';
    (globalThis as any).Notification.requestPermission = vi.fn().mockResolvedValue('granted');
  });

  describe('requestNotificationPermission', () => {
    test('devuelve true cuando ya está concedido', async () => {
      (globalThis as any).Notification.permission = 'granted';
      const result = await requestNotificationPermission();
      expect(result).toBe(true);
      expect((globalThis as any).Notification.requestPermission).not.toHaveBeenCalled();
    });

    test('solicita permiso cuando está en estado default', async () => {
      (globalThis as any).Notification.permission = 'default';
      const result = await requestNotificationPermission();
      expect(result).toBe(true);
      expect((globalThis as any).Notification.requestPermission).toHaveBeenCalledOnce();
    });

    test('devuelve false si el permiso fue denegado', async () => {
      (globalThis as any).Notification.permission = 'denied';
      const result = await requestNotificationPermission();
      expect(result).toBe(false);
    });

    test('devuelve false si el navegador no soporta notificaciones', async () => {
      const original = (globalThis as any).Notification;
      delete (globalThis as any).Notification;
      const result = await requestNotificationPermission();
      expect(result).toBe(false);
      (globalThis as any).Notification = original;
    });
  });

  describe('sendBrowserNotification', () => {
    test('crea una notificación con título y cuerpo', async () => {
      await sendBrowserNotification('Título test', 'Cuerpo test');
      expect(notificationInstances).toHaveLength(1);
      expect(notificationInstances[0].title).toBe('Título test');
      expect(notificationInstances[0].body).toBe('Cuerpo test');
    });

    test('no lanza excepción si no hay permiso', async () => {
      (globalThis as any).Notification.permission = 'denied';
      await expect(
        sendBrowserNotification('Sin permiso', 'No debería mostrarse')
      ).resolves.not.toThrow();
      expect(notificationInstances).toHaveLength(0);
    });

    test('captura errores del constructor sin romper', async () => {
      // Mock que mantiene permission='granted' pero explota al construir
      const throwing = vi.fn(function (this: any) { throw new Error('boom'); });
      (throwing as any).permission = 'granted';
      (throwing as any).requestPermission = vi.fn().mockResolvedValue('granted');
      (globalThis as any).Notification = throwing;
      await expect(
        sendBrowserNotification('Error', 'Capturado')
      ).resolves.not.toThrow();
      expect(notificationInstances).toHaveLength(0);
    });
  });

  describe('playRetroSuccessSound', () => {
    test('crea osciladores y los arranca', () => {
      const osc = { type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
      const filter = { type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn() };

      const ctx = {
        createBiquadFilter: vi.fn(() => filter),
        createOscillator: vi.fn(() => osc),
        createGain: vi.fn(() => gain),
        destination: {},
        currentTime: 0,
      };

      // Función clásica (no arrow): el código hace `new AudioCtx()`
      (globalThis as any).AudioContext = vi.fn(function (this: any) { return ctx; });

      expect(() => playRetroSuccessSound()).not.toThrow();
      expect(ctx.createOscillator).toHaveBeenCalledOnce();
      expect(ctx.createGain).toHaveBeenCalledOnce();
      expect(ctx.createBiquadFilter).toHaveBeenCalledOnce();
      expect(osc.start).toHaveBeenCalledOnce();
      expect(osc.stop).toHaveBeenCalledOnce();
      // Frecuencias C5 → E5 → G5 → C6
      expect(osc.frequency.setValueAtTime).toHaveBeenCalledTimes(4);
    });

    test('no falla si Web Audio no está disponible', () => {
      delete (globalThis as any).AudioContext;
      delete (globalThis as any).webkitAudioContext;
      expect(() => playRetroSuccessSound()).not.toThrow();
    });
  });
});
