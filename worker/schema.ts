// Tablas y columnas que se crean automáticamente la primera vez (una vez por instancia del Worker), para que
// agregar funciones no obligue a ejecutar migraciones a mano en la consola de D1. Nunca se borra ni se
// reescribe información existente: solo se agregan tablas/columnas que faltan. Las migraciones de /migrations
// contienen lo mismo para instalaciones nuevas.
import { DESCRIPCIONES } from '../shared/descripciones';
import { normalize } from '../shared/promoGenerator';
import type { Env } from './env';

let ready = false;

/** Agrega una columna solo si no existe (los registros antiguos quedan con el valor por defecto / NULL). */
async function ensureColumn(env: Env, table: string, column: string, ddl: string) {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (results.some((r) => r.name === column)) return;
  try {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
  } catch (e) {
    // Otra instancia del Worker pudo agregarla al mismo tiempo.
    if (!/duplicate column/i.test(String((e as Error).message))) throw e;
  }
}

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

  // Columnas nuevas (los registros anteriores siguen funcionando sin ellas)
  await ensureColumn(env, 'promotions', 'requires_all', 'INTEGER NOT NULL DEFAULT 0'); // paquete: exige todos sus servicios
  await ensureColumn(env, 'services', 'intentions', 'TEXT'); // JSON: intenciones entre las que la clienta elige
  await ensureColumn(env, 'appointment_services', 'intention', 'TEXT'); // intención elegida en la cita

  await seedOnce(env, 'abrecaminos_especifico', [
    env.DB.prepare(
      `INSERT INTO services (name, category, description, price, currency, duration_min, active, created_at, updated_at)
       SELECT 'Abrecaminos específico', 'Rituales ✨',
              'Ritual Abrecaminos específico: tú eliges el tema. 💜 La cooperación mínima es de $230 MXN por ritual. Si deseas aportar un poquito más, ¡es bienvenido y se agradece muchísimo! ✨',
              230, 'MXN', 60, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Abrecaminos específico')`,
    ),
  ]);

  // Ritual 11:11: si ya existe, se actualiza su información (sin tocar una descripción que ya hayas escrito); si no, se crea.
  const desc =
    'Ritual de intención especial del portal 11:11, enfocado en canalizar deseos, manifestar propósitos y trabajar simbólicamente con la energía de nuevos comienzos.';
  const intentions = JSON.stringify(['Salud', 'Abundancia', 'Proyectos', 'Abre caminos', 'Petición de deseo']);
  await seedOnce(env, 'ritual_1111', [
    env.DB.prepare(
      `INSERT INTO services (name, category, description, price, currency, duration_min, active, intentions, created_at, updated_at)
       SELECT 'Ritual 11:11', 'Rituales ✨', ?, 111, 'MXN', 60, 1, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE NOT EXISTS (SELECT 1 FROM services WHERE lower(trim(name)) = 'ritual 11:11')`,
    ).bind(desc, intentions),
    env.DB.prepare(
      `UPDATE services SET price = 111, currency = 'MXN', category = 'Rituales ✨', active = 1,
         description = CASE WHEN description IS NULL OR trim(description) = '' THEN ? ELSE description END,
         intentions = CASE WHEN intentions IS NULL OR trim(intentions) IN ('', '[]') THEN ? ELSE intentions END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE lower(trim(name)) = 'ritual 11:11'`,
    ).bind(desc, intentions),
  ]);
  await applyDescriptions(env);
  ready = true;
}

/** Texto automático de versiones anteriores: se reemplaza sin conservarlo. */
const AUTO_TEXTS = new Set([
  'Ritual de intención especial del portal 11:11, enfocado en canalizar deseos, manifestar propósitos y trabajar simbólicamente con la energía de nuevos comienzos.',
]);

/** Pone las descripciones de la hoja de Excel en el servicio, ritual, promoción o paquete que se llame igual (una sola vez). */
async function applyDescriptions(env: Env) {
  const marker = 'seed_descripciones_xlsx_1';
  if (await env.DB.prepare('SELECT 1 FROM settings WHERE key = ?').bind(marker).first()) return;
  const wanted = new Map(DESCRIPCIONES.map(([n, d]) => [normalize(n), d]));
  const stmts: D1PreparedStatement[] = [];
  for (const table of ['services', 'promotions'] as const) {
    const rows = await env.DB.prepare(`SELECT id, name, description FROM ${table}`).all<{ id: number; name: string; description: string | null }>();
    for (const r of rows.results) {
      const d = wanted.get(normalize(r.name));
      if (!d) continue;
      const old = (r.description ?? '').trim();
      // Lo que ya escribiste se conserva debajo de la descripción nueva
      const text = !old || old === d || AUTO_TEXTS.has(old) ? d : d.includes(old) ? d : `${d}\n\n${old}`;
      stmts.push(env.DB.prepare(`UPDATE ${table} SET description = ? WHERE id = ?`).bind(text, r.id));
    }
  }
  await env.DB.batch([...stmts, env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(marker, JSON.stringify(true))]);
}

/** Datos iniciales que se agregan una sola vez: si luego los eliminas o editas, no vuelven a aparecer. */
async function seedOnce(env: Env, key: string, stmts: D1PreparedStatement[]) {
  const marker = `seed_${key}`;
  const done = await env.DB.prepare('SELECT 1 FROM settings WHERE key = ?').bind(marker).first();
  if (done) return;
  await env.DB.batch([...stmts, env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(marker, JSON.stringify(true))]);
}
