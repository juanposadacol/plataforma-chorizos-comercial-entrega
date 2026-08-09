import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, DatabaseZap, Info, ShoppingBasket } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckoutForm } from '../components/store/CheckoutForm';
import { Header } from '../components/store/Header';
import { Hero } from '../components/store/Hero';
import { MobileOrderBar } from '../components/store/MobileOrderBar';
import { CatalogFilters, ProductGrid } from '../components/store/ProductGrid';
import { CartSummary } from '../components/store/CartSummary';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import { useAuth } from '../features/auth/AuthContext';
import { useCart } from '../features/cart/CartContext';
import { buildPackNote, mergeLinesByProduct } from '../domain/packs';
import { getCatalog, getCheckoutOptions, getPublicSettings } from '../features/catalog/catalogApi';
import type { CheckoutFormValues } from '../features/orders/checkoutSchema';
import { saveLocalProfile } from '../features/orders/customerProfile';
import { createOrder } from '../features/orders/orderApi';
import { env, isSupabaseConfigured } from '../lib/env';
import { getErrorMessage } from '../lib/errors';
import { normalizeColombianPhone } from '../lib/format';

export function StorefrontPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const {
    lines,
    selectedPack,
    units,
    quantityOf,
    linesOfProduct,
    increment,
    decrement,
    selectPackSize,
    removeLine,
    clear,
  } = useCart();
  const [category, setCategory] = useState('Todos');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  /**
   * Cliente reconocido por el celular escrito en el checkout. Mientras esté
   * puesto, el catálogo muestra SU precio: el acordado se ve al elegir, no
   * después de confirmar.
   */
  const [buyer, setBuyer] = useState<{ phone: string; name: string } | null>(null);
  const onPhoneIdentified = useCallback((identity: { phone: string; name: string } | null) => {
    setBuyer((current) => {
      if (!identity) return current === null ? current : null;
      if (current && current.phone === identity.phone && current.name === identity.name)
        return current;
      return identity;
    });
  }, []);

  const settings = useQuery({ queryKey: ['public-settings'], queryFn: getPublicSettings });
  const catalog = useQuery({
    queryKey: ['catalog', buyer?.phone ?? user?.id ?? 'public'],
    queryFn: () => getCatalog(buyer?.phone),
    // Conserva los precios anteriores mientras llegan los del cliente, para que
    // el catálogo no parpadee al escribir el celular.
    placeholderData: (previous) => previous,
  });
  const checkoutOptions = useQuery({ queryKey: ['checkout-options'], queryFn: getCheckoutOptions });
  const products = useMemo(() => catalog.data ?? [], [catalog.data]);
  const categories = useMemo(
    () => [...new Set(products.map((item) => item.category_name).filter(Boolean))],
    [products],
  );
  const filtered = useMemo(
    () => products.filter((item) => category === 'Todos' || item.category_name === category),
    [products, category],
  );
  const priceById = useMemo(
    () => new Map(products.map((product) => [product.id, product.effective_price])),
    [products],
  );
  // ¿El servidor devolvió algún precio distinto del público para este comprador?
  const hasAgreedPrice = products.some(
    (product) => product.price_source && product.price_source !== 'public',
  );
  const estimatedTotal = lines.reduce(
    (sum, line) => sum + line.quantity * (priceById.get(line.productId) ?? 0),
    0,
  );

  const submit = async (values: CheckoutFormValues) => {
    // Una línea por producto para el pedido: precio e inventario son por
    // producto, aunque el carrito separe las presentaciones.
    const items = mergeLinesByProduct(lines);
    if (!items.length) {
      setSubmitError('Agrega al menos un producto.');
      return;
    }
    // La presentación (3, 4, 6 o 10 unidades) no cambia precio ni inventario:
    // viaja con el pedido para que el negocio sepa cómo empacar cada línea.
    const packNote = buildPackNote(
      lines.map((line) => ({
        name: products.find((product) => product.id === line.productId)?.name ?? 'Producto',
        quantity: line.quantity,
        packSize: line.packSize,
      })),
    );
    const notes = [packNote, values.notes.trim()].filter(Boolean).join('\n').slice(0, 1000);
    setSubmitting(true);
    setSubmitError('');
    try {
      const order = await createOrder({
        idempotency_key: crypto.randomUUID(),
        customer: {
          name: values.customerName,
          phone: normalizeColombianPhone(values.customerPhone),
          // Con correo, el servidor encola el mensaje de confirmación; sin él, el
          // pedido se crea igual.
          email: values.customerEmail.trim() || undefined,
        },
        items,
        delivery: {
          address: values.address,
          neighborhood: values.neighborhood,
          municipality: values.municipality,
          delivery_method_id: values.deliveryMethodId,
          requested_date: values.requestedDate,
        },
        payment_method_id: values.paymentMethodId,
        notes,
      });
      // Memoria del dispositivo: la próxima vez basta con escribir el celular.
      saveLocalProfile({
        phone: normalizeColombianPhone(values.customerPhone),
        name: values.customerName.trim(),
        email: values.customerEmail.trim(),
        address: values.address.trim(),
        neighborhood: values.neighborhood.trim(),
        municipality: values.municipality.trim(),
      });
      clear();
      await queryClient.invalidateQueries({ queryKey: ['catalog'] });
      navigate('/pedido-confirmado', { state: { order } });
    } catch (error) {
      setSubmitError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Header businessName={settings.data?.businessName ?? 'Chorizos Artesanales'} />
      <main className="store-main">
        <Hero />
        {env.demoMode && (
          <div className="demo-banner" role="status">
            <Info aria-hidden="true" />
            <div>
              <strong>Presentación local</strong>
              <span>
                Los datos son demostrativos y el botón de confirmar no crea pedidos. Conecta
                Supabase para operar.
              </span>
            </div>
          </div>
        )}
        {!isSupabaseConfigured && !env.demoMode && (
          <ErrorState
            title="Falta conectar la tienda"
            message="El diseño está listo, pero el catálogo y los pedidos requieren las variables públicas de Supabase. Sigue el manual de instalación incluido con el proyecto."
          />
        )}
        <section id="catalogo" className="catalog-section" aria-labelledby="catalog-title">
          <div className="section-head">
            <div>
              <span className="eyebrow eyebrow--wine">Nuestros sabores</span>
              <h2 id="catalog-title">Arma tu pedido</h2>
              <p>El precio que ves es el que se cobra; el servidor lo confirma al comprar.</p>
            </div>
            <span className="availability-pill">
              <DatabaseZap aria-hidden="true" /> Pedidos en línea
            </span>
          </div>
          {buyer && (
            <p className="buyer-pricing-notice" role="status">
              <BadgePercent aria-hidden="true" />
              <span>
                {hasAgreedPrice ? (
                  <>
                    <strong>{buyer.name || 'Cliente registrado'}</strong>, estos son tus precios
                    acordados.
                  </>
                ) : (
                  <>
                    <strong>{buyer.name || 'Cliente registrado'}</strong>, te reconocimos: estos son
                    los precios que se te cobran.
                  </>
                )}
              </span>
            </p>
          )}
          {catalog.isLoading ? (
            <LoadingState label="Consultando sabores y precios…" />
          ) : catalog.error ? (
            <ErrorState
              message={getErrorMessage(catalog.error)}
              action={
                <button className="inline-button" onClick={() => void catalog.refetch()}>
                  Reintentar
                </button>
              }
            />
          ) : (
            <>
              <CatalogFilters
                categories={categories}
                selectedCategory={category}
                onCategory={setCategory}
              />
              <ProductGrid
                products={filtered}
                selectedPack={selectedPack}
                quantityOf={quantityOf}
                linesOfProduct={linesOfProduct}
                onIncrement={increment}
                onDecrement={decrement}
                onPackSize={selectPackSize}
                onRemoveLine={removeLine}
              />
            </>
          )}
        </section>
        <section className="checkout-section" aria-labelledby="checkout-title">
          <div className="checkout-intro">
            <ShoppingBasket aria-hidden="true" />
            <div>
              <span className="eyebrow eyebrow--wine">Finaliza tu compra</span>
              <h2 id="checkout-title">Datos claros, pedido seguro</h2>
              <p>Primero guardamos el pedido; después notificamos al negocio.</p>
            </div>
          </div>
          <div className="checkout-layout">
            <CheckoutForm
              disabled={!units || !isSupabaseConfigured}
              busy={submitting}
              error={submitError}
              paymentMethods={checkoutOptions.data?.paymentMethods ?? []}
              deliveryMethods={checkoutOptions.data?.deliveryMethods ?? []}
              onSubmit={submit}
              onPhoneIdentified={onPhoneIdentified}
            />
            <CartSummary
              products={products}
              lines={lines}
              deliveryMethod={checkoutOptions.data?.deliveryMethods[0]}
              onRemoveLine={removeLine}
            />
          </div>
        </section>
      </main>
      <footer className="store-footer">
        <div>
          <span className="brand-mark" aria-hidden="true">
            CA
          </span>
          <div>
            <strong>{settings.data?.businessName ?? 'Chorizos Artesanales'}</strong>
            <p>Sabor artesanal con gestión comercial segura.</p>
          </div>
        </div>
        <nav>
          <a href="/terminos">Términos</a>
          <a href="/privacidad">Privacidad</a>
        </nav>
      </footer>
      <MobileOrderBar units={units} total={estimatedTotal} />
    </>
  );
}
