# Decisiones técnicas, estado y pendientes

Fecha de corte documental: 17 de julio de 2026.

Este documento distingue código incluido, configuración externa y trabajo futuro. “Incluido” significa que existe una implementación en el proyecto; no significa que haya sido desplegada, conectada a credenciales reales o aceptada por el negocio.

## 1. Decisiones técnicas

### D-01. Evolucionar el sitio original, no reemplazarlo

Se conservaron paleta, estética artesanal, fotografías, tarjetas, cantidades, formulario, resumen y recorrido móvil. El HTML monolítico se separó en React y TypeScript para poder mantener tienda y panel sin perder la identidad comercial.

**Consecuencia:** las imágenes originales siguen siendo activos válidos, aunque antes de producción deben revisarse encuadre, peso, derechos y cualquier precio impreso.

### D-02. Supabase como fuente autoritativa

PostgreSQL conserva clientes, catálogo, reglas de precio, pedidos, snapshots, inventario, finanzas, notificaciones y auditoría. `localStorage` solo conserva `{productId, quantity}` del carrito y la sesión es administrada por Supabase Auth.

**Consecuencia:** borrar almacenamiento local no elimina pedidos; una captura del navegador no reemplaza la base de datos.

### D-03. Precio y total decididos por el servidor

El frontend muestra una estimación, pero no envía un precio definitivo. PostgreSQL prioriza precio especial, volumen habilitado, lista asignada y precio público. La función de creación vuelve a validar productos, vigencias, entrega e inventario.

**Consecuencia:** una modificación de JavaScript o de la solicitud no autoriza un precio. El total confirmado puede diferir de una vista obsoleta.

### D-04. Edge Function como frontera y PostgreSQL como transacción

`create-order` aplica HTTP, CORS, Zod, sesión opcional, rate limit e idempotencia. La función SQL `create_order` ejecuta las decisiones comerciales y escrituras relacionadas dentro de una transacción.

**Consecuencia:** la validación no está duplicada como autoridad en React y una falla intermedia no deja un pedido parcial.

### D-05. Visitantes y clientes con OTP

Un visitante puede comprar con datos mínimos y recibe lista pública si su celular no existe. Un cliente enlazado a Auth usa un código SMS de un solo uso para ver su catálogo e historial. No se almacena un PIN recuperable en texto plano.

**Consecuencia:** el OTP depende de un proveedor SMS externo; comprar y autenticarse son capacidades distintas.

### D-06. Reservar antes de vender

Crear pedido aumenta reservado sin descontar existencia física. Cancelar libera; entregar descuenta existencia y reserva; devolver repone. Recepciones y ajustes crean kardex. Las filas se bloquean en orden estable.

**Consecuencia:** dos compradores no deben poder reservar la última unidad. El stock no se edita directamente desde formularios genéricos.

### D-07. Snapshots históricos

Pedido y detalle guardan nombre, SKU, imagen, lista/fuente de precio, valores, costo y utilidad del momento.

**Consecuencia:** cambiar un maestro no reescribe el pasado y los reportes pueden explicar el valor autorizado originalmente.

### D-08. Outbox para WhatsApp

La transacción crea la notificación y su entrega; el worker llama a Meta después del commit. Se registran intentos, ID externo, respuesta reducida, error y estado. Existe enlace manual de respaldo.

**Consecuencia:** WhatsApp no es la base de datos ni un punto único de falla. El scheduler es parte obligatoria de la operación automática.

### D-09. Roles más RLS

React protege rutas y adapta la interfaz, pero PostgreSQL aplica el límite real por rol, propiedad y función. La service role queda confinada al servidor.

**Consecuencia:** no es suficiente ocultar botones. Cada cambio de permisos debe probarse con una sesión de rol real.

### D-10. Datos financieros conservados y auditables

Pedidos, pagos, compras, gastos, kardex, caja e historial no se borran físicamente en la operación normal. Se usan estados, desactivación, reversión o movimientos compensatorios.

**Consecuencia:** las correcciones requieren motivo y trazabilidad; el negocio debe definir su política de retención.

### D-11. COP y America/Bogota

El dinero usa `numeric`, la interfaz formatea COP y los timestamps se almacenan con zona. Las fechas comerciales se muestran en `America/Bogota`.

**Consecuencia:** no se usa `float` para dinero y los filtros de fecha deben probarse en los bordes de día local.

### D-12. Realtime como señal, no como autorización

El panel escucha cambios relevantes y vuelve a consultar. La lectura resultante sigue pasando por RLS.

**Consecuencia:** un evento no incluye autoridad adicional ni sustituye una recarga después de reconexión.

### D-13. PWA sin pedidos offline

Se almacenan shell, assets e imágenes, con página de desconexión. No se encolan pedidos financieros en el dispositivo para confirmarlos después.

**Consecuencia:** instalar mejora acceso, no elimina la necesidad de conexión para precio, inventario, Auth o checkout.

### D-14. Exportación en el navegador

Los listados exportan CSV y el módulo de reportes agrega SpreadsheetML `.xls` y PDF. Los archivos se generan localmente a partir del conjunto consultado.

**Consecuencia:** no se suben copias al servidor, pero el dispositivo del administrador pasa a custodiar datos sensibles.

### D-15. Modo demo explícitamente no operativo

`VITE_ENABLE_DEMO_DATA=true` permite revisar la presentación sin Supabase y bloquea la confirmación.

**Consecuencia:** los datos simulados no pueden confundirse con una solución de producción.

## 2. Funcionalidad incluida en el proyecto

### Tienda y cliente

- Catálogo desde Supabase con búsqueda, categoría, destacados, disponibilidad y precio efectivo.
- Carrito persistente de cantidades y diseño responsivo.
- Checkout validado con nombre, celular, entrega, pago, fecha, observaciones y consentimiento.
- Creación de pedido por Edge Function y confirmación con consecutivo, total y token opaco.
- Seguimiento público limitado e historial de pedidos propios.
- Acceso por OTP, cierre de sesión y repetición de productos de un pedido anterior.
- Recuperación administrativa y cambio obligatorio de la contraseña temporal al primer ingreso.
- Términos y privacidad alimentados por configuración pública con aviso cuando falta contenido aprobado.
- PWA, pantalla offline y assets originales.

### Backend comercial

- Esquema relacional para identidad, clientes, catálogo, precios, pedidos, inventario, compras, finanzas, notificaciones y auditoría.
- RLS, vistas públicas/propias, grants explícitos y funciones `SECURITY DEFINER` restringidas.
- Precio público, lista, excepción por cliente y tramos por volumen habilitables.
- Pedido transaccional, idempotencia, rate limit, bloqueo concurrente y snapshots.
- Transiciones de pedido con reserva, liberación, venta y devolución total.
- Recepción de compras, costo promedio y cuenta por pagar.
- Pagos parciales/completos, cartera y movimientos de caja compatibles.
- Ajustes de inventario auditados.
- Funciones de reportes comerciales y financieros.
- Datos seed marcados como demostración; la identidad Auth técnica incluida usa una contraseña aleatoria irrecuperable y no entrega una credencial conocida.
- Bootstrap productivo separado para roles, lista Pública, métodos y ajustes mínimos.

### Administración

- Dashboard con rangos, métricas, gráficas, rankings y alertas.
- Pedidos, detalle, historial, notas, impresión y transiciones.
- Clientes, detalle, clasificación, condición comercial y precios especiales.
- Productos, listas, matriz de precios y reglas de volumen.
- Inventario/kardex, proveedores, compras, pagos/cartera y gastos.
- Reportes con CSV, Excel compatible y PDF; CSV en listados.
- Usuarios, invitaciones, roles, activación y acceso protegido.
- Notificaciones internas, estado de WhatsApp y reintentos.
- Configuración de negocio, métodos, entrega, legal y metadatos de WhatsApp.

### Operación y calidad

- `netlify.toml`, redirección SPA, CSP y otras cabeceras.
- `.env.example` y plantilla de secretos para funciones.
- Edge Functions `create-order`, `process-whatsapp-outbox` e `invite-staff`.
- Pruebas Vitest de las 20 invariantes comerciales solicitadas y pruebas SQL del backend.
- ESLint, TypeScript, Prettier, build reproducible y documentación 01–09.

## 3. Lo que aún requiere configuración real

Estos puntos no son defectos que deban resolverse con valores inventados:

| Pendiente                                                             | Responsable sugerido         | Evidencia de cierre                                                  |
| --------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Crear proyectos remotos de Supabase y Netlify                         | DevOps/propietario           | URLs y despliegue de ensayo aprobados, sin secretos en documentación |
| Definir dominio final, CORS y redirecciones Auth                      | DevOps                       | Login, recuperación y Edge Functions probados desde dominio final    |
| Cargar catálogo, SKU, costos, stock, tarifas y datos bancarios reales | Administración/contabilidad  | Conciliación firmada contra inventario y política comercial          |
| Crear primer superadministrador y equipo                              | Propietario                  | Acceso probado, contraseña temporal rotada y roles revisados         |
| Configurar correo y proveedor SMS                                     | DevOps                       | Invitación, recuperación y OTP recibidos en pruebas controladas      |
| Aportar credenciales Meta y número oficial                            | Propietario de Meta Business | Token en secretos, nunca en repositorio, envío de ensayo aceptado    |
| Aprobar plantilla transaccional de WhatsApp                           | Negocio/Meta                 | Nombre, idioma y parámetros coinciden con la plantilla aprobada      |
| Activar scheduler del outbox                                          | DevOps                       | Reintento automático observado después de un fallo transitorio       |
| Aprobar términos, privacidad, contacto y retención                    | Responsable legal            | Texto versionado y visible en dominio definitivo                     |
| Definir backups, restauración, monitoreo y alertas                    | DevOps/seguridad             | Simulacro de restauración y alertas de cola/errores documentadas     |
| Ejecutar UAT en dispositivos reales                                   | Negocio/QA                   | Acta con pedido, pago, entrega, cancelación, compra y reporte        |

## 4. Pendientes funcionales o evolutivos reales

No bloquean la arquitectura base, pero deben evaluarse según la operación:

- **Devoluciones parciales:** la función actual procesa devolución total; un flujo por líneas requiere reglas de inventario, reembolso e impuestos.
- **Estados de entrega de Meta:** se registra aceptación de la API, pero no hay webhook para `delivered` o `read`.
- **Carga administrada de imágenes/soportes:** el modelo acepta rutas y URLs; una interfaz completa de carga, antivirus, límites y políticas de Storage debe definirse si el negocio la necesita.
- **Facturación electrónica e impuestos:** no se integra un proveedor fiscal ni se afirma cumplimiento tributario.
- **Pagos en línea:** se registran métodos y recaudos, pero no hay pasarela ni conciliación automática de un adquirente.
- **Clasificación automática de clientes:** existe clasificación administrable; las reglas automáticas avanzadas quedan para una iteración posterior.
- **E2E en navegador y CI/CD remoto:** hay verificaciones locales y SQL; conviene añadir pruebas Playwright y una canalización que bloquee despliegues si fallan.
- **Iconografía PWA definitiva:** el manifiesto reutiliza un activo existente; producción debería usar iconos de marca optimizados en todos los tamaños.
- **Escala analítica:** dashboard y exportaciones tienen límites deliberados para operación pequeña/mediana. Volúmenes altos requerirán paginación server-side, agregados materializados o jobs de exportación.

No implemente estos puntos ocultando sus límites. Registre alcance, criterios de aceptación, migración y pruebas antes de ampliarlos.

## 5. Datos que no deben inventarse

- credenciales, números de WhatsApp y cuentas bancarias;
- costos y existencias iniciales;
- acuerdos de precio, crédito y vencimientos;
- identidad de administradores o clientes;
- contenido legal y consentimiento;
- zonas, tarifas y promesas de entrega;
- políticas de devolución y reembolso;
- certificados de despliegue, seguridad o cumplimiento.

Los marcadores y seed existen para desarrollo. Deben eliminarse o sustituirse mediante un proceso revisado, no una edición apresurada en producción.

## 6. Criterio de “listo para producción”

El proyecto solo debe declararse productivo cuando, sobre el mismo commit y entorno:

1. `lint`, TypeScript, pruebas, migraciones, pruebas SQL y build terminan con código cero;
2. RLS se prueba con visitante, dos clientes diferentes y todos los roles;
3. inventario y precios se concilian con datos reales;
4. pedido, reintento idempotente, cancelación, entrega y concurrencia se validan;
5. compra, costo promedio, pago parcial, cartera, gasto y reportes se concilian;
6. Auth, correo/SMS, dominio, CORS y recuperación funcionan;
7. WhatsApp automático o el proceso manual elegido se prueba sin perder pedidos;
8. backups y restauración se ensayan;
9. legal, seguridad y responsables operativos aprueban;
10. el negocio completa UAT móvil y escritorio.

Hasta entonces, la descripción correcta es **implementación preparada para configuración y validación**, no “sistema ya desplegado” ni “credenciales configuradas”.
