# Manual administrativo

El panel privado centraliza la operación comercial. Las acciones disponibles dependen del rol asignado y de las políticas RLS de Supabase; ocultar o mostrar un botón no es la barrera de seguridad.

## 1. Acceso y sesión

1. Abra `/admin/acceso` en el dominio de la aplicación.
2. Ingrese el correo administrativo y la contraseña creados por el superadministrador.
3. Si recibió una contraseña temporal, el sistema le exigirá crear una nueva de al menos 12 caracteres antes de entrar al panel.
4. Si olvidó la contraseña, escriba primero el correo y use **Olvidé mi contraseña**. Abra el enlace recibido y complete la pantalla **Nueva contraseña**. La entrega y el retorno dependen de que correo y redirecciones estén configurados en Supabase Auth.
5. Para terminar, use **Cerrar sesión** en el menú del panel.

Una cuenta válida de Supabase Auth no basta: el usuario también necesita un perfil activo y al menos un rol de personal. Una cuenta con rol exclusivo `customer` será rechazada por la ruta protegida.

En celular, el menú se abre desde el botón superior. En escritorio puede contraerse sin perder la ruta activa.

## 2. Roles

| Rol            | Uso operativo previsto                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| `superadmin`   | Configuración y acceso completo, incluido gobierno de roles de alto privilegio |
| `admin`        | Gestión general de pedidos, clientes, catálogo, precios, inventario y reportes |
| `vendedor`     | Consulta comercial y transiciones iniciales autorizadas de pedidos             |
| `bodega`       | Inventario, recepción y estados logísticos autorizados                         |
| `contabilidad` | Pagos, cartera, compras, gastos, caja y reportes financieros autorizados       |
| `customer`     | Solo la experiencia de cliente y sus datos propios                             |

Una persona puede tener más de un rol. Aplique mínimo privilegio y revise periódicamente cuentas inactivas. Si una acción responde “permisos insuficientes”, no intente eludirla: solicite al superadministrador revisar el rol y la política correspondiente.

## 3. Rutina recomendada

### Inicio del día

1. Revise **Resumen** y seleccione _Hoy_.
2. Atienda pedidos nuevos y pendientes.
3. Revise productos con stock bajo.
4. Revise entregas de WhatsApp pendientes, manuales o fallidas.
5. Confirme que caja, recaudos y saldos del día anterior estén conciliados.

### Durante la operación

1. Confirme pedidos válidos.
2. Cambie el estado conforme ocurre el proceso físico, nunca por anticipado.
3. Registre pagos con su referencia y evidencia disponible.
4. Reciba compras únicamente cuando la mercancía haya sido verificada.
5. Registre gastos en la fecha y categoría correctas.

### Cierre del día

1. Consulte ventas por día, pagos y flujo de caja.
2. Compare pedidos entregados contra recaudos y cuentas por cobrar.
3. Revise cancelaciones, devoluciones y ajustes de inventario con su motivo.
4. Exporte el reporte necesario y guárdelo según la política documental del negocio.

## 4. Resumen del negocio

La ruta `/admin` muestra indicadores y gráficas a partir de registros de Supabase. Puede elegir hoy, ayer, últimos siete días, semana, mes, año o un rango personalizado.

Incluye ventas, pedidos por estado, ticket promedio, utilidad bruta y neta, recaudo, saldo por cobrar, valor de inventario, clientes nuevos, stock bajo y notificaciones. Las gráficas comparan ventas/utilidad y muestran rankings de productos, clientes y formas de pago.

Interpretación básica:

- **Ventas** no equivale a efectivo recibido.
- **Utilidad bruta** descuenta el costo de reposición: para cada línea entregada se usa el **costo unitario promedio de la semana de compras anterior** (valor pagado ÷ cantidad). Si un producto no se compró esa semana se toma la última semana con compras; si nunca se ha comprado, se conserva el costo registrado en el pedido.
- **Utilidad neta** descuenta además los gastos operativos registrados.
- Los reportes por día y por producto (`/admin/reportes`) siguen usando el costo congelado en el momento de la entrega, así que pueden diferir del resumen. La métrica `net_profit_recorded` conserva esa lectura anterior para comparar.
- **Recaudado** corresponde a pagos válidos del período.
- **Por cobrar** es un saldo comercial y no un ingreso de caja.

Si un indicador parece incorrecto, revise primero fechas, estado del pedido, pagos, gastos y costos históricos. No corrija resultados editando directamente tablas financieras.

## 5. Pedidos

### Consultar y filtrar

En `/admin/pedidos` puede buscar por consecutivo, cliente o celular; filtrar por estado del pedido y del pago; actualizar la consulta y exportar el resultado filtrado a CSV. Los cambios de la tabla `orders` disparan una recarga en tiempo real bajo los permisos de la sesión.

Abra el consecutivo para consultar productos, snapshots de precio y costo, entrega, observaciones, pagos, notas internas e historial. Desde el detalle puede usar la impresión del navegador para papel o PDF.

### Comprobante de entrega en PDF

El botón de documento de cada fila —y **Comprobante de entrega** en el detalle— descarga un PDF de una página, listo para imprimir y llevar con el domicilio. Incluye el consecutivo, la fecha, los datos del cliente y de la entrega, el detalle de productos con cantidades y precios, el total, lo pagado, el saldo por cobrar, las observaciones del pedido (con la presentación elegida) y dos espacios de firma: **Recibí a satisfacción** para el cliente y **Entregado por** para quien despacha.

Es el soporte interno de entrega del negocio; no reemplaza una factura electrónica DIAN.

### Eliminar un pedido definitivamente

El botón de papelera abre la eliminación definitiva de un pedido creado por error, **en cualquier estado, incluido pagado o entregado**. Requiere rol **superadministrador** y escribir el consecutivo como confirmación; el modal advierte antes lo que se va a revertir.

En una sola transacción el servidor:

- devuelve al inventario exactamente lo que el pedido movió (reservas, ventas y devoluciones), producto por producto;
- elimina sus pagos y descuenta de la caja lo que esos pagos habían sumado;
- elimina su cartera y **recalcula** los agregados del cliente (compras, saldo, ticket promedio, última compra) con lo que queda;
- borra líneas, historial, notificaciones y la auditoría con el contenido comercial del pedido, dejando solo una huella técnica sin datos.

Único caso que el servidor rechaza: que el pedido tenga un **gasto contable** asociado. Elimine primero ese gasto en `/admin/gastos` y repita la operación.

### Estados permitidos

El servidor aplica la secuencia, no el navegador:

```text
nuevo → pendiente de confirmación → confirmado → en preparación
      → listo → despachado → entregado → devuelto
```

También se permiten algunos atajos controlados al confirmar y la cancelación desde etapas previas al despacho. No se puede saltar arbitrariamente de estado. Cancelar o devolver exige motivo.

- **Cancelar:** libera una reserva activa y conserva pedido, historial y auditoría.
- **Entregar:** convierte la reserva en salida, registra el movimiento de venta y consolida estadísticas del cliente.
- **Devolver:** la versión actual procesa una devolución total del pedido, repone las existencias correspondientes y registra el movimiento. No use este flujo para una devolución parcial.

Las transiciones dependen del rol: ventas atiende etapas comerciales iniciales y bodega las etapas logísticas. Si otra persona modificó el pedido, recargue antes de volver a intentar.

### Pedido manual

Use **Crear pedido desde la tienda** y complete el checkout con los datos entregados por el cliente. El celular va primero: al escribirlo completo, el personal ve cargarse solos el nombre y la dirección si el cliente ya existe. Revíselos con el cliente antes de confirmar, porque pueden estar desactualizados.

La búsqueda por celular también funciona para el comprador que entra a la tienda por su cuenta, sin sesión. Devuelve solo nombre y dirección de entrega: documento, correo, saldo, cupo, lista de precios e historial nunca salen del panel.

Aunque lo haga un empleado, no invente precios en el navegador: el servidor resolverá la condición comercial asociada al cliente.

## 6. Clientes

En `/admin/clientes` puede crear, buscar, editar y desactivar clientes. Administre con cuidado:

- identidad y contacto;
- clasificación interna;
- lista de precios asignada;
- condición, cupo y días de crédito;
- estado y observaciones.

El comprador no puede asignarse su propia lista. Antes de cambiarla, confirme el acuerdo comercial y su vigencia.

El detalle de cliente muestra historial de pedidos, métricas de compra, saldo y precios especiales. Desde allí puede iniciar un pedido o abrir la configuración de un precio especial.

La columna **Ubicación** se llena sola: al crear un pedido, la dirección escrita en el checkout queda guardada en la libreta del cliente. Si el cliente pide desde otra dirección, la nueva se agrega y la primera sigue siendo la principal; el autocompletado usa la principal.

Los clientes no tienen acceso a la plataforma: se identifican por su celular al pedir. Si la instalación conserva un hash de PIN de versiones anteriores, **Restablecer PIN** lo invalida y limpia intentos y bloqueo; no genera una contraseña recuperable ni habilita un acceso. El hash no se expone por la API.

Para retirar un cliente de la operación, use desactivación. No elimine físicamente registros vinculados a pedidos o saldos.

**Eliminar definitivamente.** El botón de papelera de cada fila abre la eliminación definitiva, pensada para clientes creados por error o durante pruebas. Requiere rol **superadministrador**, escribir el celular del cliente como confirmación y que el cliente **no tenga pedidos, pagos ni cartera**; si los tiene, el servidor rechaza la operación y debe desactivarlo. La eliminación borra en una sola transacción sus direcciones, precios especiales, notificaciones y la auditoría que contiene sus datos personales, y deja solo una huella técnica sin contenido.

## 7. Productos

En `/admin/productos` gestione SKU, nombre, slug, descripciones, categoría, marca, imagen, presentación, unidad, precio público, costos, mínimo, estado y si admite venta sin stock.

Buenas prácticas:

- use un SKU único y estable;
- use una imagen del mismo sitio o de Supabase Storage; otro host HTTPS requiere autorizarlo explícitamente en la CSP de `netlify.toml`;
- no cambie el SKU para reutilizar un producto histórico como si fuera otro;
- verifique precio público y costo antes de activar;
- desactive un producto retirado en lugar de borrarlo;
- haga cambios de existencias únicamente en **Inventario** o al recibir compras.

Los pedidos existentes conservan sus snapshots aunque se modifiquen nombre, precio, imagen o costo del maestro.

## 8. Listas y precios

La ruta `/admin/precios` separa cuatro conceptos.

### Listas

Cree y desactive listas comerciales. Marque solo una como pública y asigne a cada cliente la lista autorizada. Use **Duplicar** para copiar una lista y sus precios como punto de partida, luego cambie código, vigencias y valores antes de usarla. No elimine una lista usada históricamente.

### Matriz de productos

Defina el precio de cada producto por lista. La matriz muestra el precio vigente hoy y al guardar solo escribe los que realmente cambiaron: si ya existe una versión con la fecha de hoy la actualiza y, si no, crea una versión nueva con vigencia desde hoy. Las versiones anteriores quedan como historial y los pedidos ya creados no se alteran. Antes de activar una lista, confirme que todos los productos vendibles tengan precio; si falta uno, el servidor caerá al precio público.

### Precios especiales

Use una excepción solo para un acuerdo cliente-producto real. Defina cliente, producto, precio, fecha inicial, fecha final opcional, estado y observación. Una excepción vigente tiene prioridad sobre volumen y lista.

### Volumen

Defina lista, producto, mínimo, máximo opcional, precio, vigencia y estado. Los tramos solo participan cuando `volume_pricing_enabled` está activo en Configuración. Evite rangos superpuestos y pruebe los límites antes de habilitarlos.

Después de cualquier cambio, haga una compra de ensayo con cada perfil relevante. La vista de catálogo es orientativa; el valor autoritativo se decide al confirmar el pedido.

Use la pestaña **Historial** para revisar cambios auditados en listas, precios y acuerdos. El historial explica quién cambió un registro, pero no reemplaza la aprobación comercial previa.

## 9. Inventario y kardex

`/admin/inventario` muestra existencias, reservado, disponible, mínimos y movimientos. Exporte el kardex filtrado si necesita conciliación.

Para un ajuste:

1. seleccione el producto;
2. elija ajuste positivo, negativo, daño o pérdida;
3. escriba cantidad y costo si corresponde;
4. registre un motivo específico;
5. confirme y revise el movimiento resultante.

El **inventario inicial** de un producto se corrige y se elimina igual que un ajuste: es un dato digitado y equivocarse ahí no puede ser irreversible.

Para corregir o eliminar un ajuste mal registrado, use los botones de la columna **Acciones** del kardex:

- **Editar** permite cambiar tipo, cantidad, costo y motivo del ajuste. El producto no se cambia: si se equivocó de referencia, elimine el movimiento y regístrelo de nuevo.
- **Eliminar** revierte el efecto del ajuste sobre las existencias.

En ambos casos el servidor recalcula el stock del producto y recoloca los saldos de los movimientos posteriores, así que la última fila del kardex sigue coincidiendo con la existencia real. Las dos acciones exigen rol **superadministrador** o **administrador** y quedan en la auditoría con su antes y su después.

Solo se pueden corregir los movimientos **digitados a mano**: inventario inicial, ajuste positivo, ajuste negativo, daño y pérdida. Los que nacen de un pedido —reserva, liberación, venta, devolución— aparecen como **Automático** y se corrigen operando ese pedido: si quiere que desaparezca la reserva, cancele o elimine el pedido que la creó.

Nunca edite `stock_on_hand` o `stock_reserved` directamente. Las funciones transaccionales bloquean filas, protegen reservas y registran saldo anterior y posterior. Una discrepancia física debe documentarse como movimiento, no ocultarse.

## 10. Proveedores y compras de carne

Primero cree el proveedor en `/admin/proveedores`, incluyendo NIT, contacto y condiciones de pago.

El negocio no compra chorizos terminados: compra **carne**. Por eso la compra no tiene líneas por producto, ni descuento, ni impuesto. En `/admin/compras`:

1. seleccione proveedor y fecha, y escriba el número de factura si lo hay;
2. registre **cuántos kilos de carne** compró, **cuánto pagó** y **cuántos chorizos** salieron de esa carne;
3. revise el **costo por chorizo** que aparece calculado (valor pagado ÷ chorizos obtenidos);
4. registre el abono al proveedor y el vencimiento si quedó saldo;
5. guarde.

Ejemplo: 300 kg por $3.000.000 que rinden 630 chorizos ⇒ $4.761,90 por chorizo.

Al guardar, ese costo por chorizo queda como costo actual y promedio de **todos los productos activos**, y con él se valora cada línea vendida y se calcula la utilidad. No importa el sabor: el rendimiento es común a la producción de esa carne.

La compra **no cambia las existencias**: repartir el rendimiento entre los sabores sería inventar un dato. El stock de cada chorizo se sigue registrando en Inventario, que es donde el negocio cuenta lo que produjo. Si queda saldo con el proveedor, se abre la cuenta por pagar igual que antes.

## 11. Pagos y cartera

En `/admin/pagos` alterne entre pagos y cuentas por cobrar. Para registrar un recaudo:

1. elija el pedido correcto;
2. escriba el valor recibido, nunca el valor prometido;
3. seleccione el método;
4. incluya referencia y observación cuando aplique;
5. confirme y verifique el saldo actualizado.

El servidor impide aprobar por encima del saldo y actualiza el estado del pedido a pendiente, parcial o pagado. Los pagos aprobados pueden actualizar cartera y caja según la configuración. Un error no se corrige borrando el pago: use el proceso contable de rechazo, reversión o reembolso que corresponda y deje trazabilidad.

## 12. Gastos

En `/admin/gastos` registre fecha, categoría, descripción, beneficiario, valor, forma de pago, cuenta, pedido relacionado, soporte y observaciones. El gasto reduce utilidad neta, no utilidad bruta.

Categorías disponibles:

| Categoría           | ¿Resta en la utilidad neta? |
| ------------------- | --------------------------- |
| Insumos             | Sí                          |
| Mano de obra        | Sí                          |
| Servicios           | Sí                          |
| Arriendo            | Sí                          |
| Pago de proveedores | No                          |

**Pago de proveedores** queda registrado pero no resta en la utilidad, y es intencional: la mercancía ya descuenta utilidad como costo de ventas cuando se vende. Si además restara como gasto, el mismo desembolso se contaría dos veces y la utilidad aparecería más baja de lo real. Use esta categoría solo para dejar constancia del pago; el efecto en la utilidad ya lo produce la compra.

No mezcle compras de inventario con gastos operativos ni duplique un desembolso ya reflejado en caja. Use categorías consistentes para que los reportes sean comparables.

## 13. Reportes y exportaciones

En `/admin/reportes` seleccione reporte, fecha inicial y final, y pulse **Generar**. Están disponibles:

- ventas por día;
- ranking de productos y clientes;
- pagos, cuentas por cobrar y flujo de caja;
- gastos y compras;
- inventario actual y bajo;
- cancelaciones y devoluciones.

La tabla presenta hasta 500 filas para mantener la interfaz ágil; la exportación usa todas las filas devueltas por la consulta, con un límite operativo de 5.000 en los reportes basados en tablas.

Formatos:

- **CSV:** texto UTF-8 con BOM, apropiado para Excel y otros analizadores.
- **Excel:** SpreadsheetML compatible guardado como `.xls`; no es un libro `.xlsx` nativo.
- **PDF:** tabla en orientación horizontal, generada en el navegador.

Los listados administrativos con botón **CSV** exportan el conjunto filtrado en pantalla. Los archivos se descargan al dispositivo; la plataforma no los guarda ni los cifra. Trátelos como datos comerciales sensibles, compruebe el rango y elimínelos cuando termine su finalidad.

## 14. Usuarios y permisos

En `/admin/usuarios` el superadministrador puede invitar personal, asignar roles y desactivar perfiles. La invitación depende de que la función `invite-staff`, el correo de Supabase y sus redirecciones estén configurados.

Antes de guardar roles:

- confirme identidad y correo;
- asigne solo lo necesario;
- evite compartir cuentas;
- conserve al menos un superadministrador activo;
- retire acceso al finalizar una relación laboral.

Los cambios de rol se aplican en las siguientes consultas bajo RLS. Pida al usuario cerrar y abrir sesión si mantiene una vista obsoleta.

## 15. Notificaciones

`/admin/notificaciones` separa el evento interno del intento de entrega. Puede buscar, filtrar, marcar como leído, abrir el pedido y reencolar entregas fallidas o manuales.

Estados habituales:

- `pending` / `processing` / `retrying`: el worker aún debe actuar;
- `sent`: Meta aceptó la solicitud y devolvió un identificador;
- `manual_required`: faltó configuración automática o se agotó la ruta aplicable; use el respaldo manual;
- `failed`: error final que requiere revisión.

Reintentar no crea otro pedido. Antes de hacerlo, corrija token, plantilla, número, scheduler o conectividad según el error. Consulte [07-seguridad-whatsapp.md](07-seguridad-whatsapp.md).

## 16. Configuración

En `/admin/configuracion` administre valores no secretos:

- identidad, logo y color;
- teléfonos y datos bancarios visibles;
- COP, zona horaria, domicilio y mínimos;
- formas de pago y entrega;
- términos, privacidad y volumen;
- proveedor, número y plantilla de WhatsApp como metadatos operativos.

Las credenciales no pertenecen a este formulario. Tokens, service role y secreto del worker se administran como secretos de servidor.

Después de cambiar una opción pública, recargue la tienda y haga una prueba. Los textos legales configurados se muestran en sus rutas públicas; si están vacíos, aparece un aviso de contenido pendiente que no sustituye revisión jurídica.

## 17. Reglas de integridad

- No elimine pedidos, pagos, compras, gastos, movimientos ni auditoría.
- No ajuste inventario ni totales directamente en SQL para resolver una operación normal.
- No comparta enlaces de pedido, exportaciones o datos de clientes fuera del personal autorizado.
- No guarde tokens o contraseñas en notas, archivos exportados ni capturas.
- Use motivo claro en cancelaciones, devoluciones y ajustes.
- Si una operación transaccional falla, investigue la causa antes de repetir; la clave de idempotencia protege pedidos, pero no justifica pulsaciones indiscriminadas.
