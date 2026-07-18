import { Banknote, CreditCard, Smartphone } from 'lucide-react';
import type { FieldError, UseFormRegister } from 'react-hook-form';
import type { CheckoutFormValues } from '../../features/orders/checkoutSchema';
import type { SelectOption } from '../../types/domain';

export function PaymentMethodSelector({
  options,
  register,
  error,
}: {
  options: SelectOption[];
  register: UseFormRegister<CheckoutFormValues>;
  error?: FieldError;
}) {
  const icons = [Banknote, Smartphone, CreditCard];
  return (
    <fieldset className="option-fieldset" aria-describedby={error ? 'payment-error' : undefined}>
      <legend>Forma de pago</legend>
      <div className="option-grid option-grid--three">
        {options.map((option, index) => {
          const Icon = icons[index % icons.length] ?? Banknote;
          return (
            <label className="choice-card choice-card--compact" key={option.id}>
              <input type="radio" value={option.id} {...register('paymentMethodId')} />
              <Icon aria-hidden="true" />
              <span>
                <strong>{option.name}</strong>
                <small>{option.description || 'Disponible'}</small>
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <span className="field-error" id="payment-error" role="alert">
          {error.message}
        </span>
      )}
    </fieldset>
  );
}
