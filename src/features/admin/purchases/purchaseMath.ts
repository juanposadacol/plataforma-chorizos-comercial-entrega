export const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Costo por unidad de una compra de carne: lo que se pagó dividido entre los
 * chorizos que salieron de ella. No importa el sabor ni las diferencias
 * marginales entre ellos; es el costo con el que se valora cada unidad vendida.
 */
export const unitCostFromPaid = (paid: number, units: number): number =>
  units > 0 ? round2(paid / units) : 0;
