import { formatMoney, usdEquivalent } from '../../shared/domain';
import { useSettings } from '../lib/settings';
import { cx } from './ui';

/** Equivalente en dólares ("≈ $5.55 USD") calculado con el tipo de cambio configurado, o null si aún no hay. */
export function useUsd() {
  const { usd_rate } = useSettings();
  return (mxn: number) => usdEquivalent(mxn, usd_rate);
}

/**
 * Precio en pesos con su equivalente en dólares debajo, en texto discreto.
 * Los precios se guardan en MXN; el USD se calcula al mostrarlo (ya con descuentos aplicados).
 * Si el monto está en USD se muestra tal cual.
 */
export function Money({
  amount,
  currency = 'MXN',
  className,
  usdClassName,
  inline,
  strike,
  right,
}: {
  amount: number;
  currency?: string;
  className?: string;
  usdClassName?: string;
  /** El equivalente va al lado en lugar de debajo. */
  inline?: boolean;
  strike?: boolean;
  /** Alinea el monto y el equivalente a la derecha. */
  right?: boolean;
}) {
  const usd = useUsd();
  const eq = currency === 'MXN' ? usd(amount) : null;
  return (
    <span className={cx(inline ? 'inline-flex items-baseline gap-1.5' : cx('inline-flex flex-col', right && 'items-end text-right'), strike && 'line-through')}>
      <span className={className}>{formatMoney(amount, currency)}</span>
      {eq && <span className={cx('text-[0.72em] leading-tight font-semibold text-plum-400 no-underline', usdClassName)}>{eq}</span>}
    </span>
  );
}
