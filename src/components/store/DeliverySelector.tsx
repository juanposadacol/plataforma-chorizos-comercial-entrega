import { Bike, Store } from 'lucide-react';
import type { FieldError, UseFormRegister } from 'react-hook-form';
import type { CheckoutFormValues } from '../../features/orders/checkoutSchema';
import { formatMoney } from '../../lib/format';
import type { SelectOption } from '../../types/domain';

export function DeliverySelector({
  options,
  register,
  error,
}: {
  options: SelectOption[];
  register: UseFormRegister<CheckoutFormValues>;
  error?: FieldError;
}) {
  return (
    <fieldset className="option-fieldset" aria-describedby={error ? 'delivery-error' : undefined}>
      <legend>Forma de entrega</legend>
      <div className="option-grid">
        {options.map((option, index) => (
          <label className="choice-card" key={option.id}>
            <input type="radio" value={option.id} {...register('deliveryMethodId')} />
            {index === 0 ? <Bike aria-hidden="true" /> : <Store aria-hidden="true" />}
            <span>
              <strong>{option.name}</strong>
              <small>
                {option.fee
                  ? `Desde ${formatMoney(option.fee)}`
                  : option.description || 'Sin costo configurado'}
              </small>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <span className="field-error" id="delivery-error" role="alert">
          {error.message}
        </span>
      )}
    </fieldset>
  );
}
