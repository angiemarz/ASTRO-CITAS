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
  /** API key de Cal.com (opcional): sincroniza cancelaciones/reprogramaciones y recupera reservas perdidas. */
  CALCOM_API_KEY?: string;
  /** Solo para pruebas: URL alternativa de la API de Cal.com. */
  CALCOM_API_BASE?: string;
}
