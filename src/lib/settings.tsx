import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import {
  formatDateLong,
  formatDateShort,
  formatTime,
  todayYmd,
  toHm,
  toYmd,
  zonedToUtc,
} from '../../shared/time';
import type { Settings } from '../../shared/types';
import { get } from './api';

export const FALLBACK_SETTINGS: Settings = {
  timezone: 'America/Monterrey',
  time_format: '12h',
  default_currency: 'MXN',
  default_duration_min: 60,
  reminder_offsets: [1440, 60, 15],
  overdue_reminder: true,
  overdue_after_min: 15,
  daily_summary: true,
  daily_summary_time: '08:00',
  business_name: 'AstroBloomx',
  logo: null,
  payment_methods: ['Transferencia', 'Efectivo', 'Depósito', 'Tarjeta', 'PayPal', 'Mercado Pago', 'Otro'],
  week_starts_monday: true,
  calendar_start_hour: 7,
  calendar_end_hour: 23,
};

export function useSettingsQuery(enabled = true) {
  return useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings'), enabled, staleTime: 5 * 60_000 });
}

const Ctx = createContext<Settings>(FALLBACK_SETTINGS);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data } = useSettingsQuery();
  return <Ctx.Provider value={data ?? FALLBACK_SETTINGS}>{children}</Ctx.Provider>;
}

export function useSettings() {
  return useContext(Ctx);
}

/** Funciones de formato ligadas a la zona horaria y formato de hora configurados. */
export function useFmt() {
  const s = useSettings();
  const tz = s.timezone;
  const use24 = s.time_format === '24h';
  return {
    tz,
    use24,
    time: (d: string | Date) => formatTime(d, tz, use24),
    range: (a: string, b: string) => `${formatTime(a, tz, use24)} – ${formatTime(b, tz, use24)}`,
    dateShort: (d: string | Date) => formatDateShort(d, tz),
    dateLong: (d: string | Date) => formatDateLong(d, tz),
    ymd: (d: string | Date) => toYmd(d, tz),
    hm: (d: string | Date) => toHm(d, tz),
    today: () => todayYmd(tz),
    toUtc: (ymd: string, hm: string) => zonedToUtc(ymd, hm, tz),
  };
}
