import { Minus, Plus } from 'lucide-react';

interface QuantitySelectorProps {
  name: string;
  value: number;
  maximum?: number;
  onIncrement: () => void;
  onDecrement: () => void;
}

export function QuantitySelector({
  name,
  value,
  maximum = 999,
  onIncrement,
  onDecrement,
}: QuantitySelectorProps) {
  return (
    <div className="qty" aria-label={`Cantidad de ${name}`}>
      <button
        type="button"
        onClick={onDecrement}
        disabled={value === 0}
        aria-label={`Quitar un paquete de ${name}`}
      >
        <Minus aria-hidden="true" />
      </button>
      <output aria-live="polite" aria-label={`${value} paquetes de ${name}`}>
        {value}
      </output>
      <button
        type="button"
        onClick={onIncrement}
        disabled={value >= maximum}
        aria-label={`Agregar un paquete de ${name}`}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
