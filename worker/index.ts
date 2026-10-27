// Punto de entrada del Worker: API en /api/* y archivos estáticos de la PWA para todo lo demás.
import * as auth from './auth';
import type { Env } from './env';
import { HttpError, json, Router } from './http';
import { runReminders } from './reminders';
import * as appts from './routes/appointments';
import * as catalog from './routes/catalog';
import * as cal from './routes/calendar';
import * as hooks from './routes/hooks';
import { reconcileCalcom } from './calcom';
import * as st from './routes/stats';
import { getSettings, updateSettings } from './settings';

const router = new Router()
  // Autenticación (públicas)
  .get('/api/auth/status', auth.authStatus, { public: true })
  .post('/api/auth/setup', auth.setup, { public: true })
  .post('/api/auth/login', auth.login, { public: true })
  .post('/api/auth/logout', auth.logout, { public: true })
  .post('/api/auth/logout-all', auth.logoutAll)
  .get('/api/auth/sessions', auth.listSessions)
  .post('/api/auth/password', auth.changePassword)
  // Configuración
  .get('/api/settings', getSettings)
  .put('/api/settings', updateSettings)
  // Panel y estadísticas
  .get('/api/dashboard', st.dashboard)
  .get('/api/stats', st.stats)
  // Citas
  .get('/api/appointments', appts.listAppointments)
  .post('/api/appointments', appts.createAppointment)
  .get('/api/appointments/conflicts', appts.checkConflicts)
  .get('/api/appointments/:id', appts.getAppointment)
  .put('/api/appointments/:id', appts.updateAppointment)
  .delete('/api/appointments/:id', appts.deleteAppointment)
  .post('/api/appointments/:id/status', appts.setStatus)
  .post('/api/appointments/:id/reschedule', appts.reschedule)
  .post('/api/appointments/:id/payments', appts.addPayment)
  // Pagos
  .get('/api/payments', appts.listPayments)
  .delete('/api/payments/:id', appts.deletePayment)
  // Clientes
  .get('/api/clients', catalog.listClients)
  .post('/api/clients', catalog.createClient)
  .get('/api/clients/:id', catalog.getClient)
  .put('/api/clients/:id', catalog.updateClient)
  .delete('/api/clients/:id', catalog.deleteClient)
  // Servicios
  .get('/api/services', catalog.listServices)
  .post('/api/services', catalog.createService)
  .put('/api/services/:id', catalog.updateService)
  .delete('/api/services/:id', catalog.deleteService)
  // Promociones
  .get('/api/promotions', catalog.listPromotions)
  .post('/api/promotions', catalog.createPromotion)
  .put('/api/promotions/:id', catalog.updatePromotion)
  .delete('/api/promotions/:id', catalog.deletePromotion)
  // Notificaciones
  .get('/api/push', st.pushInfo)
  .post('/api/push/subscribe', st.pushSubscribe)
  .post('/api/push/unsubscribe', st.pushUnsubscribe)
  .post('/api/push/test', st.pushTest)
  // Integraciones: citas que llegan de Cal.com, Make, Canva…
  .post('/api/hooks/booking', hooks.bookingHook, { public: true })
  .get('/api/integrations', cal.integrationsInfo)
  .post('/api/integrations/calcom/sync', cal.syncCalcomNow)
  .get('/api/feed/:token/agenda.ics', cal.icsFeed, { public: true })
  // Respaldo
  .get('/api/export', st.exportData)
  .post('/api/import', st.importData);

async function handleApi(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const match = router.match(req.method, url.pathname);
  if (!match) throw new HttpError(404, 'Ruta no encontrada.');
  if (match === 'method') throw new HttpError(405, 'Método no permitido.');
  if (!auth.checkSameOrigin(req)) throw new HttpError(403, 'Origen no permitido.');
  if (!match.route.public && !(await auth.isAuthenticated(req, env, exec))) {
    throw new HttpError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.');
  }
  return match.route.handler({ req, env, url, params: match.params, exec });
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

export default {
  async fetch(req, env, exec): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    let res: Response;
    try {
      res = await handleApi(req, env, exec);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message, ...e.extra }, e.status);
      else {
        console.error(e);
        const msg = String((e as Error)?.message || '');
        res = json(
          {
            error: msg.includes('no such table')
              ? 'La base de datos aún no tiene tablas. Ejecuta las migraciones (ver README).'
              : 'Ocurrió un error inesperado. Inténtalo de nuevo.',
          },
          500,
        );
      }
    }
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  },

  async scheduled(event, env, exec) {
    exec.waitUntil(
      runReminders(env).then(
        (r) => r.sent && console.log(`Recordatorios enviados: ${r.sent}`),
        (e) => console.error('Error en recordatorios', e),
      ),
    );
    // Cada 30 minutos: recupera reservas de Cal.com que no hayan llegado por webhook.
    if (new Date(event.scheduledTime).getUTCMinutes() % 30 < 5) {
      exec.waitUntil(reconcileCalcom(env, exec).catch((e) => console.error('Error al sincronizar Cal.com', e)));
    }
  },
} satisfies ExportedHandler<Env>;
