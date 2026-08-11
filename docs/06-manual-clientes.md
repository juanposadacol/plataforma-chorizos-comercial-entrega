# Manual para clientes

En la tienda no hay que registrarse ni iniciar sesión: el celular identifica al comprador. El precio final, la disponibilidad y el total siempre se confirman en el servidor antes de crear el pedido.

## 1. Comprar

1. Abra la página principal.
2. Use el filtro de categoría para ubicar los sabores.
3. Revise fotografía, presentación, precio mostrado y disponibilidad (**Disponible** o **Agotado**; la tienda no muestra las cantidades en inventario).
4. Elija la presentación del paquete: **3, 4, 6 o 10 unidades**. Las cuatro versiones tienen el mismo precio y la selección viaja con el pedido para que el negocio sepa cómo empacarlo.
5. Use `+` y `−` para elegir cantidades. El resumen se actualiza automáticamente.
6. Puede pedir **el mismo sabor en varias presentaciones**: elija una presentación, ponga la cantidad, cambie de presentación y ponga la otra. Cada combinación queda como una línea propia (por ejemplo _4 × 3 unidades_ y _5 × 10 unidades_ del mismo chorizo), tanto en la tarjeta del producto como en el resumen, y cada una se puede quitar por separado.
7. Complete, empezando por el celular. Si ya compró antes, el nombre y la dirección se cargan solos y solo tiene que revisarlos:
   - celular colombiano;
   - nombre completo;
   - dirección o punto de encuentro;
   - barrio o sector;
   - municipio;
   - forma de entrega (solo domicilio);
   - forma de pago (**Efectivo** o **Transferencia**);
   - fecha solicitada;
   - observaciones opcionales.
8. Pulse **Confirmar pedido seguro** una sola vez y espere la respuesta.

El **correo electrónico es opcional**: si lo escribe, recibirá la confirmación del pedido con el detalle, el total y la dirección de entrega. Sin correo el pedido se registra igual.

Si el negocio ya tiene un correo suyo registrado, el formulario se lo indica con una pista enmascarada (por ejemplo `j••••@g••••.com`) y **la confirmación llega ahí aunque deje el campo vacío**. Escriba uno solo si quiere cambiarlo: el nuevo reemplaza al anterior. El correo completo nunca se muestra a quien solo escribe su número; si compró antes desde este mismo dispositivo, ahí sí aparece completo porque usted lo escribió en él.

Si el celular no existe, la plataforma crea el cliente con la lista pública. El cliente nunca debe elegir una categoría o lista de precios.

El total del resumen es estimado. Al confirmar, el servidor vuelve a consultar el producto, el cliente, el precio vigente, la tarifa de entrega y el inventario. Si algo cambió, se aplicará el valor autorizado por el servidor o se mostrará un error sin crear un pedido incompleto.

## 2. Si ya compró antes

No hay clave, ni código por mensaje, ni cuenta que recordar. Escriba su celular al comienzo del formulario y la tienda carga sola su nombre y su dirección de entrega para que solo los revise. Si el negocio le asignó precios propios, **el catálogo cambia de inmediato y muestra lo que se le va a cobrar**, marcado como «Tu precio»: ya no hay que llegar al final de la compra para verlo.

Revise siempre esos datos antes de confirmar: pueden estar desactualizados si se mudó o cambió de barrio.

Como el celular es la identificación, quien lo conozca puede pedir a su nombre. El negocio confirma cada pedido antes de despacharlo, así que avise si recibe una confirmación que usted no hizo.

## 3. El carrito

El navegador conserva temporalmente solo el identificador del producto, la presentación y la cantidad. Esto permite volver a la tienda sin perder la selección en el mismo dispositivo, incluidas las líneas del mismo producto en distintas presentaciones.

- El carrito no es una reserva.
- No guarda un precio definitivo.
- Puede desaparecer si se borran datos del navegador o se usa otro dispositivo.
- La existencia se reserva únicamente cuando el servidor confirma el pedido.

Después de una confirmación válida, el carrito se vacía.

## 4. Confirmación

Una compra válida muestra:

- consecutivo del pedido;
- total autorizado;
- botón manual de WhatsApp, cuando corresponde.

Ver esta pantalla significa que el pedido ya fue guardado. WhatsApp es una notificación separada: si no abre, tarda o falla, el pedido no se pierde.

Anote el consecutivo del pedido: es el dato que el negocio necesita para atenderlo. Desde la misma pantalla puede **volver a la tienda** o **hacer otro pedido**.

## 5. WhatsApp de respaldo

Cuando aparece **Avisar por WhatsApp**, el mensaje se construye con el pedido ya registrado. Al pulsarlo:

1. se abre WhatsApp o WhatsApp Web;
2. revise que el destinatario sea el número oficial del negocio;
3. envíe el mensaje si desea avisar manualmente.

No modifique cantidades o total dentro del mensaje para solicitar cambios. Pida al negocio actualizar el pedido por el proceso administrativo correspondiente.

El botón manual no confirma el pago y no crea un segundo pedido.

## 6. Cerrar sesión

**Salir** solo aparece con una sesión del personal del negocio abierta. Como comprador no hay sesión que cerrar: la tienda no guarda ningún acceso suyo en el navegador, solo el carrito.

## 7. Instalar la aplicación

En navegadores compatibles puede usar **Instalar aplicación** o **Agregar a pantalla de inicio**. La versión instalada conserva el acceso rápido y algunos recursos visuales.

Sin conexión, la aplicación puede abrir la pantalla guardada en el dispositivo y mostrar la interfaz, pero no es posible:

- consultar un precio personalizado vigente;
- validar inventario;
- crear o cambiar un pedido;
- confirmar un pago.

Todas esas acciones consultan el servidor y fallarán hasta que recupere la conexión. Espere a recuperarla y vuelva a intentar. No interprete una pantalla almacenada como confirmación comercial: lo que ve puede ser información antigua guardada en el dispositivo.

## 8. Errores frecuentes

### “Este sitio no está autorizado para crear pedidos”

La dirección desde la que está comprando no figura en la lista de dominios autorizados del servidor. Normalmente ocurre justo después de cambiar el nombre o el dominio del sitio. **No es un problema de su dispositivo ni de su pedido: no se creó ninguna compra.** Verifique que está usando el dominio oficial del negocio; si es el correcto, avise al administrador, que debe actualizar `ALLOWED_ORIGINS` en Supabase.

### “Falta conectar la tienda”

El sitio fue publicado sin variables públicas válidas de Supabase. El administrador debe corregir la instalación; no ingrese datos personales hasta que esté resuelto.

### “Producto sin disponibilidad” o “inventario insuficiente”

Otra compra pudo reservar las últimas unidades o el stock cambió. Ajuste la cantidad y vuelva a confirmar.

### “Demasiados intentos”

La protección contra abuso bloqueó temporalmente nuevas solicitudes. Espere el período indicado y no recargue repetidamente.

### El total confirmado difiere del estimado

El servidor pudo aplicar la lista autorizada, un precio especial vigente, una tarifa o una actualización comercial. Revise la confirmación y contacte al negocio antes de pagar si necesita aclaración.

### WhatsApp no abrió

El pedido ya puede estar guardado. Contacte al número oficial del negocio con el consecutivo antes de repetir el checkout.

## 9. Privacidad y seguridad

- Use solamente el dominio comunicado por el negocio.
- El negocio nunca le pedirá una clave ni un código por mensaje para comprar: no entregue datos bancarios en formularios que no sean el checkout oficial.
- Revise la política de privacidad y los términos antes de comprar.
- Comparta dirección y observaciones solo en el checkout.
- No incluya información sensible innecesaria en observaciones.
- Para corregir datos, cancelar o ejercer derechos sobre la información, contacte al responsable indicado en la política vigente.
