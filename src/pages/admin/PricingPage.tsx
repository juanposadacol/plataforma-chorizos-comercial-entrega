import { PriceListEditor } from '../../features/admin/pricing/PriceListEditor';
import { PageHeader } from '../../features/admin/components/AdminUi';

export function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Reglas comerciales"
        title="Listas y precios"
        description="Controla el precio público, las listas asignadas, los acuerdos por cliente y los rangos por volumen."
      />
      <PriceListEditor />
    </>
  );
}
export default PricingPage;
