import { useSettings } from '../lib/settings';
import { cx, Select } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Selector de hora que respeta el formato elegido en Configuración (12 h con AM/PM o 24 h),
 * independiente del idioma del iPhone. Valor en formato HH:mm (24 h).
 */
export function TimePicker({
  value,
  onChange,
  step = 5,
  className,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  step?: number;
  className?: string;
  id?: string;
}) {
  const { time_format } = useSettings();
  const [h, m] = (value || '09:00').split(':').map(Number);
  const minutes = Array.from({ length: 60 / step }, (_, i) => i * step);
  if (!minutes.includes(m)) minutes.push(m), minutes.sort((a, b) => a - b);

  const set = (hh: number, mm: number) => onChange(`${pad(hh)}:${pad(mm)}`);

  if (time_format === '24h') {
    return (
      <div className={cx('flex items-center gap-2', className)}>
        <Select id={id} aria-label="Hora" value={h} onChange={(e) => set(Number(e.target.value), m)} className="flex-1">
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>
              {pad(i)}
            </option>
          ))}
        </Select>
        <span className="font-bold text-plum-500">:</span>
        <Select aria-label="Minutos" value={m} onChange={(e) => set(h, Number(e.target.value))} className="flex-1">
          {minutes.map((mm) => (
            <option key={mm} value={mm}>
              {pad(mm)}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  const isPm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const from12 = (hh12: number, pm: boolean) => (hh12 % 12) + (pm ? 12 : 0);

  return (
    <div className={cx('flex items-center gap-2', className)}>
      <Select id={id} aria-label="Hora" value={h12} onChange={(e) => set(from12(Number(e.target.value), isPm), m)} className="flex-1 px-3">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </Select>
      <span className="font-bold text-plum-500">:</span>
      <Select aria-label="Minutos" value={m} onChange={(e) => set(h, Number(e.target.value))} className="flex-1 px-3">
        {minutes.map((mm) => (
          <option key={mm} value={mm}>
            {pad(mm)}
          </option>
        ))}
      </Select>
      <div className="flex shrink-0 rounded-2xl bg-lavender-100 p-1">
        {(['AM', 'PM'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => set(from12(h12, p === 'PM'), m)}
            className={cx(
              'min-h-10 rounded-xl px-3 text-sm font-bold transition',
              (p === 'PM') === isPm ? 'bg-white text-plum-700 shadow-soft' : 'text-plum-500',
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
