import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, LoaderCircle, MapPin, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { checkoutSchema, type CheckoutFormValues } from '../../features/orders/checkoutSchema';
import { localDateInBogota } from '../../lib/format';
import type { SelectOption } from '../../types/domain';
import { DeliverySelector } from './DeliverySelector';
import { PaymentMethodSelector } from './PaymentMethodSelector';

interface CheckoutFormProps {
  disabled: boolean;
  busy: boolean;
  error: string;
  paymentMethods: SelectOption[];
  deliveryMethods: SelectOption[];
  onSubmit: (values: CheckoutFormValues) => Promise<void>;
}

export function CheckoutForm({
  disabled,
  busy,
  error,
  paymentMethods,
  deliveryMethods,
  onSubmit,
}: CheckoutFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      customerName: '',
      customerPhone: '',
      address: '',
      neighborhood: '',
      municipality: '',
      requestedDate: localDateInBogota(1),
      notes: '',
      privacyAccepted: false,
    },
  });

  useEffect(() => {
    if (deliveryMethods[0]) setValue('deliveryMethodId', deliveryMethods[0].id);
    if (paymentMethods[0]) setValue('paymentMethodId', paymentMethods[0].id);
  }, [deliveryMethods, paymentMethods, setValue]);

  const fieldError = (name: keyof CheckoutFormValues) =>
    errors[name] ? (
      <span id={`${name}-error`} className="field-error" role="alert">
        {errors[name]?.message}
      </span>
    ) : null;
  return (
    <form
      className="checkout-form card"
      id="datos-entrega"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div className="card-title">
        <span>1</span>
        <div>
          <p className="eyebrow eyebrow--wine">Datos del pedido</p>
          <h2>¿Dónde lo entregamos?</h2>
          <p>El total definitivo siempre será validado por el servidor.</p>
        </div>
      </div>
      <section className="form-section" aria-labelledby="customer-section">
        <h3 id="customer-section">
          <UserRound aria-hidden="true" /> Tus datos
        </h3>
        <div className="form-grid">
          <label>
            Nombre completo
            <input
              autoComplete="name"
              {...register('customerName')}
              aria-invalid={Boolean(errors.customerName)}
              aria-describedby={errors.customerName ? 'customerName-error' : undefined}
              placeholder="Ej. María Gómez"
            />
            {fieldError('customerName')}
          </label>
          <label>
            Celular
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              {...register('customerPhone')}
              aria-invalid={Boolean(errors.customerPhone)}
              aria-describedby={errors.customerPhone ? 'customerPhone-error' : undefined}
              placeholder="300 123 4567"
            />
            {fieldError('customerPhone')}
          </label>
        </div>
      </section>
      <section className="form-section" aria-labelledby="address-section">
        <h3 id="address-section">
          <MapPin aria-hidden="true" /> Dirección de entrega
        </h3>
        <div className="form-grid">
          <label className="full">
            Dirección o punto de encuentro
            <input
              autoComplete="street-address"
              {...register('address')}
              aria-invalid={Boolean(errors.address)}
              aria-describedby={errors.address ? 'address-error' : undefined}
              placeholder="Calle, carrera, número y referencias"
            />
            {fieldError('address')}
          </label>
          <label>
            Barrio o sector
            <input
              {...register('neighborhood')}
              aria-invalid={Boolean(errors.neighborhood)}
              aria-describedby={errors.neighborhood ? 'neighborhood-error' : undefined}
              placeholder="Ej. El Centro"
            />
            {fieldError('neighborhood')}
          </label>
          <label>
            Municipio
            <input
              {...register('municipality')}
              aria-invalid={Boolean(errors.municipality)}
              aria-describedby={errors.municipality ? 'municipality-error' : undefined}
              placeholder="Ej. Pasto"
            />
            {fieldError('municipality')}
          </label>
        </div>
      </section>
      <DeliverySelector
        options={deliveryMethods}
        register={register}
        error={errors.deliveryMethodId}
      />
      <PaymentMethodSelector
        options={paymentMethods}
        register={register}
        error={errors.paymentMethodId}
      />
      <section className="form-section">
        <h3>
          <CalendarDays aria-hidden="true" /> Fecha y observaciones
        </h3>
        <div className="form-grid">
          <label>
            Fecha solicitada
            <input
              type="date"
              min={localDateInBogota()}
              {...register('requestedDate')}
              aria-invalid={Boolean(errors.requestedDate)}
            />
            {fieldError('requestedDate')}
          </label>
          <label className="full">
            Observaciones <span>(opcional)</span>
            <textarea
              rows={3}
              {...register('notes')}
              placeholder="Ej. Entregar después de las 4:00 p. m."
            />
            {fieldError('notes')}
          </label>
        </div>
      </section>
      <label className="privacy-check">
        <input type="checkbox" {...register('privacyAccepted')} />
        <span>
          Acepto el tratamiento de mis datos para gestionar este pedido.{' '}
          <a href="/privacidad" target="_blank">
            Ver política
          </a>
          .
        </span>
      </label>
      {fieldError('privacyAccepted')}
      {error && (
        <div className="form-submit-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary-button checkout-submit" type="submit" disabled={disabled || busy}>
        {busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}{' '}
        {busy ? 'Confirmando con el servidor…' : 'Confirmar pedido seguro'}
      </button>
      <p className="secure-note">
        <ShieldCheck aria-hidden="true" /> No enviamos precios desde tu navegador. El servidor
        recalcula y reserva inventario antes de confirmar.
      </p>
    </form>
  );
}
