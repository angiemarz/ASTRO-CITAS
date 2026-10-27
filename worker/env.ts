export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Código que se pide una sola vez para crear la contraseña inicial. */
  SETUP_CODE?: string;
  VAPID_PUBLIC_KEY?: string;
  /** Llave privada VAPID (componente "d" en base64url). */
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Clave para recibir citas desde Cal.com, Make, Canva, etc. */
  WEBHOOK_SECRET?: string;
}
