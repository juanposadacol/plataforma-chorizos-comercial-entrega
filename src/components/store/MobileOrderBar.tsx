import { ArrowUp } from 'lucide-react';
import { formatMoney } from '../../lib/format';

export function MobileOrderBar({ units, total }: { units: number; total: number }) {
  return (
    <div className="mobile-order-bar">
      <div>
        <small>
          {units} paquete{units === 1 ? '' : 's'}
        </small>
        <strong>{formatMoney(total)}</strong>
      </div>
      <a href={units ? '#datos-entrega' : '#catalogo'}>
        {units ? 'Ir a entrega' : 'Elegir'} <ArrowUp aria-hidden="true" />
      </a>
    </div>
  );
}
