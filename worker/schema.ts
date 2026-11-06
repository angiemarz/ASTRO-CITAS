// Tablas que se crean automáticamente la primera vez (una vez por instancia del Worker), para que agregar
// funciones no obligue a ejecutar migraciones a mano en la consola de D1. Las migraciones de /migrations
// contienen lo mismo, para instalaciones nuevas.
import type { Env } from './env';

let ready = false;

export async function ensureSchema(env: Env): Promise<void> {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS external_bookings (
         source TEXT NOT NULL, external_id TEXT NOT NULL,
         appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
         created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
         PRIMARY KEY (source, external_id))`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS external_ignored (
         source TEXT NOT NULL, external_id TEXT NOT NULL, created_at TEXT NOT NULL,
         PRIMARY KEY (source, external_id))`,
    ),
    // Rituales: tema de la clienta y seguimiento (¿mandé evidencia? ¿mandé explicación?)
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ritual_details (
         appointment_id INTEGER PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
         topic TEXT,
         evidence_sent INTEGER NOT NULL DEFAULT 0,
         evidence_at TEXT,
         explanation_sent INTEGER NOT NULL DEFAULT 0,
         explanation_at TEXT,
         updated_at TEXT NOT NULL)`,
    ),
  ]);
  await seedOnce(env, 'abrecaminos_especifico', [
    env.DB.prepare(
      `INSERT INTO services (name, category, description, price, currency, duration_min, active, created_at, updated_at)
       SELECT 'Abrecaminos específico', 'Rituales ✨',
              'Ritual Abrecaminos específico: tú eliges el tema. 💜 La cooperación mínima es de $230 MXN por ritual. Si deseas aportar un poquito más, ¡es bienvenido y se agradece muchísimo! ✨',
              230, 'MXN', 60, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Abrecaminos específico')`,
    ),
  ]);
  ready = true;
}

/** Datos iniciales que se agregan una sola vez: si luego los eliminas o editas, no vuelven a aparecer. */
async function seedOnce(env: Env, key: string, stmts: D1PreparedStatement[]) {
  const marker = `seed_${key}`;
  const done = await env.DB.prepare('SELECT 1 FROM settings WHERE key = ?').bind(marker).first();
  if (done) return;
  await env.DB.batch([...stmts, env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(marker, JSON.stringify(true))]);
}
