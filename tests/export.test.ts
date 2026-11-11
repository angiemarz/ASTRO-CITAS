import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx, toRows, totalsByCurrency } from '../src/lib/exportAppointments';
import type { Appointment } from '../shared/types';

const fmt = { ymd: (i: string) => i.slice(0, 10), time: (i: string) => i.slice(11, 16), today: () => '2026-11-11' };
const appt = (over: Partial<Appointment> = {}) =>
  ({
    id: 1, client_name: 'Ana & "Luz" <3', contact_value: '555', start_at: '2026-11-12T15:00:00Z', end_at: '2026-11-12T16:00:00Z',
    platform: 'whatsapp', status: 'confirmed', currency: 'MXN', original_price: 360, discount: 72, final_price: 288, paid_total: 100, balance: 188,
    payment_status: 'partial', notes: 'línea 1\nlínea 2', ritual_topic: null,
    services: [{ name: 'Ritual 11:11', intention: 'Salud' }], promotions: [{ name: 'Paquete' }], ...over,
  }) as unknown as Appointment;

describe('exportar citas', () => {
  it('arma filas con dinero como número y la intención', () => {
    const [r] = toRows([appt()], fmt);
    expect(r[6]).toBe('Salud');
    expect(r[13]).toBe(288);
    expect(typeof r[15]).toBe('number');
  });
  it('genera un .xlsx válido con texto escapado y encabezado', () => {
    const files = unzipSync(buildXlsx([appt()], fmt));
    expect(Object.keys(files).sort()).toContain('xl/worksheets/sheet1.xml');
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('Ana &amp; &quot;Luz&quot; &lt;3');
    expect(sheet).toContain('<v>288</v>');
    expect(sheet).toContain('autoFilter');
  });
  it('los totales no incluyen canceladas', () => {
    const t = totalsByCurrency([appt(), appt({ id: 2, status: 'cancelled' })]);
    expect(t.MXN).toEqual({ total: 288, paid: 100, balance: 188 });
  });
});
