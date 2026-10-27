-- AstroBloomx Agenda — esquema inicial (Cloudflare D1 / SQLite)
-- Todas las fechas/horas se guardan en UTC con formato ISO 8601.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Usuario único (la dueña de la agenda)
CREATE TABLE IF NOT EXISTS owner (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  success    INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip, created_at);

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name  TEXT NOT NULL,
  phone      TEXT,
  instagram  TEXT,
  messenger  TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (full_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'General',
  description  TEXT,
  price        REAL NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'MXN',
  duration_min INTEGER,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- promo_type: fixed_price (precio especial), percent (porcentaje), amount (monto fijo de descuento)
CREATE TABLE IF NOT EXISTS promotions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  promo_type  TEXT NOT NULL CHECK (promo_type IN ('fixed_price','percent','amount')),
  value       REAL NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'MXN',
  valid_from  TEXT,           -- YYYY-MM-DD (inclusive) o NULL
  valid_to    TEXT,           -- YYYY-MM-DD (inclusive) o NULL
  conditions  TEXT,
  stackable   INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Si una promoción no tiene servicios asociados, aplica a cualquier servicio
CREATE TABLE IF NOT EXISTS promotion_services (
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  service_id   INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, service_id)
);

-- status: scheduled | confirmed | in_progress | completed | cancelled | no_show
-- platform: whatsapp | messenger | instagram | video | phone | other
CREATE TABLE IF NOT EXISTS appointments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_name    TEXT NOT NULL,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  timezone       TEXT NOT NULL,
  platform       TEXT NOT NULL DEFAULT 'whatsapp',
  contact_value  TEXT,
  status         TEXT NOT NULL DEFAULT 'scheduled',
  currency       TEXT NOT NULL DEFAULT 'MXN',
  original_price REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  final_price    REAL NOT NULL DEFAULT 0,
  manual_price   INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  started_at     TEXT,
  attended_at    TEXT,
  cancelled_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments (start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments (status, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments (client_id);

-- Copia de los servicios al momento de agendar (cambiar el catálogo no altera citas pasadas)
CREATE TABLE IF NOT EXISTS appointment_services (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id     INTEGER REFERENCES services(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  category       TEXT,
  price          REAL NOT NULL DEFAULT 0,
  duration_min   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_appt_services_appt ON appointment_services (appointment_id);

CREATE TABLE IF NOT EXISTS appointment_promotions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  promotion_id   INTEGER REFERENCES promotions(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  original_price REAL NOT NULL DEFAULT 0,
  special_price  REAL NOT NULL DEFAULT 0,
  savings        REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_appt_promos_appt ON appointment_promotions (appointment_id);

-- Historial de abonos
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  amount         REAL NOT NULL,
  method         TEXT NOT NULL DEFAULT 'transferencia',
  paid_at        TEXT NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_appt ON payments (appointment_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments (paid_at);

-- Bitácora de cambios de cada cita (reprogramaciones, cambios de estado, etc.)
CREATE TABLE IF NOT EXISTS appointment_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,
  details        TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_history_appt ON appointment_history (appointment_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

-- kind: before (antes de la cita) | overdue (cita sin marcar después de terminar)
CREATE TABLE IF NOT EXISTS reminders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  offset_min     INTEGER NOT NULL,
  remind_at      TEXT NOT NULL,
  sent_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (sent_at, remind_at);
CREATE INDEX IF NOT EXISTS idx_reminders_appt ON reminders (appointment_id);
