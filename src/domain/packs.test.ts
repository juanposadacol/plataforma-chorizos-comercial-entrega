import { describe, expect, it } from 'vitest';
import {
  basePresentation,
  buildPackNote,
  DEFAULT_PACK_SIZE,
  isPackSize,
  packSizeLabel,
  PACK_SIZE_OPTIONS,
} from './packs';

describe('presentaciones por producto', () => {
  it('ofrece exactamente 3, 4, 6 y 10 unidades', () =>
    expect(PACK_SIZE_OPTIONS).toEqual([3, 4, 6, 10]));

  it('usa 4 unidades como presentación por defecto', () =>
    expect(PACK_SIZE_OPTIONS).toContain(DEFAULT_PACK_SIZE));

  it('rechaza presentaciones que no están en el catálogo', () => {
    expect(isPackSize(6)).toBe(true);
    expect(isPackSize(5)).toBe(false);
    expect(isPackSize('4')).toBe(false);
    expect(isPackSize(undefined)).toBe(false);
  });

  it('etiqueta la presentación en español', () => expect(packSizeLabel(10)).toBe('10 unidades'));

  it('quita las unidades heredadas del texto de presentación', () => {
    expect(basePresentation('500 g · 4 unidades')).toBe('500 g');
    expect(basePresentation('500 g')).toBe('500 g');
    expect(basePresentation('4 unidades')).toBe('4 unidades');
  });

  it('resume las presentaciones elegidas para el negocio', () =>
    expect(
      buildPackNote([
        { name: 'Santa Rosano', quantity: 2, packSize: 6 },
        { name: 'Jalapeño', quantity: 1, packSize: 10 },
        { name: 'Argentino', quantity: 0, packSize: 3 },
      ]),
    ).toBe('Presentación: Santa Rosano x2 (6 unidades); Jalapeño x1 (10 unidades)'));

  it('no agrega nota cuando no hay líneas', () => expect(buildPackNote([])).toBe(''));
});
