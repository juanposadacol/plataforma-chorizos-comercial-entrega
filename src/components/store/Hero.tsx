import { ArrowDown, ShieldCheck, Sparkles, Truck } from 'lucide-react';

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-content">
        <span className="eyebrow">
          <Sparkles aria-hidden="true" /> Sabor artesanal · pedido fácil
        </span>
        <h1 id="hero-title">
          Elige tus sabores
          <br />
          <em>y nosotros hacemos el resto</em>
        </h1>
        <p>
          Compra tus chorizos favoritos con precio confirmado, inventario real y seguimiento del
          pedido.
        </p>
        <div className="hero-tags" aria-label="Ventajas">
          <span>
            <ShieldCheck aria-hidden="true" /> Precio validado
          </span>
          <span>
            <Truck aria-hidden="true" /> Entrega coordinada
          </span>
          <span>
            <Sparkles aria-hidden="true" /> Receta artesanal
          </span>
        </div>
        <a className="hero-link" href="#catalogo">
          Ver sabores <ArrowDown aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
