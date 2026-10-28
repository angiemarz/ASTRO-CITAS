import { describe, expect, it } from 'vitest';
import { fromCalcom, fromGeneric, parseWhen, to24h } from '../worker/routes/hooks';

const TZ = 'America/Monterrey';

describe('fechas de integraciones', () => {
  it('convierte horas de 12 h a 24 h', () => {
    expect(to24h('3:30 PM')).toBe('15:30');
    expect(to24h('12 am')).toBe('00:00');
    expect(to24h('9:05')).toBe('09:05');
    expect(to24h('25:00')).toBeNull();
  });
  it('acepta ISO con zona, sin zona y fecha + hora separadas', () => {
    expect(parseWhen('2026-11-05T16:00:00-06:00', TZ)!.toISOString()).toBe('2026-11-05T22:00:00.000Z');
    expect(parseWhen('2026-11-05T16:00', TZ)!.toISOString()).toBe('2026-11-05T22:00:00.000Z');
    expect(parseWhen('2026-11-05', TZ, '4:00 PM')!.toISOString()).toBe('2026-11-05T22:00:00.000Z');
    expect(parseWhen('no es fecha', TZ)).toBeNull();
  });
});

describe('Cal.com', () => {
  const base = {
    payload: {
      uid: 'abc123',
      eventTitle: 'Lectura de tarot general',
      startTime: '2026-11-05T22:00:00Z',
      endTime: '2026-11-05T23:00:00Z',
      attendees: [{ name: 'María López', email: 'maria@correo.com' }],
      responses: { name: { value: 'María López' }, attendeePhoneNumber: { value: '+52 81 1234 5678' } },
      location: 'integrations:google:meet',
      videoCallData: { url: 'https://meet.google.com/xyz' },
    },
  };
  it('PING de prueba', () => {
    expect(fromCalcom({ triggerEvent: 'PING' }, TZ)).toBe('ping');
  });
  it('reserva creada', () => {
    const b = fromCalcom({ triggerEvent: 'BOOKING_CREATED', ...base }, TZ);
    expect(b).toMatchObject({
      event: 'created',
      source: 'calcom',
      external_id: 'abc123',
      client_name: 'María López',
      phone: '+52 81 1234 5678',
      email: 'maria@correo.com',
      platform: 'video',
      contact: 'https://meet.google.com/xyz',
      services: ['Lectura de tarot general'],
    });
  });
  it('reprogramación conserva el identificador anterior', () => {
    const b = fromCalcom({ triggerEvent: 'BOOKING_RESCHEDULED', payload: { ...base.payload, uid: 'nuevo', rescheduleUid: 'abc123' } }, TZ);
    expect(b).toMatchObject({ event: 'rescheduled', external_id: 'nuevo', previous_external_id: 'abc123' });
  });
  it('eventos no usados se ignoran', () => {
    expect(fromCalcom({ triggerEvent: 'MEETING_ENDED', payload: {} }, TZ)).toBeNull();
  });
});

describe('formato genérico (Make / Canva)', () => {
  it('acepta campos en español y varios servicios', () => {
    const b = fromGeneric({ nombre: 'Ana', fecha: '2026-11-05', hora: '10:00 AM', servicio: 'Tarot + Carta astral', telefono: '8112345678', precio: '900' }, TZ);
    expect(b.client_name).toBe('Ana');
    expect(b.start.toISOString()).toBe('2026-11-05T16:00:00.000Z');
    expect(b.services).toEqual(['Tarot', 'Carta astral']);
    expect(b.price).toBe(900);
    expect(b.platform).toBe('whatsapp');
  });
  it('exige external_id para cancelar', () => {
    expect(() => fromGeneric({ event: 'cancelled' }, TZ)).toThrow();
  });
  it('exige fecha para crear', () => {
    expect(() => fromGeneric({ client_name: 'Ana' }, TZ)).toThrow();
  });
});

describe('Cal.com con datos de la página de Canva (metadata)', () => {
  it('toma servicios, total, ubicación y número de cita', () => {
    const b = fromCalcom(
      {
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          uid: 'm1',
          eventTitle: 'Cita AstroBloomx',
          startTime: '2026-11-05T02:00:00Z',
          attendees: [{ name: 'Sofía' }],
          responses: { name: { value: 'Sofía' }, attendeePhoneNumber: { value: '6181234567' } },
          metadata: { servicios: 'Lectura general | Revolución solar | Mini numerología', total: '579.50', ubicacion: 'Madrid, España', cita: '1 de 2' },
        },
      },
      TZ,
    );
    expect(b).toMatchObject({
      services: ['Lectura general', 'Revolución solar', 'Mini numerología'],
      price: 579.5,
      platform: 'whatsapp',
    });
    expect((b as { notes: string }).notes).toContain('Vive en: Madrid, España');
    expect((b as { notes: string }).notes).toContain('Cita 1 de 2');
  });
});

describe('paquetes de 2 citas', () => {
  it('la segunda sesión queda en $0', () => {
    const b = fromCalcom(
      { triggerEvent: 'BOOKING_CREATED', payload: { uid: 'm2', startTime: '2026-11-06T02:00:00Z', attendees: [{ name: 'Sofía' }], metadata: { servicios: 'TAROT Y ASTROLOGÍA', total: '690', cita: '2 de 2' } } },
      TZ,
    );
    expect((b as { price: number }).price).toBe(0);
  });
});

import { fromCalcomApi } from '../worker/calcom';

describe('reservas de la API v2 de Cal.com (sincronización)', () => {
  it('convierte una reserva aceptada', () => {
    const b = fromCalcomApi(
      {
        uid: 'api-1',
        start: '2026-11-12T02:00:00.000Z',
        end: '2026-11-12T03:00:00.000Z',
        status: 'accepted',
        attendees: [{ name: 'Elena', email: 'e@x.com' }],
        bookingFieldsResponses: { name: 'Elena', attendeePhoneNumber: '+52 618 000 1111' },
        metadata: { servicios: 'Lectura general | Revolución solar', total: '475', ubicacion: 'Lima' },
      },
      TZ,
    );
    expect(b).toMatchObject({ event: 'created', external_id: 'api-1', client_name: 'Elena', price: 475, platform: 'whatsapp', services: ['Lectura general', 'Revolución solar'] });
  });
  it('cancelada → cancelled, y la reserva vieja de una reprogramación se ignora', () => {
    expect(fromCalcomApi({ uid: 'x', start: '2026-11-12T02:00:00Z', status: 'cancelled' }, TZ)?.event).toBe('cancelled');
    expect(fromCalcomApi({ uid: 'old', start: '2026-11-12T02:00:00Z', status: 'cancelled', rescheduled: true }, TZ)).toBeNull();
  });
});

import { bookingList } from '../worker/calcom';

describe('respuestas de la API de Cal.com', () => {
  it('acepta las distintas formas de la lista de reservas', () => {
    const b = [{ uid: 'a' }];
    expect(bookingList({ status: 'success', data: b })).toEqual(b);
    expect(bookingList({ data: { bookings: b } })).toEqual(b);
    expect(bookingList({ bookings: b })).toEqual(b);
    expect(bookingList(null)).toEqual([]);
  });
  it('acepta startTime/endTime (formato anterior)', () => {
    const r = fromCalcomApi({ uid: 'old-format', startTime: '2026-11-12T02:00:00Z', endTime: '2026-11-12T03:00:00Z', status: 'ACCEPTED', attendees: [{ name: 'Iris' }] }, TZ);
    expect(r).toMatchObject({ event: 'created', client_name: 'Iris' });
  });
});

describe('ubicación "Número de teléfono del asistente"', () => {
  it('el número en la ubicación se toma como WhatsApp y teléfono de la clienta', () => {
    const b = fromCalcom(
      {
        triggerEvent: 'BOOKING_CREATED',
        payload: { uid: 'tel-1', startTime: '2026-11-05T02:00:00Z', attendees: [{ name: 'Rosa' }], responses: { name: { value: 'Rosa' }, location: { value: { type: 'phone', optionValue: '+52 618 555 0101' } } }, location: '+52 618 555 0101' },
      },
      TZ,
    );
    expect(b).toMatchObject({ platform: 'whatsapp', contact: '+52 618 555 0101', phone: '+52 618 555 0101' });
  });
});

import { attendeeEmail, parseEventUrl } from '../worker/calcom';

describe('crear en Cal.com las citas de la agenda', () => {
  it('interpreta el enlace del evento', () => {
    expect(parseEventUrl('https://cal.com/astrobloomx-citas/cita-astrobloomx')).toEqual({ username: 'astrobloomx-citas', eventTypeSlug: 'cita-astrobloomx' });
    expect(parseEventUrl('https://cal.com/team/astro/cita')).toEqual({ teamSlug: 'astro', eventTypeSlug: 'cita' });
    expect(parseEventUrl('https://cal.com/solo-usuario')).toBeNull();
    expect(parseEventUrl(null)).toBeNull();
  });
  it('arma un correo alias por cita en Gmail', () => {
    expect(attendeeEmail('mailto:marz.anibarmar@gmail.com', 12)).toBe('marz.anibarmar+cita12@gmail.com');
    expect(attendeeEmail('yo+algo@gmail.com', 3)).toBe('yo+cita3@gmail.com');
    expect(attendeeEmail('hola@astrobloomx.com', 3)).toBe('hola@astrobloomx.com');
    expect(attendeeEmail('', 3)).toBeNull();
  });
});
