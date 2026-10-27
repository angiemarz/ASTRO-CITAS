import { describe, expect, it } from 'vitest';
import { dayRangeUtc, formatHm, formatTime, toHm, toYmd, utcWallClockToReal, wallClockAsUtc, zonedToUtc } from '../shared/time';

describe('zonas horarias', () => {
  it('convierte hora local de Monterrey (UTC-6, sin horario de verano) a UTC', () => {
    expect(zonedToUtc('2026-10-27', '15:30', 'America/Monterrey').toISOString()).toBe('2026-10-27T21:30:00.000Z');
  });
  it('respeta el horario de verano de otras zonas', () => {
    expect(zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '09:00', 'America/New_York').toISOString()).toBe('2026-12-01T14:00:00.000Z');
  });
  it('obtiene fecha y hora locales desde UTC', () => {
    expect(toYmd('2026-10-28T03:00:00Z', 'America/Monterrey')).toBe('2026-10-27');
    expect(toHm('2026-10-28T03:00:00Z', 'America/Monterrey')).toBe('21:00');
  });
  it('calcula el rango UTC de un día local', () => {
    const r = dayRangeUtc('2026-10-27', 'America/Monterrey');
    expect(r.start.toISOString()).toBe('2026-10-27T06:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-28T06:00:00.000Z');
  });
  it('formatea en 12 y 24 horas', () => {
    expect(formatTime('2026-10-27T21:05:00Z', 'America/Monterrey', false)).toBe('3:05 PM');
    expect(formatTime('2026-10-27T21:05:00Z', 'America/Monterrey', true)).toBe('15:05');
    expect(formatHm('00:15', false)).toBe('12:15 AM');
    expect(formatHm('12:00', false)).toBe('12:00 PM');
  });
  it('ida y vuelta de hora de pared para el calendario', () => {
    const real = new Date('2026-10-27T21:30:00Z');
    const wall = wallClockAsUtc(real, 'America/Monterrey');
    expect(wall.toISOString()).toBe('2026-10-27T15:30:00.000Z');
    expect(utcWallClockToReal(wall, 'America/Monterrey').toISOString()).toBe(real.toISOString());
  });
});
