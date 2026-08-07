import { PACK_SIZE_OPTIONS, type PackSize } from '../../domain/packs';

interface PackSizeSelectorProps {
  productId: string;
  productName: string;
  value: PackSize;
  onChange: (packSize: PackSize) => void;
}

export function PackSizeSelector({
  productId,
  productName,
  value,
  onChange,
}: PackSizeSelectorProps) {
  return (
    <fieldset className="pack-picker">
      <legend>Presentación</legend>
      <div className="pack-options">
        {PACK_SIZE_OPTIONS.map((size) => (
          <label className={size === value ? 'pack-option active' : 'pack-option'} key={size}>
            <input
              type="radio"
              name={`pack-${productId}`}
              value={size}
              checked={size === value}
              onChange={() => onChange(size)}
              aria-label={`${size} unidades de ${productName}`}
            />
            <strong>{size}</strong>
            <small>und</small>
          </label>
        ))}
      </div>
      <p className="pack-hint">Las cuatro presentaciones valen lo mismo.</p>
    </fieldset>
  );
}
