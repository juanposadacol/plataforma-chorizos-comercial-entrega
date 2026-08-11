import { describe, expect, it } from 'vitest';
import { mapProduct } from './catalogApi';
import { demoProducts } from '../../data/demoCatalog';

// El fallo reportado: los tres chorizos mostraban la misma fotografía.
//
// No compartían la imagen: ninguno tenía. El panel guardaba la URL en
// `products.image_url` y la tienda leía `products.main_image_url`, así que el
// catálogo recibía null y `mapProduct` caía en un respaldo fijo apuntado a la
// foto del Santa Rosano. Los tres terminaban con esa foto.

const FILA_BASE = {
  id: 'p-1',
  sku: 'CHO-AR-500',
  slug: 'argentino',
  name: 'Argentino',
  public_price: 17300,
  effective_price: 17300,
  stock_available: 10,
};

describe('la imagen viaja con el producto, no con su posición', () => {
  it('cada fila conserva su propia imagen', () => {
    expect(mapProduct({ ...FILA_BASE, image_url: '/assets/argentino.png' }).image_url).toBe(
      '/assets/argentino.png',
    );
    expect(
      mapProduct({
        ...FILA_BASE,
        slug: 'jalapeno',
        name: 'Jalapeño',
        image_url: '/assets/jalapeno.png',
      }).image_url,
    ).toBe('/assets/jalapeno.png');
  });

  // La regresión exacta: sin imagen NO se toma prestada la de otro producto.
  it('un producto sin imagen no hereda la fotografía del Santa Rosano', () => {
    const sinImagen = mapProduct(FILA_BASE);

    expect(sinImagen.image_url).toBe('');
    expect(sinImagen.image_url).not.toContain('santa-rosano');
  });

  it('el orden del catálogo no decide la imagen', () => {
    const filas = [
      { ...FILA_BASE, id: 'a', slug: 'jalapeno', image_url: '/assets/jalapeno.png' },
      { ...FILA_BASE, id: 'b', slug: 'santa-rosano', image_url: '/assets/santa-rosano.png' },
      { ...FILA_BASE, id: 'c', slug: 'argentino', image_url: '/assets/argentino.png' },
    ];

    // Al invertir el catálogo, cada producto se lleva su imagen consigo.
    const directo = filas.map(mapProduct);
    const invertido = [...filas].reverse().map(mapProduct);

    for (const producto of directo) {
      const mismo = invertido.find((otro) => otro.slug === producto.slug);
      expect(mismo?.image_url).toBe(producto.image_url);
    }
  });
});

describe('el catálogo publicado', () => {
  it('los tres chorizos tienen fotografías distintas', () => {
    const imagenes = demoProducts.map((producto) => producto.image_url);

    expect(imagenes).toHaveLength(3);
    expect(new Set(imagenes).size).toBe(3);
    expect(imagenes.every(Boolean)).toBe(true);
  });

  it('cada chorizo apunta al archivo que le corresponde por slug', () => {
    const porSlug = new Map(demoProducts.map((p) => [p.slug, p.image_url]));

    expect(porSlug.get('argentino')).toBe('/assets/argentino.png');
    expect(porSlug.get('jalapeno')).toBe('/assets/jalapeno.png');
    expect(porSlug.get('santa-rosano')).toBe('/assets/santa-rosano.png');
  });
});
