# Diagnóstico del proyecto original

## Inventario inspeccionado

El ZIP original contiene únicamente:

- `index.html`: 279 líneas con HTML, CSS y JavaScript en el mismo archivo.
- `README.txt`: instrucciones para abrir la página, configurar WhatsApp y publicar.
- `assets/santa-rosano.png`, `assets/argentino.png` y `assets/jalapeno.png`: imágenes PNG RGB de 1254 × 1254 px. En conjunto pesan cerca de 7,7 MiB.

No existían `package.json`, servidor, API, base de datos, autenticación, pruebas, PWA, rutas, control de acceso ni despliegue reproducible.

## Funcionamiento encontrado

1. Tres productos y el precio único `$17.300` se declaraban directamente en JavaScript.
2. Las cantidades vivían solo en memoria.
3. El navegador multiplicaba unidades por el precio global.
4. Nombre, celular y dirección solo se validaban como texto no vacío.
5. El pedido se convertía en texto y se abría con `wa.me`.
6. El nombre del negocio y WhatsApp receptor se tomaban de `?name=`, `?wa=` o `localStorage`.

No se creaba un pedido, consecutivo, cliente, reserva, pago o historial. Al recargar se perdía el carrito.

## Riesgos prioritarios

- **Desvío de pedidos:** cualquier visitante podía alterar `?wa=` y configurar otro receptor.
- **Precio manipulable:** producto, cantidad, subtotal y total provenían del navegador.
- **Pérdida del pedido:** si WhatsApp fallaba o el usuario no pulsaba «Enviar», no quedaba registro.
- **Sin separación de roles:** la configuración estaba en la tienda pública.
- **Sin inventario concurrente:** dos compradores podían creer que adquirían la última unidad.
- **Privacidad limitada:** todos los datos del cliente terminaban en una URL de WhatsApp.
- **Mantenibilidad baja:** presentación, catálogo, datos y lógica estaban acoplados.
- **Rendimiento:** las imágenes fotográficas en PNG eran pesadas.
- **Inconsistencia futura:** el precio `$17.300` está incrustado dentro de las fotos, aunque cada cliente tendrá un precio distinto.

## Elementos conservados

- Paleta vino, crema, papel, dorado y verde.
- Titulares serif y estética artesanal.
- Hero comercial, tarjetas, selector `+ / −`, formulario, resumen y barra móvil.
- Fotografías y orden de productos: Santa Rosano, Argentino, Jalapeño.
- Formato COP y experiencia catálogo → carrito → datos → confirmación.
- WhatsApp manual como respaldo, nunca como base de datos.

Las fotos se muestran con un encuadre CSS que reduce la visibilidad del precio impreso. Los originales permanecen intactos.

## Elementos reemplazados

- Constantes de productos y precios → consultas seguras a Supabase.
- Configuración pública/query string → `app_settings` protegida.
- Cálculo autoritativo en navegador → función PostgreSQL transaccional.
- Pedido solo en WhatsApp → orden, detalles, reserva, historial y notificación persistidos.
- Archivo único → componentes y módulos React/TypeScript.
- Engranaje público → panel administrativo con roles.
- Estado efímero → carrito local temporal sin precios confiables; datos definitivos en PostgreSQL.

## Datos reales aún necesarios

Antes de producción, el negocio debe confirmar SKU, costos, stock inicial, teléfono administrador, zonas y tarifas de domicilio, municipios, datos bancarios, contenido legal, proveedor de SMS, cuenta Meta Business y credenciales de Supabase/Netlify. El `seed.sql` usa datos marcados como demostración.
