// Clientes, servicios y promociones.
import { parseIntentions } from '../../shared/domain';
import type { Promotion } from '../../shared/types';
import { HttpError, json, nowIso, num, oneOf, optInt, readJson, reqStr, str, ymdOrNull, type Ctx } from '../http';
import { APPT_SELECT, mapAppointment } from './appointments';

// ---------- Clientes ----------

const CLIENT_STATS = `
  (SELECT COUNT(*) FROM appointments a WHERE a.client_id = c.id) AS appointment_count,
  (SELECT MAX(start_at) FROM appointments a WHERE a.client_id = c.id AND a.start_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS last_appointment_at,
  (SELECT MIN(start_at) FROM appointments a WHERE a.client_id = c.id AND a.start_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND a.status NOT IN ('cancelled','no_show')) AS next_appointment_at,
  (SELECT COALESCE(SUM(final_price), 0) FROM appointments a WHERE a.client_id = c.id AND a.status NOT IN ('cancelled','no_show')) AS total_billed,
  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN appointments a ON a.id = p.appointment_id WHERE a.client_id = c.id) AS total_paid`;

export async function listClients({ env, url }: Ctx) {
  const q = str(url.searchParams.get('q'), 100);
  const limit = Math.min(1000, optInt(url.searchParams.get('limit')) ?? 500);
  let sql = `SELECT c.*, ${CLIENT_STATS} FROM clients c`;
  const binds: unknown[] = [];
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    sql += ' WHERE c.full_name LIKE ? OR c.phone LIKE ? OR c.instagram LIKE ? OR c.messenger LIKE ?';
    binds.push(like, like, like, like);
  }
  sql += ' ORDER BY c.full_name COLLATE NOCASE LIMIT ?';
  binds.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json(results);
}

export async function getClient({ env, params }: Ctx) {
  const id = Number(params.id);
  const client = await env.DB.prepare(`SELECT c.*, ${CLIENT_STATS} FROM clients c WHERE c.id = ?`).bind(id).first();
  if (!client) throw new HttpError(404, 'El cliente no existe.');
  const { results } = await env.DB.prepare(`${APPT_SELECT} WHERE a.client_id = ? ORDER BY a.start_at DESC LIMIT 200`).bind(id).all();
  return json({ ...client, appointments: (results as never[]).map(mapAppointment) });
}

function clientFields(body: Record<string, unknown>) {
  return {
    full_name: reqStr(body.full_name, 'nombre completo', 150),
    phone: str(body.phone, 40),
    instagram: str(body.instagram, 100),
    messenger: str(body.messenger, 150),
    notes: str(body.notes, 2000),
  };
}

export async function createClient({ req, env }: Ctx) {
  const c = clientFields(await readJson(req));
  const now = nowIso();
  const row = await env.DB.prepare(
    'INSERT INTO clients (full_name, phone, instagram, messenger, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(c.full_name, c.phone, c.instagram, c.messenger, c.notes, now, now)
    .first();
  return json(row, 201);
}

export async function updateClient({ req, env, params }: Ctx) {
  const id = Number(params.id);
  const c = clientFields(await readJson(req));
  const row = await env.DB.prepare(
    'UPDATE clients SET full_name = ?, phone = ?, instagram = ?, messenger = ?, notes = ?, updated_at = ? WHERE id = ? RETURNING *',
  )
    .bind(c.full_name, c.phone, c.instagram, c.messenger, c.notes, nowIso(), id)
    .first();
  if (!row) throw new HttpError(404, 'El cliente no existe.');
  // Mantiene el nombre visible en sus citas
  await env.DB.prepare('UPDATE appointments SET client_name = ? WHERE client_id = ?').bind(c.full_name, id).run();
  return json(row);
}

export async function deleteClient({ env, params }: Ctx) {
  // Las citas conservan el nombre del cliente aunque se elimine su ficha.
  await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}

// ---------- Servicios ----------

type ServiceRow = Record<string, unknown> & { intentions?: string | null };

const mapService = (r: ServiceRow) => ({ ...r, intentions: parseIntentions(r.intentions) });

export async function listServices({ env }: Ctx) {
  const { results } = await env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM appointment_services x WHERE x.service_id = s.id) AS usage_count
     FROM services s ORDER BY s.active DESC, s.category COLLATE NOCASE, s.name COLLATE NOCASE`,
  ).all<ServiceRow>();
  return json(results.map(mapService));
}

/** Lista de intenciones: acepta un arreglo o texto con una intención por línea; sin repetidos. */
function cleanIntentions(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = String(raw ?? '').trim().slice(0, 60);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out.slice(0, 12);
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

function serviceFields(body: Record<string, unknown>) {
  const duration = optInt(body.duration_min);
  return {
    name: reqStr(body.name, 'nombre', 150),
    category: str(body.category, 80) || 'General',
    // Descripción larga (con saltos de línea); es opcional
    description: str(body.description, 5000),
    price: num(body.price ?? 0, 'precio', { min: 0, max: 10_000_000 }),
    currency: body.currency === 'USD' ? 'USD' : 'MXN',
    duration_min: duration && duration > 0 ? Math.min(duration, 1440) : null,
    active: body.active === false || body.active === 0 ? 0 : 1,
    intentions: cleanIntentions(body.intentions),
  };
}

export async function createService({ req, env }: Ctx) {
  const s = serviceFields(await readJson(req));
  const dup = await env.DB.prepare('SELECT id FROM services WHERE lower(trim(name)) = lower(?)').bind(s.name).first();
  if (dup) throw new HttpError(409, `Ya existe un servicio llamado "${s.name}". Edítalo en lugar de crear uno repetido.`);
  const now = nowIso();
  const row = await env.DB.prepare(
    `INSERT INTO services (name, category, description, price, currency, duration_min, active, intentions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(s.name, s.category, s.description, s.price, s.currency, s.duration_min, s.active, JSON.stringify(s.intentions), now, now)
    .first<ServiceRow>();
  return json(mapService(row!), 201);
}

export async function updateService({ req, env, params }: Ctx) {
  const id = Number(params.id);
  const body = await readJson<Record<string, unknown>>(req);
  const s = serviceFields(body);
  const dup = await env.DB.prepare('SELECT id FROM services WHERE lower(trim(name)) = lower(?) AND id != ?').bind(s.name, id).first();
  if (dup) throw new HttpError(409, `Ya existe otro servicio llamado "${s.name}".`);
  // Si la petición no trae descripción o intenciones, se conservan las que ya tenía (nunca se borran por omisión).
  const row = await env.DB.prepare(
    `UPDATE services SET name = ?, category = ?, price = ?, currency = ?, duration_min = ?, active = ?,
       description = CASE WHEN ? THEN ? ELSE description END,
       intentions = CASE WHEN ? THEN ? ELSE intentions END,
       updated_at = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(
      s.name,
      s.category,
      s.price,
      s.currency,
      s.duration_min,
      s.active,
      has(body, 'description') ? 1 : 0,
      s.description,
      has(body, 'intentions') ? 1 : 0,
      JSON.stringify(s.intentions),
      nowIso(),
      id,
    )
    .first<ServiceRow>();
  if (!row) throw new HttpError(404, 'El servicio no existe.');
  return json(mapService(row));
}

export async function deleteService({ env, params }: Ctx) {
  const id = Number(params.id);
  // Un paquete necesita todos sus servicios: si se elimina uno, los paquetes que lo incluyen se desactivan.
  const pk = await env.DB.prepare(
    `UPDATE promotions SET active = 0, updated_at = ?
     WHERE requires_all = 1 AND active = 1 AND id IN (SELECT promotion_id FROM promotion_services WHERE service_id = ?) RETURNING name`,
  )
    .bind(nowIso(), id)
    .all<{ name: string }>();
  // Las citas guardan una copia del servicio, así que el historial no se pierde.
  await env.DB.prepare('DELETE FROM services WHERE id = ?').bind(id).run();
  return json({ ok: true, deactivated_packages: pk.results.map((r) => r.name) });
}

// ---------- Promociones ----------

type PromoRow = Promotion & { usage_count?: number };

async function loadPromotions(env: Ctx['env'], onlyId?: number): Promise<PromoRow[]> {
  const [promos, links, usage] = await env.DB.batch([
    onlyId
      ? env.DB.prepare('SELECT * FROM promotions WHERE id = ?').bind(onlyId)
      : env.DB.prepare("SELECT * FROM promotions ORDER BY active DESC, COALESCE(valid_to, '9999') DESC, name COLLATE NOCASE"),
    env.DB.prepare('SELECT promotion_id, service_id FROM promotion_services'),
    env.DB.prepare('SELECT promotion_id, COUNT(*) AS n FROM appointment_promotions GROUP BY promotion_id'),
  ]);
  const map = new Map<number, number[]>();
  for (const l of links.results as { promotion_id: number; service_id: number }[]) {
    map.set(l.promotion_id, [...(map.get(l.promotion_id) ?? []), l.service_id]);
  }
  const used = new Map((usage.results as { promotion_id: number; n: number }[]).map((u) => [u.promotion_id, u.n]));
  return (promos.results as unknown as Promotion[]).map((p) => ({
    ...p,
    requires_all: p.requires_all ? 1 : 0,
    service_ids: map.get(p.id) ?? [],
    usage_count: used.get(p.id) ?? 0,
  }));
}

export async function listPromotions({ env }: Ctx) {
  return json(await loadPromotions(env));
}

function promoFields(body: Record<string, unknown>) {
  const promo_type = oneOf(body.promo_type, ['fixed_price', 'percent', 'amount'] as const, 'tipo de promoción');
  const value = num(body.value, 'valor', { min: 0, max: promo_type === 'percent' ? 100 : 10_000_000 });
  const valid_from = ymdOrNull(body.valid_from);
  const valid_to = ymdOrNull(body.valid_to);
  if (valid_from && valid_to && valid_to < valid_from) throw new HttpError(400, 'La vigencia final es anterior a la inicial.');
  const service_ids = Array.isArray(body.service_ids)
    ? [...new Set(body.service_ids.map((n) => optInt(n)).filter((n): n is number => !!n))]
    : [];
  return {
    name: reqStr(body.name, 'nombre', 150),
    // Descripción larga (con saltos de línea); es opcional
    description: str(body.description, 5000),
    promo_type,
    value,
    currency: body.currency === 'USD' ? 'USD' : 'MXN',
    valid_from,
    valid_to,
    conditions: str(body.conditions, 2000),
    stackable: body.stackable ? 1 : 0,
    active: body.active === false || body.active === 0 ? 0 : 1,
    requires_all: body.requires_all ? 1 : 0,
    service_ids,
  };
}

type PromoInput = ReturnType<typeof promoFields>;

const overlaps = (a: { valid_from: string | null; valid_to: string | null }, b: { valid_from: string | null; valid_to: string | null }) =>
  (a.valid_from ?? '0000-00-00') <= (b.valid_to ?? '9999-99-99') && (b.valid_from ?? '0000-00-00') <= (a.valid_to ?? '9999-99-99');

/**
 * Validaciones comerciales: servicios válidos, descuentos coherentes y sin promociones duplicadas
 * (mismo nombre, o mismos servicios + mismo descuento con vigencias que se cruzan).
 */
async function validatePromotion(env: Ctx['env'], p: PromoInput, excludeId = -1) {
  const nameDup = await env.DB.prepare('SELECT id FROM promotions WHERE lower(trim(name)) = lower(?) AND id != ?').bind(p.name, excludeId).first();
  if (nameDup) throw new HttpError(409, `Ya existe una promoción llamada "${p.name}". Cambia el nombre o edita la existente.`);

  let services: { id: number; price: number; currency: string; active: number }[] = [];
  if (p.service_ids.length) {
    const q = await env.DB.prepare(`SELECT id, price, currency, active FROM services WHERE id IN (${p.service_ids.map(() => '?').join(',')})`)
      .bind(...p.service_ids)
      .all<{ id: number; price: number; currency: string; active: number }>();
    services = q.results;
    if (services.length !== p.service_ids.length) throw new HttpError(400, 'Algún servicio de la promoción ya no existe. Vuelve a elegirlos.');
  }
  if (p.requires_all) {
    if (p.service_ids.length < 2) throw new HttpError(400, 'Un paquete necesita al menos dos servicios o rituales.');
    if (p.active && services.some((s) => !s.active)) throw new HttpError(400, 'El paquete incluye un servicio inactivo. Quítalo o actívalo primero.');
  }
  // Un descuento no puede costar más que el precio normal de lo que incluye
  if (services.length && services.every((s) => s.currency === p.currency) && p.promo_type !== 'percent') {
    const normal = Math.round(services.reduce((sum, s) => sum + s.price, 0) * 100) / 100;
    if (p.value > normal + 0.004) {
      throw new HttpError(400, `El ${p.promo_type === 'amount' ? 'descuento' : 'precio especial'} (${p.value}) es mayor al precio normal de los servicios incluidos (${normal}).`);
    }
  }
  if (p.active) {
    const same = await loadPromotions(env);
    const key = [...p.service_ids].sort((a, b) => a - b).join(',');
    const twin = same.find(
      (o) =>
        o.id !== excludeId &&
        o.active &&
        o.promo_type === p.promo_type &&
        Math.abs(Number(o.value) - p.value) < 0.0001 &&
        (o.requires_all ? 1 : 0) === p.requires_all &&
        [...o.service_ids].sort((a, b) => a - b).join(',') === key &&
        overlaps(o, p),
    );
    if (twin) throw new HttpError(409, `Ya hay una promoción activa igual ("${twin.name}"): mismos servicios, mismo descuento y vigencia que se cruza.`);
  }
}

export async function createPromotion({ req, env }: Ctx) {
  const p = promoFields(await readJson(req));
  await validatePromotion(env, p);
  const now = nowIso();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO promotions (name, description, promo_type, value, currency, valid_from, valid_to, conditions, stackable, active, requires_all, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(p.name, p.description, p.promo_type, p.value, p.currency, p.valid_from, p.valid_to, p.conditions, p.stackable, p.active, p.requires_all, now, now),
    ...p.service_ids.map((sid) =>
      env.DB.prepare('INSERT OR IGNORE INTO promotion_services (promotion_id, service_id) SELECT (SELECT MAX(id) FROM promotions), id FROM services WHERE id = ?').bind(sid),
    ),
  ];
  await env.DB.batch(stmts);
  const last = await env.DB.prepare('SELECT MAX(id) AS id FROM promotions').first<{ id: number }>();
  const [created] = await loadPromotions(env, last!.id);
  return json(created, 201);
}

export async function updatePromotion({ req, env, params }: Ctx) {
  const id = Number(params.id);
  const body = await readJson<Record<string, unknown>>(req);
  const p = promoFields(body);
  const exists = await env.DB.prepare('SELECT 1 FROM promotions WHERE id = ?').bind(id).first();
  if (!exists) throw new HttpError(404, 'La promoción no existe.');
  await validatePromotion(env, p, id);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE promotions SET name = ?, promo_type = ?, value = ?, currency = ?, valid_from = ?, valid_to = ?,
         conditions = ?, stackable = ?, active = ?, requires_all = ?,
         description = CASE WHEN ? THEN ? ELSE description END,
         updated_at = ? WHERE id = ?`,
    ).bind(
      p.name,
      p.promo_type,
      p.value,
      p.currency,
      p.valid_from,
      p.valid_to,
      p.conditions,
      p.stackable,
      p.active,
      p.requires_all,
      has(body, 'description') ? 1 : 0,
      p.description,
      nowIso(),
      id,
    ),
    env.DB.prepare('DELETE FROM promotion_services WHERE promotion_id = ?').bind(id),
    ...p.service_ids.map((sid) =>
      env.DB.prepare('INSERT OR IGNORE INTO promotion_services (promotion_id, service_id) SELECT ?, id FROM services WHERE id = ?').bind(id, sid),
    ),
  ]);
  const [updated] = await loadPromotions(env, id);
  return json(updated);
}

export async function deletePromotion({ env, params }: Ctx) {
  await env.DB.prepare('DELETE FROM promotions WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}
