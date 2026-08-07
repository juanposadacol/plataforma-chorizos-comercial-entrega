import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, LoaderCircle, MapPin, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useAuth } from '../../features/auth/AuthContext';
import { loadCustomerProfile, type CustomerProfile } from '../../features/orders/customerProfile';
import { checkoutSchema, type CheckoutFormValues } from '../../features/orders/checkoutSchema';
import { localDateInBogota } from '../../lib/format';
import type { SelectOption } from '../../types/domain';
import { DeliverySelector } from './DeliverySelector';
import { PaymentMethodSelector } from './PaymentMethodSelector';

/** Campos que se llenan solos cuando el celular corresponde a un cliente conocido. */
const AUTOFILL_FIELDS = ['customerName', 'address', 'neighborhood', 'municipality'] as const;
type AutofillField = (typeof AUTOFILL_FIELDS)[number];

const isCompletePhone = (value: string): boolean =>
  /^(?:\+?57)?3\d{9}$/.test(value.replace(/[\s()-]/g, ''));

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
  const { user, access } = useAuth();
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    control,
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
    },
  });

  useEffect(() => {
    if (deliveryMethods[0]) setValue('deliveryMethodId', deliveryMethods[0].id);
    if (paymentMethods[0]) setValue('paymentMethodId', paymentMethods[0].id);
  }, [deliveryMethods, paymentMethods, setValue]);

  const phone = useWatch({ control, name: 'customerPhone' });
  const [autofillNotice, setAutofillNotice] = useState('');
  // Recuerda qué escribió la autocarga para poder reemplazarlo si cambia el
  // celular, sin pisar nunca lo que el cliente haya escrito a mano.
  const autofilled = useRef<Partial<Record<AutofillField, string>>>({});

  useEffect(() => {
    const complete = isCompletePhone(phone ?? '');
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!complete) {
        setAutofillNotice('');
        return;
      }
      void loadCustomerProfile(phone, Boolean(user), access.isStaff).then(
        (profile: CustomerProfile | null) => {
          if (cancelled) return;
          if (!profile) {
            setAutofillNotice('');
            return;
          }
          const values: Record<AutofillField, string> = {
            customerName: profile.name,
            address: profile.address,
            neighborhood: profile.neighborhood,
            municipality: profile.municipality,
          };
          let filled = 0;
          AUTOFILL_FIELDS.forEach((field) => {
            const next = values[field];
            const current = String(getValues(field) ?? '');
            const editedByCustomer = current !== '' && current !== autofilled.current[field];
            if (!next || editedByCustomer) return;
            setValue(field, next, { shouldValidate: true });
            autofilled.current[field] = next;
            filled += 1;
          });
          if (filled)
            setAutofillNotice('Cargamos los datos guardados. Revísalos antes de confirmar.');
        },
      );
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phone, user, access.isStaff, getValues, setValue]);

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
            Celular
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              autoFocus
              {...register('customerPhone')}
              aria-invalid={Boolean(errors.customerPhone)}
              aria-describedby={errors.customerPhone ? 'customerPhone-error' : undefined}
              placeholder="300 123 4567"
            />
            {fieldError('customerPhone')}
          </label>
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
        </div>
        {autofillNotice && (
          <p className="autofill-notice" role="status">
            {autofillNotice}
          </p>
        )}
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
