import { describe, expect, it } from 'vitest';
import viteConfigSource from '../vite.config.ts?raw';

// Regresión: `navigateFallback` apuntaba a '/offline.html'. Esa opción de
// Workbox no significa "pantalla a mostrar cuando no hay conexión": genera
// `registerRoute(new NavigationRoute(createHandlerBoundToURL(url)))`, una ruta
// incondicional que responde TODA petición de navegación desde el precaché, con
// o sin red. El resultado era que cualquier carga normal (URL directa, F5,
// abrir la PWA instalada) mostraba "Estás sin conexión" estando en línea, y
// solo Ctrl+Shift+R permitía entrar, porque una recarga forzada omite el
// service worker. El valor correcto es el app-shell de la SPA: '/index.html'.
describe('PWA — fallback de navegación del service worker', () => {
  const matches = [...viteConfigSource.matchAll(/navigateFallback:\s*'([^']+)'/g)];
  const navigateFallback = matches[0]?.[1];

  it('declara exactamente un navigateFallback en vite.config.ts', () => {
    expect(matches).toHaveLength(1);
  });

  it('usa el app-shell de la SPA', () => {
    expect(navigateFallback).toBe('/index.html');
  });

  it('nunca usa la pantalla sin conexión como fallback de navegación', () => {
    expect(navigateFallback).not.toBe('/offline.html');
  });
});
