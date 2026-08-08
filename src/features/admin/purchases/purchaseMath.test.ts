import { describe, expect, it } from 'vitest';
import { round2, unitCostFromPaid } from './purchaseMath';

// El caso que describió el negocio: se compran 300 kg de carne, se pagan
// $3.000.000 y salen 630 chorizos. Lo que importa para costear no es el sabor
// sino cuánto costó producir una unidad.
describe('costo por chorizo de una compra de carne', () => {
  it('divide el valor pagado entre los chorizos obtenidos', () =>
    expect(unitCostFromPaid(3000000, 630)).toBe(4761.9));

  it('redondea a dos decimales', () => expect(unitCostFromPaid(10000, 3)).toBe(3333.33));

  it('no divide por cero: sin rendimiento no hay costo que afirmar', () => {
    expect(unitCostFromPaid(10000, 0)).toBe(0);
    expect(unitCostFromPaid(10000, -5)).toBe(0);
  });

  it('coincide con el cálculo del servidor (round a 2 decimales)', () => {
    // El servidor hace round(total / unidades, 2); el navegador debe mostrar lo
    // mismo antes de guardar para que el operador no vea una cifra y guarde otra.
    expect(unitCostFromPaid(1234567, 89)).toBe(round2(1234567 / 89));
  });
});
