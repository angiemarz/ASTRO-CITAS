import { FINAL_STATUSES, paymentStatus, round2, STATUS_LABELS } from '../../shared/domain';
import { formatDateShort, formatTime, isValidTimeZone } from '../../shared/time';
import type {
  Appointment,
  AppointmentInput,
  AppointmentStatus,
  Conflict,
  Platform,
  Settings,
} from '../../shared/types';
import type { Env } from '../env';
import {
  HttpError,
  isoDate,
  json,
  nowIso,
  num,
  oneOf,
  optInt,
  readJson,
  reqStr,
  str,
  type Ctx,
} from '../http';
import { reminderStatements } from '../reminders';
import { loadSettings } from '../settings';

export const STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
export const PLATFORMS: Platform[] = ['whatsapp', 'messenger', 'instagram', 'video', 'phone', 'other'];

const PAID_SQL = 'COALESCE((SELECT SUM(amount) FROM payments p WHERE p.appointment_id = a.id), 0)';

export const APPT_SELECT = `
  SELECT a.*,
    ${PAID_SQL} AS paid_total,
    (SELECT json_group_array(json_object('id', s.id, 'service_id', s.service_id, 'name', s.name,
        'category', s.category, 'price', s.price, 'duration_min', s.duration_min))
       FROM appointment_services s WHERE s.appointment_id = a.id) AS services_json,
    (SELECT json_group_array(json_object('id', pr.id, 'promotion_id', pr.promotion_id, 'name', pr.name,
        'original_price', pr.original_price, 'special_price', pr.special_price, 'savings', pr.savings))
       FROM appointment_promotions pr WHERE pr.appointment_id = a.id) AS promotions_json
  FROM appointments a`;

type Row = Omit<Appointment, 'services' | 'promotions' | 'balance' | 'payment_status'> & {
  services_json: string | null;
  promotions_json: string | null;
};

export function mapAppointment(r: Row): Appointment {
  const { services_json, promotions_json, ...rest } = r;
  const paid = round2(r.paid_total);
  const services = services_json ? JSON.parse(services_json) : [];
  const promotions = promotions_json ? JSON.parse(promotions_json) : [];
  return {
    ...rest,
    paid_total: paid,
    balance: round2(Math.max(0, r.final_price - paid)),
    payment_status: paymentStatus(r.final_price, paid),
    services: services.filter((s: { name: string | null }) => s && s.name != null),
    promotions: promotions.filter((p: { name: string | null }) => p && p.name != null),
  };
}

export async function fetchAppointment(env: Env, id: number): Promise<Appointment | null> {
  const row = await env.DB.prepare(`${APPT_SELECT} WHERE a.id = ?`).bind(id).first<Row>();
  return row ? mapAppointment(row) : null;
}

async function findConflicts(env: Env, start: string, end: string, excludeId?: number): Promise<Conflict[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, client_name, start_at, end_at, status FROM appointments
     WHERE status NOT IN ('cancelled','no_show') AND start_at < ? AND end_at > ? AND id != ?
     ORDER BY start_at`,
  )
    .bind(end, start, excludeId ?? -1)
    .all<Conflict>();
  return results;
}

function conflictError(conflicts: Conflict[], settings: Settings) {
  const use24 = settings.time_format === '24h';
  const names = conflicts
    .map((c) => `${c.client_name} (${formatTime(c.start_at, settings.timezone, use24)}–${formatTime(c.end_at, settings.timezone, use24)})`)
    .join(', ');
  return new HttpError(409, `Este horario se cruza con: ${names}.`, { conflicts });
}

function historyStmt(env: Env, id: number | string, action: string, details?: string | null) {
  if (id === 'last') {
    return env.DB.prepare(
      'INSERT INTO appointment_history (appointment_id, action, details, created_at) VALUES ((SELECT MAX(id) FROM appointments), ?, ?, ?)',
    ).bind(action, details ?? null, nowIso());
  }
  return env.DB.prepare('INSERT INTO appointment_history (appointment_id, action, details, created_at) VALUES (?, ?, ?, ?)').bind(
    id,
    action,
    details ?? null,
    nowIso(),
  );
}

// ---------- Validación ----------

interface CleanInput {
  client_id: number | null;
  client: AppointmentInput['client'];
  start_at: string;
  end_at: string;
  timezone: string;
  platform: Platform;
  contact_value: string | null;
  status: AppointmentStatus;
  currency: 'MXN' | 'USD';
  original_price: number;
  discount: number;
  final_price: number;
  manual_price: number;
  notes: string | null;
  services: AppointmentInput['services'];
  promotions: AppointmentInput['promotions'];
  initial_payment: AppointmentInput['initial_payment'];
  allow_overlap: boolean;
}

function validate(body: AppointmentInput): CleanInput {
  const start_at = isoDate(body.start_at, 'hora de inicio');
  const end_at = isoDate(body.end_at, 'hora de finalización');
  if (end_at <= start_at) throw new HttpError(400, 'La hora de finalización debe ser posterior a la hora de inicio.');
  if (new Date(end_at).getTime() - new Date(start_at).getTime() > 24 * 3600_000)
    throw new HttpError(400, 'Una cita no puede durar más de 24 horas.');
  const timezone = String(body.timezone || 'America/Monterrey');
  if (!isValidTimeZone(timezone)) throw new HttpError(400, 'Zona horaria inválida.');

  const client_id = optInt(body.client_id);
  let client: CleanInput['client'] = null;
  if (body.client) {
    client = {
      full_name: reqStr(body.client.full_name, 'nombre completo', 150),
      phone: str(body.client.phone, 40),
      instagram: str(body.client.instagram, 100),
      messenger: str(body.client.messenger, 150),
      notes: str(body.client.notes, 2000),
    };
  }
  if (!client_id && !client) throw new HttpError(400, 'El nombre completo del cliente es obligatorio.');

  const services = (Array.isArray(body.services) ? body.services : []).slice(0, 30).map((s) => ({
    service_id: optInt(s.service_id),
    name: reqStr(s.name, 'servicio', 150),
    category: str(s.category, 80),
    price: num(s.price ?? 0, 'precio del servicio', { min: 0, max: 10_000_000 }),
    duration_min: optInt(s.duration_min),
  }));
  const promotions = (Array.isArray(body.promotions) ? body.promotions : []).slice(0, 10).map((p) => ({
    promotion_id: optInt(p.promotion_id),
    name: reqStr(p.name, 'promoción', 150),
    original_price: num(p.original_price ?? 0, 'precio original', { min: 0 }),
    special_price: num(p.special_price ?? 0, 'precio especial', { min: 0 }),
    savings: num(p.savings ?? 0, 'ahorro', { min: 0 }),
  }));

  const original_price = num(body.original_price ?? 0, 'precio original', { min: 0, max: 10_000_000 });
  const final_price = num(body.final_price ?? 0, 'precio final', { min: 0, max: 10_000_000 });
  const discount = round2(Math.max(0, original_price - final_price));

  let initial_payment: CleanInput['initial_payment'] = null;
  if (body.initial_payment && Number(body.initial_payment.amount) > 0) {
    initial_payment = {
      amount: num(body.initial_payment.amount, 'cantidad abonada', { min: 0.01, max: 10_000_000 }),
      method: str(body.initial_payment.method, 40) || 'Transferencia',
      paid_at: isoDate(body.initial_payment.paid_at || nowIso(), 'fecha de pago'),
      note: str(body.initial_payment.note, 500),
    };
  }

  return {
    client_id,
    client,
    start_at,
    end_at,
    timezone,
    platform: oneOf(body.platform, PLATFORMS, 'plataforma'),
    contact_value: str(body.contact_value, 500),
    status: oneOf(body.status ?? 'scheduled', STATUSES, 'estado'),
    currency: body.currency === 'USD' ? 'USD' : 'MXN',
    original_price,
    discount,
    final_price,
    manual_price: body.manual_price ? 1 : 0,
    notes: str(body.notes, 5000),
    services,
    promotions,
    initial_payment,
    allow_overlap: !!body.allow_overlap,
  };
}

/** Crea o actualiza el cliente y devuelve [client_id, client_name]. */
async function resolveClient(env: Env, input: CleanInput): Promise<[number, string]> {
  const now = nowIso();
  if (input.client_id) {
    const existing = await env.DB.prepare('SELECT id, full_name FROM clients WHERE id = ?')
      .bind(input.client_id)
      .first<{ id: number; full_name: string }>();
    if (!existing) throw new HttpError(400, 'El cliente seleccionado ya no existe.');
    if (input.client) {
      const c = input.client;
      await env.DB.prepare(
        `UPDATE clients SET full_name = ?, phone = COALESCE(?, phone), instagram = COALESCE(?, instagram),
           messenger = COALESCE(?, messenger), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
      )
        .bind(c.full_name, c.phone ?? null, c.instagram ?? null, c.messenger ?? null, c.notes ?? null, now, existing.id)
        .run();
      return [existing.id, c.full_name];
    }
    return [existing.id, existing.full_name];
  }
  const c = input.client!;
  const row = await env.DB.prepare(
    `INSERT INTO clients (full_name, phone, instagram, messenger, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(c.full_name, c.phone ?? null, c.instagram ?? null, c.messenger ?? null, c.notes ?? null, now, now)
    .first<{ id: number }>();
  return [row!.id, c.full_name];
}

function childStatements(env: Env, idRef: number | 'last', input: CleanInput): D1PreparedStatement[] {
  const ref = idRef === 'last' ? '(SELECT MAX(id) FROM appointments)' : '?';
  const bindId = (vals: unknown[]) => (idRef === 'last' ? vals : [idRef, ...vals]);
  const stmts: D1PreparedStatement[] = [];
  for (const s of input.services) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO appointment_services (appointment_id, service_id, name, category, price, duration_min) VALUES (${ref}, ?, ?, ?, ?, ?)`,
      ).bind(...bindId([s.service_id, s.name, s.category, s.price, s.duration_min])),
    );
  }
  for (const p of input.promotions) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO appointment_promotions (appointment_id, promotion_id, name, original_price, special_price, savings) VALUES (${ref}, ?, ?, ?, ?, ?)`,
      ).bind(...bindId([p.promotion_id, p.name, p.original_price, p.special_price, p.savings])),
    );
  }
  return stmts;
}

// ---------- Handlers ----------

export async function listAppointments({ env, url }: Ctx) {
  const q = url.searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  const from = q.get('from');
  const to = q.get('to');
  if (from) {
    where.push('a.end_at > ?');
    binds.push(isoDate(from, 'from'));
  }
  if (to) {
    where.push('a.start_at < ?');
    binds.push(isoDate(to, 'to'));
  }
  const view = q.get('view');
  if (view === 'open') where.push("a.status IN ('scheduled','confirmed','in_progress')");
  const statuses = (q.get('status') || '').split(',').filter((s) => STATUSES.includes(s as AppointmentStatus));
  if (statuses.length) {
    where.push(`a.status IN (${statuses.map(() => '?').join(',')})`);
    binds.push(...statuses);
  }
  const platform = q.get('platform');
  if (platform && PLATFORMS.includes(platform as Platform)) {
    where.push('a.platform = ?');
    binds.push(platform);
  }
  const clientId = optInt(q.get('client_id'));
  if (clientId) {
    where.push('a.client_id = ?');
    binds.push(clientId);
  }
  const serviceId = optInt(q.get('service_id'));
  if (serviceId) {
    where.push('EXISTS (SELECT 1 FROM appointment_services s WHERE s.appointment_id = a.id AND s.service_id = ?)');
    binds.push(serviceId);
  }
  const promoId = optInt(q.get('promotion_id'));
  if (promoId) {
    where.push('EXISTS (SELECT 1 FROM appointment_promotions pr WHERE pr.appointment_id = a.id AND pr.promotion_id = ?)');
    binds.push(promoId);
  }
  const currency = q.get('currency');
  if (currency === 'MXN' || currency === 'USD') {
    where.push('a.currency = ?');
    binds.push(currency);
  }
  const search = str(q.get('q'), 100);
  if (search) {
    const like = `%${search.replace(/[%_]/g, '')}%`;
    where.push(`(a.client_name LIKE ? OR a.notes LIKE ? OR a.contact_value LIKE ?
      OR EXISTS (SELECT 1 FROM appointment_services s WHERE s.appointment_id = a.id AND s.name LIKE ?)
      OR EXISTS (SELECT 1 FROM clients c WHERE c.id = a.client_id AND (c.phone LIKE ? OR c.instagram LIKE ? OR c.messenger LIKE ?)))`);
    binds.push(like, like, like, like, like, like, like);
  }
  const pay = q.get('payment');
  if (pay === 'unpaid') where.push(`${PAID_SQL} <= 0 AND a.final_price > 0`);
  else if (pay === 'partial') where.push(`${PAID_SQL} > 0 AND ${PAID_SQL} < a.final_price - 0.004`);
  else if (pay === 'paid') where.push(`${PAID_SQL} >= a.final_price - 0.004`);
  else if (pay === 'owing') where.push(`${PAID_SQL} < a.final_price - 0.004 AND a.status NOT IN ('cancelled','no_show')`);

  const order = q.get('order') === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(500, Math.max(1, optInt(q.get('limit')) ?? 200));
  const offset = Math.max(0, optInt(q.get('offset')) ?? 0);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`${APPT_SELECT} ${whereSql} ORDER BY a.start_at ${order} LIMIT ? OFFSET ?`).bind(...binds, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM appointments a ${whereSql}`).bind(...binds),
  ]);
  return json({
    items: (rows.results as Row[]).map(mapAppointment),
    total: (count.results[0] as { n: number }).n,
    limit,
    offset,
  });
}

export async function getAppointment({ env, params }: Ctx) {
  const id = Number(params.id);
  const appt = await fetchAppointment(env, id);
  if (!appt) throw new HttpError(404, 'La cita no existe.');
  const [payments, history, client] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM payments WHERE appointment_id = ? ORDER BY paid_at, id').bind(id),
    env.DB.prepare('SELECT id, action, details, created_at FROM appointment_history WHERE appointment_id = ? ORDER BY id DESC').bind(id),
    env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(appt.client_id ?? -1),
  ]);
  return json({
    ...appt,
    payments: payments.results,
    history: history.results,
    client: client.results[0] ?? null,
  });
}

export async function checkConflicts({ env, url }: Ctx) {
  const start = isoDate(url.searchParams.get('start'), 'start');
  const end = isoDate(url.searchParams.get('end'), 'end');
  const exclude = optInt(url.searchParams.get('exclude')) ?? undefined;
  return json(await findConflicts(env, start, end, exclude));
}

export async function createAppointment({ req, env }: Ctx) {
  const input = validate(await readJson<AppointmentInput>(req));
  const settings = await loadSettings(env);
  if (!input.allow_overlap && !['cancelled', 'no_show'].includes(input.status)) {
    const conflicts = await findConflicts(env, input.start_at, input.end_at);
    if (conflicts.length) throw conflictError(conflicts, settings);
  }
  const [clientId, clientName] = await resolveClient(env, input);
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO appointments (client_id, client_name, start_at, end_at, timezone, platform, contact_value, status, currency,
         original_price, discount, final_price, manual_price, notes, started_at, attended_at, cancelled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      clientId,
      clientName,
      input.start_at,
      input.end_at,
      input.timezone,
      input.platform,
      input.contact_value,
      input.status,
      input.currency,
      input.original_price,
      input.discount,
      input.final_price,
      input.manual_price,
      input.notes,
      input.status === 'in_progress' ? now : null,
      input.status === 'completed' ? now : null,
      ['cancelled', 'no_show'].includes(input.status) ? now : null,
      now,
      now,
    ),
    ...childStatements(env, 'last', input),
    historyStmt(env, 'last', 'Cita creada', STATUS_LABELS[input.status]),
  ];
  if (input.initial_payment) {
    const p = input.initial_payment;
    stmts.push(
      env.DB.prepare(
        'INSERT INTO payments (appointment_id, amount, method, paid_at, note, created_at) VALUES ((SELECT MAX(id) FROM appointments), ?, ?, ?, ?, ?)',
      ).bind(p.amount, p.method, p.paid_at, p.note ?? null, now),
    );
  }
  await env.DB.batch(stmts);
  const created = await env.DB.prepare('SELECT MAX(id) AS id FROM appointments').first<{ id: number }>();
  const appt = (await fetchAppointment(env, created!.id))!;
  await env.DB.batch(reminderStatements(env, appt, settings));
  return json(appt, 201);
}

export async function updateAppointment({ req, env, params }: Ctx) {
  const id = Number(params.id);
  const before = await fetchAppointment(env, id);
  if (!before) throw new HttpError(404, 'La cita no existe.');
  const input = validate(await readJson<AppointmentInput>(req));
  const settings = await loadSettings(env);
  if (!input.allow_overlap && !['cancelled', 'no_show'].includes(input.status)) {
    const conflicts = await findConflicts(env, input.start_at, input.end_at, id);
    if (conflicts.length) throw conflictError(conflicts, settings);
  }
  const [clientId, clientName] = await resolveClient(env, input);
  const now = nowIso();
  const changes: string[] = [];
  const use24 = settings.time_format === '24h';
  if (before.start_at !== input.start_at || before.end_at !== input.end_at) {
    changes.push(
      `Horario: ${formatDateShort(before.start_at, settings.timezone)} ${formatTime(before.start_at, settings.timezone, use24)} → ${formatDateShort(input.start_at, settings.timezone)} ${formatTime(input.start_at, settings.timezone, use24)}`,
    );
  }
  if (before.status !== input.status) changes.push(`Estado: ${STATUS_LABELS[before.status]} → ${STATUS_LABELS[input.status]}`);
  if (round2(before.final_price) !== input.final_price) changes.push(`Precio final: ${before.final_price} → ${input.final_price}`);

  const stmts = [
    env.DB.prepare(
      `UPDATE appointments SET client_id = ?, client_name = ?, start_at = ?, end_at = ?, timezone = ?, platform = ?, contact_value = ?,
         status = ?, currency = ?, original_price = ?, discount = ?, final_price = ?, manual_price = ?, notes = ?,
         started_at = CASE WHEN ? = 'in_progress' AND started_at IS NULL THEN ? ELSE started_at END,
         attended_at = CASE WHEN ? = 'completed' THEN COALESCE(attended_at, ?) ELSE NULL END,
         cancelled_at = CASE WHEN ? IN ('cancelled','no_show') THEN COALESCE(cancelled_at, ?) ELSE NULL END,
         updated_at = ?
       WHERE id = ?`,
    ).bind(
      clientId,
      clientName,
      input.start_at,
      input.end_at,
      input.timezone,
      input.platform,
      input.contact_value,
      input.status,
      input.currency,
      input.original_price,
      input.discount,
      input.final_price,
      input.manual_price,
      input.notes,
      input.status,
      now,
      input.status,
      now,
      input.status,
      now,
      now,
      id,
    ),
    env.DB.prepare('DELETE FROM appointment_services WHERE appointment_id = ?').bind(id),
    env.DB.prepare('DELETE FROM appointment_promotions WHERE appointment_id = ?').bind(id),
    ...childStatements(env, id, input),
    historyStmt(env, id, 'Cita editada', changes.join(' · ') || null),
  ];
  if (input.initial_payment) {
    const p = input.initial_payment;
    stmts.push(
      env.DB.prepare('INSERT INTO payments (appointment_id, amount, method, paid_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        id,
        p.amount,
        p.method,
        p.paid_at,
        p.note ?? null,
        now,
      ),
    );
  }
  await env.DB.batch(stmts);
  const appt = (await fetchAppointment(env, id))!;
  await env.DB.batch(reminderStatements(env, appt, settings));
  return json(appt);
}

export async function setStatus({ req, env, params }: Ctx) {
  const id = Number(params.id);
  const before = await fetchAppointment(env, id);
  if (!before) throw new HttpError(404, 'La cita no existe.');
  const body = await readJson<{ status: AppointmentStatus; at?: string; note?: string }>(req);
  const status = oneOf(body.status, STATUSES, 'estado');
  const at = body.at ? isoDate(body.at, 'fecha') : nowIso();
  const now = nowIso();
  const settings = await loadSettings(env);

  let sql = 'UPDATE appointments SET status = ?, updated_at = ?';
  const binds: unknown[] = [status, now];
  if (status === 'in_progress') {
    sql += ', started_at = ?, attended_at = NULL, cancelled_at = NULL';
    binds.push(at);
  } else if (status === 'completed') {
    sql += ', attended_at = ?, cancelled_at = NULL';
    binds.push(at);
  } else if (status === 'cancelled' || status === 'no_show') {
    sql += ', cancelled_at = ?, attended_at = NULL';
    binds.push(at);
  } else {
    sql += ', attended_at = NULL, cancelled_at = NULL';
  }
  sql += ' WHERE id = ?';
  binds.push(id);

  const use24 = settings.time_format === '24h';
  let details = `${STATUS_LABELS[before.status]} → ${STATUS_LABELS[status]}`;
  if (status === 'completed') details += ` · atendida el ${formatDateShort(at, settings.timezone)} a las ${formatTime(at, settings.timezone, use24)}`;
  const note = str(body.note, 500);
  if (note) details += ` · ${note}`;

  await env.DB.batch([env.DB.prepare(sql).bind(...binds), historyStmt(env, id, 'Cambio de estado', details)]);
  const appt = (await fetchAppointment(env, id))!;
  await env.DB.batch(reminderStatements(env, appt, settings));
  return json(appt);
}

export async function reschedule({ req, env, params }: Ctx) {
  const id = Number(params.id);
  const before = await fetchAppointment(env, id);
  if (!before) throw new HttpError(404, 'La cita no existe.');
  const body = await readJson<{ start_at: string; end_at: string; allow_overlap?: boolean; reason?: string }>(req);
  const start_at = isoDate(body.start_at, 'hora de inicio');
  const end_at = isoDate(body.end_at, 'hora de finalización');
  if (end_at <= start_at) throw new HttpError(400, 'La hora de finalización debe ser posterior a la de inicio.');
  const settings = await loadSettings(env);
  if (!body.allow_overlap) {
    const conflicts = await findConflicts(env, start_at, end_at, id);
    if (conflicts.length) throw conflictError(conflicts, settings);
  }
  const use24 = settings.time_format === '24h';
  const tz = settings.timezone;
  const details =
    `${formatDateShort(before.start_at, tz)} ${formatTime(before.start_at, tz, use24)} → ${formatDateShort(start_at, tz)} ${formatTime(start_at, tz, use24)}` +
    (str(body.reason, 300) ? ` · ${str(body.reason, 300)}` : '');
  // Una cita reprogramada vuelve a estar pendiente si estaba cancelada o marcada como no asistió.
  const newStatus: AppointmentStatus = FINAL_STATUSES.includes(before.status) && before.status !== 'completed' ? 'scheduled' : before.status;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE appointments SET start_at = ?, end_at = ?, status = ?, cancelled_at = CASE WHEN ? = 'scheduled' THEN NULL ELSE cancelled_at END, updated_at = ? WHERE id = ?`,
    ).bind(start_at, end_at, newStatus, newStatus, nowIso(), id),
    historyStmt(env, id, 'Reprogramada', details),
  ]);
  const appt = (await fetchAppointment(env, id))!;
  await env.DB.batch(reminderStatements(env, appt, settings));
  return json(appt);
}

export async function deleteAppointment({ env, params }: Ctx) {
  const id = Number(params.id);
  await env.DB.prepare('DELETE FROM appointments WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// ---------- Pagos ----------

export async function addPayment({ req, env, params }: Ctx) {
  const id = Number(params.id);
  const appt = await fetchAppointment(env, id);
  if (!appt) throw new HttpError(404, 'La cita no existe.');
  const body = await readJson<{ amount: number; method?: string; paid_at?: string; note?: string }>(req);
  const amount = num(body.amount, 'monto', { min: 0.01, max: 10_000_000 });
  const method = str(body.method, 40) || 'Transferencia';
  const paidAt = isoDate(body.paid_at || nowIso(), 'fecha de pago');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO payments (appointment_id, amount, method, paid_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      id,
      amount,
      method,
      paidAt,
      str(body.note, 500),
      nowIso(),
    ),
    historyStmt(env, id, 'Abono registrado', `${amount} ${appt.currency} · ${method}`),
  ]);
  return json(await fetchAppointment(env, id), 201);
}

export async function deletePayment({ env, params }: Ctx) {
  const id = Number(params.id);
  const p = await env.DB.prepare('SELECT appointment_id, amount, method FROM payments WHERE id = ?')
    .bind(id)
    .first<{ appointment_id: number; amount: number; method: string }>();
  if (!p) throw new HttpError(404, 'El pago no existe.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(id),
    historyStmt(env, p.appointment_id, 'Abono eliminado', `${p.amount} · ${p.method}`),
  ]);
  return json(await fetchAppointment(env, p.appointment_id));
}

export async function listPayments({ env, url }: Ctx) {
  const where: string[] = [];
  const binds: unknown[] = [];
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from) {
    where.push('p.paid_at >= ?');
    binds.push(isoDate(from, 'from'));
  }
  if (to) {
    where.push('p.paid_at < ?');
    binds.push(isoDate(to, 'to'));
  }
  const { results } = await env.DB.prepare(
    `SELECT p.*, a.client_name, a.currency, a.start_at FROM payments p JOIN appointments a ON a.id = p.appointment_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.paid_at DESC, p.id DESC LIMIT 500`,
  )
    .bind(...binds)
    .all();
  return json(results);
}
