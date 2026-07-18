# Manual para clientes

La tienda permite comprar como visitante o iniciar sesión con un código SMS. En ambos casos el precio final, la disponibilidad y el total se confirman en el servidor antes de crear el pedido.

## 1. Comprar como cliente nuevo

1. Abra la página principal.
2. Busque un producto por nombre o use el filtro de categoría.
3. Revise fotografía, presentación, precio mostrado y disponibilidad.
4. Use `+` y `−` para elegir cantidades. El resumen se actualiza automáticamente.
5. Complete:
   - nombre completo;
   - celular colombiano;
   - dirección o punto de encuentro;
   - barrio o sector;
   - municipio;
   - forma de entrega;
   - forma de pago;
   - fecha solicitada;
   - observaciones opcionales.
6. Lea y acepte el tratamiento de datos.
7. Pulse **Confirmar pedido seguro** una sola vez y espere la respuesta.

Si el celular no existe, la plataforma crea el cliente con la lista pública. El cliente nunca debe elegir una categoría o lista de precios.

El total del resumen es estimado. Al confirmar, el servidor vuelve a consultar el producto, el cliente, el precio vigente, la tarifa de entrega y el inventario. Si algo cambió, se aplicará el valor autorizado por el servidor o se mostrará un error sin crear un pedido incompleto.

## 2. Iniciar sesión como cliente registrado

1. Pulse **Soy cliente**.
2. Escriba su celular.
3. Pulse **Enviar código**.
4. Ingrese el código de seis dígitos recibido por SMS.
5. Al completarse el acceso, el catálogo se actualiza con los precios que corresponden a la cuenta.

El código es de un solo uso. La plataforma no guarda un PIN recuperable ni una contraseña de cliente en texto plano. Nunca comparta el código con una persona que lo solicite por llamada, chat o formulario distinto de la tienda.

El envío depende del proveedor SMS configurado por el negocio. Si el SMS no llega:

- confirme que el número esté bien escrito;
- espere unos minutos antes de pedir otro código;
- revise la cobertura del teléfono;
- contacte al negocio sin revelar códigos anteriores.

Comprar como visitante puede seguir disponible aunque el OTP no esté configurado, pero **Mis pedidos** y los precios personalizados antes del checkout requieren una sesión válida.

Si el celular ya pertenece a una cuenta registrada, el servidor puede exigir que inicie sesión para impedir que otra persona suplante al cliente y use su condición comercial.

## 3. El carrito

El navegador conserva temporalmente solo el identificador del producto y la cantidad. Esto permite volver a la tienda sin perder la selección en el mismo dispositivo.

- El carrito no es una reserva.
- No guarda un precio definitivo.
- Puede desaparecer si se borran datos del navegador o se usa otro dispositivo.
- La existencia se reserva únicamente cuando el servidor confirma el pedido.

Después de una confirmación válida, el carrito se vacía.

## 4. Confirmación

Una compra válida muestra:

- consecutivo del pedido;
- total autorizado;
- estado inicial del pedido y del pago;
- estado de la notificación;
- enlace seguro de seguimiento;
- botón manual de WhatsApp, cuando corresponde.

Ver esta pantalla significa que el pedido ya fue guardado. WhatsApp es una notificación separada: si no abre, tarda o falla, el pedido no se pierde.

Copie el enlace de seguimiento y consérvelo. Si recarga directamente la página de confirmación, su contenido puede no estar disponible; use el enlace o el código guardado.

## 5. WhatsApp de respaldo

Cuando aparece **Avisar por WhatsApp**, el mensaje se construye con el pedido ya registrado. Al pulsarlo:

1. se abre WhatsApp o WhatsApp Web;
2. revise que el destinatario sea el número oficial del negocio;
3. envíe el mensaje si desea avisar manualmente.

No modifique cantidades o total dentro del mensaje para solicitar cambios. Pida al negocio actualizar el pedido por el proceso administrativo correspondiente.

El botón manual no confirma el pago y no crea un segundo pedido.

## 6. Seguir un pedido

Abra **Seguir pedido** o visite `/seguir`.

1. Pegue el código de seguimiento recibido en la confirmación.
2. Pulse **Consultar**.
3. Revise número, total, productos, estado e historial.

Estados habituales:

| Estado                    | Significado                                               |
| ------------------------- | --------------------------------------------------------- |
| Nuevo                     | El pedido fue guardado                                    |
| Pendiente de confirmación | El negocio está verificando la solicitud                  |
| Confirmado                | El negocio aceptó el pedido                               |
| En preparación            | Los productos están en proceso                            |
| Listo                     | El pedido está preparado                                  |
| Despachado                | Salió hacia el punto de entrega                           |
| Entregado                 | La entrega fue registrada                                 |
| Cancelado                 | El pedido no continuará; el negocio conserva el historial |
| Devuelto                  | Se registró una devolución total                          |

El token de seguimiento es un dato privado. No lo publique: quien lo posea puede consultar el resumen permitido de ese pedido. La dirección completa y la información interna no se muestran en el seguimiento público.

## 7. Mis pedidos y repetir compra

Con una sesión de cliente abierta, el menú muestra **Mis pedidos**.

- Consulte fecha, consecutivo, productos, estado y total.
- Abra el seguimiento de cualquier pedido propio.
- Use **Repetir** para volver a cargar en el carrito los productos que sigan identificables en el catálogo.

Repetir no reutiliza precios, disponibilidad, domicilio ni total antiguos. Revise el carrito y complete de nuevo el checkout; el servidor aplicará las reglas vigentes.

Si un producto fue retirado, no está activo o ya no tiene existencia, puede no agregarse o el servidor puede rechazarlo al confirmar.

## 8. Cerrar sesión

Pulse **Salir** en el menú, en especial si usa un teléfono compartido. Cerrar sesión no borra los pedidos; solo termina el acceso autenticado en ese navegador.

## 9. Instalar la aplicación

En navegadores compatibles puede usar **Instalar aplicación** o **Agregar a pantalla de inicio**. La versión instalada conserva el acceso rápido y algunos recursos visuales.

Sin conexión puede aparecer una pantalla básica, pero no es posible:

- consultar un precio personalizado vigente;
- validar inventario;
- iniciar sesión;
- crear o cambiar un pedido;
- confirmar un pago.

Espere a recuperar conexión y vuelva a intentar. No interprete una pantalla almacenada como confirmación comercial.

## 10. Errores frecuentes

### “Falta conectar la tienda”

El sitio fue publicado sin variables públicas válidas de Supabase. El administrador debe corregir la instalación; no ingrese datos personales hasta que esté resuelto.

### “Producto sin disponibilidad” o “inventario insuficiente”

Otra compra pudo reservar las últimas unidades o el stock cambió. Ajuste la cantidad y vuelva a confirmar.

### “Demasiados intentos”

La protección contra abuso bloqueó temporalmente nuevas solicitudes. Espere el período indicado y no recargue repetidamente.

### “No encontramos el pedido”

Compruebe que copió completo el código de seguimiento. No use el consecutivo comercial como si fuera el token.

### El total confirmado difiere del estimado

El servidor pudo aplicar la lista autorizada, un precio especial vigente, una tarifa o una actualización comercial. Revise la confirmación y contacte al negocio antes de pagar si necesita aclaración.

### WhatsApp no abrió

El pedido ya puede estar guardado. Use el seguimiento y contacte al número oficial; no repita el checkout sin comprobar primero el consecutivo.

## 11. Privacidad y seguridad

- Use solamente el dominio comunicado por el negocio.
- No envíe códigos OTP, contraseñas ni datos bancarios por formularios no oficiales.
- Revise la política de privacidad y los términos antes de comprar.
- Comparta dirección y observaciones solo en el checkout.
- No incluya información sensible innecesaria en observaciones.
- Para corregir datos, cancelar o ejercer derechos sobre la información, contacte al responsable indicado en la política vigente.
