# 🌙 AstroBloomx Agenda

Aplicación web progresiva (PWA) **personal y privada** para administrar las citas, servicios, promociones, clientes y pagos de AstroBloomx (tarot, espiritualidad y astrología).

- Se instala en el iPhone desde Safari como una app (sin App Store ni Apple Developer).
- Funciona también desde la computadora.
- Base de datos real (Cloudflare D1) y backend real (Cloudflare Workers).
- Recordatorios push al iPhone (Web Push + VAPID + Cron Triggers).
- **100 % gratis** dentro de los planes gratuitos de Cloudflare y GitHub. No requiere tarjeta, dominio ni suscripciones.

---

## ✨ Funciones

| Sección | Qué hace |
| --- | --- |
| **Inicio** | Citas de hoy, próxima cita (con tiempo restante y acciones rápidas), pendientes, atrasadas sin marcar, completadas y canceladas del mes, pagos pendientes, dinero cobrado hoy y por cobrar. Agenda del día separada en *en curso*, *próximas*, *pendientes de atender*, *completadas*. |
| **Calendario** | FullCalendar (solo funciones gratuitas): vistas mes, semana, día y lista. Toca un horario para crear una cita, mantén presionada una cita para moverla (con detección de empalmes). |
| **Nueva cita** | Buscar o crear cliente sin salir del formulario, fecha con selector, hora 12 h AM/PM o 24 h, duración automática según servicios (editable), detección de citas superpuestas con confirmación, varios servicios con subtotal, importe acordado manual, promociones (con precio original, especial, ahorro, vigencia y condiciones; no acumulables salvo que se permita), precio especial manual, plataforma (WhatsApp, Messenger, Instagram, videollamada, llamada, otra) con botón para abrir el contacto, moneda MXN/USD, abono inicial, saldo automático, estado de la cita. Botones *Guardar*, *Guardar y crear otra* y *Cancelar*. |
| **Pendientes de atender** | Atrasadas, hoy, en curso, próximas y completadas, independiente de los pagos. Nada se marca automáticamente. Acciones: atendida, iniciar, reprogramar, editar, contactar, no asistió, cancelar. Al marcarla atendida se guarda la fecha y hora real y, si hay saldo, ofrece registrar el pago. |
| **Todas las citas** | Búsqueda (cliente, servicio, notas, teléfono, usuario), filtros por periodo, estado, pago, plataforma y servicio; exportación a CSV. |
| **Clientes** | Ficha con contacto, notas, historial de citas, total pagado y saldo. |
| **Servicios** | Catálogo con categoría, precio, moneda, duración y estado activo/inactivo. |
| **Promociones** | Precio especial, porcentaje o monto de descuento; vigencia, condiciones, servicios incluidos y si es acumulable. |
| **Pagos y estadísticas** | Cobrado y facturado por periodo, ingresos por mes, por cobrar, métodos de pago, servicios más solicitados, plataformas, clientes frecuentes, promociones usadas y lista de pagos. Varios abonos por cita con historial. |
| **Configuración** | Logotipo y nombre, zona horaria (inicia en America/Monterrey), formato 12/24 h, recordatorios, resumen diario, monedas y métodos de pago, cambio de contraseña, sesiones abiertas y respaldo/restauración en JSON. |

Cada cita guarda un **historial** (creación, reprogramaciones, cambios de estado, abonos).

---

## 🧱 Tecnología

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, Lucide Icons, FullCalendar 6 (plugins MIT: daygrid, timegrid, list, interaction), TanStack Query, React Router.
- **Backend:** Cloudflare Workers (un solo Worker sirve la API en `/api/*` y los archivos de la PWA).
- **Base de datos:** Cloudflare D1 (SQLite). Migraciones en `migrations/`.
- **Recordatorios:** Cron Trigger cada 5 minutos + Web Push (RFC 8291) con VAPID (RFC 8292).
- **Autenticación:** una sola usuaria; contraseña con PBKDF2-SHA256 y sal, sesiones en D1 con cookie `HttpOnly`, `Secure`, `SameSite=Strict`, bloqueo tras 5 intentos fallidos.

### Decisiones de compatibilidad (por qué no se usaron ciertas librerías)

- **`web-push` (npm) → implementación propia con WebCrypto** (`worker/webpush.ts`). La librería depende de `crypto` y `https` de Node, que no existen en Workers. La implementación propia está probada (`tests/webpush.test.ts`) descifrando el mensaje como lo haría el navegador.
- **`bcrypt`/`argon2` → PBKDF2 de WebCrypto**, nativo en Workers. Se usan 50 000 iteraciones para no rebasar el límite de CPU del plan gratuito (10 ms); el bloqueo por intentos fallidos evita ataques de fuerza bruta.
- **Plugins de zona horaria de FullCalendar (Luxon/Moment) → no necesarios.** El calendario trabaja en "hora de pared" de la zona configurada con utilidades propias basadas en `Intl` (`shared/time.ts`).
- **`vite-plugin-pwa` → Service Worker propio** (`public/sw.js`) para controlar exactamente el manejo de notificaciones en iOS.
- **Los datos de las citas nunca se guardan en `localStorage`**; solo se recuerda la vista elegida del calendario.

### Límites gratuitos relevantes (uso personal queda muy por debajo)

- Workers Free: 100 000 peticiones/día, Cron Triggers incluidos.
- D1 Free: 5 GB de almacenamiento, 5 millones de filas leídas/día, 100 000 escritas/día.
- Web Push: los servicios de Apple/Google/Mozilla son gratuitos.
- URL HTTPS gratuita: `https://astrobloomx-agenda.<tu-subdominio>.workers.dev`.

---

## 🚀 Publicar la app (una sola vez, ~15 minutos)

Necesitas: una cuenta gratuita de **Cloudflare** (no pide tarjeta para Workers/D1), **Node.js 20+** en tu computadora y este repositorio.

```bash
# 1) Instalar dependencias
npm install

# 2) Iniciar sesión en Cloudflare (abre el navegador)
npx wrangler login

# 3) Crear la base de datos D1 gratuita
npx wrangler d1 create astrobloomx-agenda
#    → copia el "database_id" que aparece y pégalo en wrangler.jsonc (campo database_id)

# 4) Crear las tablas
npm run db:migrate:remote

# 5) Código secreto para crear tu contraseña la primera vez (inventa uno largo)
npx wrangler secret put SETUP_CODE

# 6) Llaves para las notificaciones push
npm run vapid
npx wrangler secret put VAPID_PUBLIC_KEY     # pega el valor VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY    # pega el valor VAPID_PRIVATE_KEY

# 7) Publicar
npm run deploy
```

Al terminar, Wrangler muestra tu URL, por ejemplo `https://astrobloomx-agenda.tu-subdominio.workers.dev`. (La primera vez Cloudflare te pide elegir tu subdominio gratuito `*.workers.dev`.)

Opcional: en `wrangler.jsonc` cambia `VAPID_SUBJECT` por tu correo (`mailto:tu@correo.com`); Apple lo exige como contacto del remitente de notificaciones.

### Primer ingreso

1. Abre la URL, escribe tu `SETUP_CODE` y crea tu contraseña (mínimo 10 caracteres).
2. Ve a **Servicios** y registra tu catálogo; después a **Promociones** si tienes alguna.

### 📱 Instalar en el iPhone y activar recordatorios

1. Abre la URL en **Safari**.
2. Toca **Compartir** → **Agregar a pantalla de inicio** → **Agregar**.
3. Abre AstroBloomx desde el ícono e inicia sesión.
4. Ve a **Configuración → Recordatorios push → Activar en este dispositivo** y acepta el permiso.
5. Toca **Enviar prueba** para confirmar.

> iOS 16.4 o superior. En iPhone las notificaciones web solo funcionan con la app instalada en la pantalla de inicio. Los recordatorios se revisan cada 5 minutos.

### Publicación automática con GitHub (opcional)

El flujo `.github/workflows/deploy.yml` publica la app cada vez que haces *push* a `main`:

1. En Cloudflare crea un **API Token** con la plantilla *Edit Cloudflare Workers* y agrega permiso **D1: Edit**.
2. En GitHub → *Settings → Secrets and variables → Actions* agrega `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
3. Asegúrate de haber puesto tu `database_id` en `wrangler.jsonc`.

Los secretos `SETUP_CODE` y `VAPID_*` se configuran una sola vez con `wrangler secret put` y se conservan entre publicaciones.

---

## 🎨 Usar tu logotipo original

- **Dentro de la app:** *Configuración → Mi marca → Subir mi logotipo* (se guarda en tu base de datos).
- **Ícono de la pantalla de inicio:** reemplaza `public/icons/icon.svg` por tu logotipo cuadrado (o directamente los PNG de `public/icons/`) y ejecuta `npm run icons` (requiere `npx playwright install chromium`). Después vuelve a publicar.

---

## 🛠️ Desarrollo local

```bash
cp .dev.vars.example .dev.vars   # y llena SETUP_CODE y las llaves de `npm run vapid`
npm run db:migrate:local
npm run build && npx wrangler dev   # app completa en http://127.0.0.1:8787
# o, con recarga en caliente del frontend:
npm run dev:api   # en una terminal (API en :8787)
npm run dev       # en otra (Vite en :5173, redirige /api)
```

Pruebas y verificación de tipos:

```bash
npm test          # zonas horarias, precios/promociones, enlaces de contacto y cifrado Web Push
npm run typecheck
```

## 📁 Estructura

```
worker/          API (Cloudflare Worker): auth, citas, catálogo, estadísticas, push, cron
shared/          Tipos y reglas compartidas (zonas horarias, precios, enlaces de contacto)
src/             Frontend React (páginas, componentes, hooks)
public/          Service Worker, manifest e íconos de la PWA
migrations/      Esquema de la base de datos D1
tests/           Pruebas (Vitest)
```

## 🔐 Privacidad y respaldo

- Solo tú puedes entrar: todas las rutas de la API exigen sesión, y la página tiene `noindex`.
- Tus clientes no tienen acceso a nada; la app nunca envía mensajes automáticamente (solo abre el chat cuando tú tocas *Contactar*).
- Descarga un respaldo JSON desde *Configuración → Respaldo* de vez en cuando.
