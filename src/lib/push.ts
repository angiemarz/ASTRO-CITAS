import { get, post } from './api';

export interface PushInfo {
  configured: boolean;
  publicKey: string | null;
  devices: number;
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Debe llamarse desde un toque del usuario (requisito de iOS). */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error(
      isIos() && !isStandalone()
        ? 'En iPhone primero instala la app: Safari → Compartir → "Agregar a pantalla de inicio", y ábrela desde el ícono.'
        : 'Este navegador no admite notificaciones push.',
    );
  }
  const info = await get<PushInfo>('/push');
  if (!info.configured || !info.publicKey) throw new Error('Faltan las llaves VAPID en el servidor (ver README).');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se concedió el permiso de notificaciones. Puedes activarlo en Configuración del iPhone → Notificaciones.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(info.publicKey) });
  }
  await post('/push/subscribe', sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await post('/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
