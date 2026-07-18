import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { getPublicSettings } from '../features/catalog/catalogApi';

export function LegalPage() {
  const privacy = useLocation().pathname.includes('privacidad');
  const settings = useQuery({ queryKey: ['public-settings'], queryFn: getPublicSettings });
  const configuredText = privacy ? settings.data?.privacyPolicy : settings.data?.terms;
  return (
    <main className="legal-page">
      <Link to="/">← Volver a la tienda</Link>
      <article>
        <p className="eyebrow eyebrow--wine">Información legal</p>
        <h1>{privacy ? 'Política de privacidad' : 'Términos y condiciones'}</h1>
        {configuredText ? (
          <div className="legal-configured-text">{configuredText}</div>
        ) : (
          <>
            <p>
              Este contenido se administra desde la configuración privada de la plataforma. Antes de
              publicar, el negocio debe reemplazar este texto por su política vigente y revisada
              para Colombia.
            </p>
            {privacy ? (
              <>
                <h2>Datos utilizados</h2>
                <p>
                  Nombre, celular, dirección y datos del pedido se usan exclusivamente para
                  gestionar la compra, entrega, pagos y atención solicitada.
                </p>
                <h2>Seguridad</h2>
                <p>
                  El acceso se limita mediante autenticación y políticas de base de datos. Los
                  tokens y costos internos no se exponen al navegador.
                </p>
                <h2>Derechos</h2>
                <p>
                  El cliente puede solicitar consulta, corrección o eliminación cuando no exista una
                  obligación legal de conservación.
                </p>
              </>
            ) : (
              <>
                <h2>Pedidos y precios</h2>
                <p>
                  Todo precio se valida en el servidor al confirmar. El total autorizado queda
                  registrado en el detalle histórico del pedido.
                </p>
                <h2>Disponibilidad</h2>
                <p>
                  El inventario se reserva al crear el pedido. La aceptación puede estar sujeta a
                  verificación de datos, pago y cobertura de entrega.
                </p>
                <h2>Cancelaciones</h2>
                <p>
                  Las cancelaciones y devoluciones se registran para auditoría y siguen las reglas
                  comerciales configuradas por el negocio.
                </p>
              </>
            )}
          </>
        )}
      </article>
    </main>
  );
}
