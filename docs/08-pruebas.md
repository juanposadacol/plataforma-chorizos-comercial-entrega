# Pruebas y aceptación

La calidad se valida en capas. Una prueba de fórmula en TypeScript no demuestra RLS ni concurrencia PostgreSQL; un `build` exitoso no demuestra SMS, Meta o el dominio final. Antes de producción deben completarse todas las capas aplicables.

## 1. Capas de prueba

| Capa             | Herramienta                     | Qué demuestra                                                                  |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| Estática         | ESLint, TypeScript, Prettier    | Imports, tipos, reglas de código y formato                                     |
| Dominio frontend | Vitest                          | Las 20 invariantes solicitadas en funciones puras y contratos del cliente      |
| Base de datos    | Supabase CLI y pgTAP/SQL        | Migraciones, funciones, restricciones, RLS y efectos transaccionales cubiertos |
| Edge Functions   | Deno check y pruebas de ensayo  | Tipos, contrato HTTP, CORS, Auth, rate limit y outbox                          |
| Integración      | Supabase local/remoto de ensayo | React, Auth, Realtime, PostgreSQL y Functions conectados                       |
| Aceptación       | Navegador móvil/escritorio      | Flujo completo, accesibilidad básica y servicios externos reales               |

## 2. Preparación

Requisitos:

- Node.js `>=20.19`;
- dependencias instaladas;
- Docker y Supabase CLI para pruebas SQL;
- Deno para comprobación directa de Edge Functions;
- un proyecto remoto **de ensayo**, no producción, para SMS, correo, Realtime y Meta.

```bash
npm install
supabase start
supabase db reset
```

`db reset` aplica las migraciones y carga `supabase/seed.sql`. El seed es de demostración e incluye una identidad administrativa técnica con contraseña aleatoria irrecuperable para sostener relaciones y pruebas; no es una credencial de acceso entregada. Cree identidades de prueba separadas cuando valide RLS o el panel.

## 3. Puerta rápida del frontend

Ejecute desde la raíz:

```bash
npm run lint
npm run typecheck
npm run test
npm run format:check
npm run build
```

Todos deben terminar con código `0`. `npm run test` ejecuta Vitest una vez; `npm run test:watch` sirve para desarrollo.

La suite `src/domain/commerce.test.ts` nombra y ejercita las 20 invariantes comerciales: precios, saneamiento de payload, persistencia antes de notificar, inventario, snapshots, pagos, utilidad, rankings y acceso. Son pruebas unitarias deliberadamente rápidas; no sustituyen las pruebas de las funciones SQL con datos reales.

El build debe generar `dist/`, el manifiesto PWA, el service worker y la página offline. Una advertencia de tamaño de chunk no equivale por sí sola a un fallo, pero debe vigilarse si afecta el desempeño real.

## 4. Base de datos

Con Supabase local activo:

```bash
supabase db lint --level error
supabase test db
```

La suite `supabase/tests/transactional_api_test.sql` contiene 20 aserciones y debe ejecutarse sobre una base local desechable. Cubre la precedencia de precios, protección de un celular registrado, valores del frontend ignorados, idempotencia, reserva/cancelación, recepción y costo promedio, saldo de pago parcial, tracking sin costos, ranking de producto, snapshots y aislamiento RLS básico. Revise el total planeado, el total ejecutado y cualquier `not ok`; no acepte una salida parcial solo porque el proceso continúe.

Las comprobaciones HTTP de Edge Functions, Realtime, correo/SMS y WhatsApp enumeradas más adelante son de integración o aceptación; no están incluidas automáticamente en `supabase test db`.

Después de cambiar una migración:

1. ejecute `supabase db reset` desde cero;
2. ejecute el lint SQL;
3. ejecute toda la suite SQL, no solo el archivo modificado;
4. confirme que el seed se puede cargar mediante un nuevo reset;
5. inspeccione que RLS siga habilitado en todas las tablas expuestas.

No modifique una migración ya aplicada en producción. Cree una migración nueva y pruebe actualización más restauración.

## 5. Edge Functions

Compruebe tipos:

```bash
deno check supabase/functions/create-order/index.ts
deno check supabase/functions/process-whatsapp-outbox/index.ts
deno check supabase/functions/invite-staff/index.ts
```

Sirva el entorno local:

```bash
supabase functions serve --env-file supabase/functions/.env.local
```

Casos HTTP mínimos para `create-order`:

- `OPTIONS` devuelve preflight sin crear registros;
- método distinto de `POST` devuelve 405;
- origen no permitido devuelve 403;
- JSON inválido devuelve 400;
- payload mayor de 64 KiB devuelve 413;
- campos desconocidos o IDs inválidos devuelven 422;
- clave de idempotencia inválida devuelve 400;
- demasiadas solicitudes devuelven 429;
- sesión inválida devuelve 401;
- inventario insuficiente devuelve 409;
- solicitud válida devuelve 201 con consecutivo, total y token.

Casos mínimos para `process-whatsapp-outbox`:

- sin `x-outbox-secret` o con valor incorrecto devuelve 401;
- método distinto de `POST` devuelve 405;
- sin credenciales Meta, la entrega queda en respaldo manual sin borrar el pedido;
- error transitorio programa reintento;
- éxito guarda `external_id` y `sent_at`;
- dos workers no reclaman la misma entrega.

Casos mínimos para `invite-staff`:

- visitante y cliente reciben rechazo;
- administrador puede invitar roles permitidos;
- solo superadministrador puede asignar `superadmin`;
- payload inválido y exceso de invitaciones se rechazan;
- si falla la provisión de roles no queda una cuenta invitada sin el acceso seleccionado.

No use tokens productivos para pruebas automatizadas.

## 6. Matriz de las 20 invariantes

La columna “aceptación” indica la comprobación que debe hacerse además de la prueba unitaria.

|   # | Invariante                          | Aceptación en backend/integración                                                                                               |
| --: | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Cliente nuevo recibe precio público | Crear pedido con celular inexistente; verificar lista pública y snapshot de precio                                              |
|   2 | Cliente existente recibe su lista   | Asignar lista distinta, autenticar al cliente y comprobar precio resuelto; un visitante no debe suplantarlo solo con su celular |
|   3 | Precio especial prevalece           | Crear excepción vigente y verificar `price_source` y valor del detalle                                                          |
|   4 | Cliente no escoge lista             | Inyectar `price_list_id`; el contrato debe rechazar/ignorar y RLS impedir el cambio                                             |
|   5 | Precio manipulado se ignora         | Enviar `unit_price`/`total` falsos; no deben llegar al contrato ni al pedido                                                    |
|   6 | Pedido se guarda antes de WhatsApp  | Apagar worker, crear pedido y comprobar orden/outbox persistidos                                                                |
|   7 | Fallo de WhatsApp conserva pedido   | Usar credenciales ausentes/erróneas y consultar el mismo pedido y reserva                                                       |
|   8 | Pedido aparece en tiempo real       | Abrir panel y tienda en sesiones separadas; crear pedido y comprobar recarga                                                    |
|   9 | Cancelación libera reserva          | Cancelar con motivo; comparar stock físico, reservado y movimiento                                                              |
|  10 | Entrega descuenta inventario        | Recorrer estados hasta entregado y comprobar salida, costo e historial                                                          |
|  11 | Compra recibida incrementa stock    | Recibir una compra y comprobar kardex, costo promedio y saldo proveedor                                                         |
|  12 | Solo uno compra la última unidad    | Lanzar dos solicitudes concurrentes contra stock disponible 1; una debe fallar                                                  |
|  13 | Cambio de precio no altera historia | Crear pedido, cambiar maestro y comparar snapshot anterior                                                                      |
|  14 | Pago parcial actualiza saldo        | Registrar abono menor al total y verificar pedido, cartera y cliente                                                            |
|  15 | Gasto afecta utilidad neta          | Comparar reporte antes/después del gasto; bruta igual, neta menor                                                               |
|  16 | Identifica producto más vendido     | Crear ventas entregadas conocidas y comparar ranking                                                                            |
|  17 | Identifica cliente que más compra   | Crear compras entregadas conocidas y comparar ranking/frecuencia                                                                |
|  18 | Cliente no ve información ajena     | Con token de A solicitar pedido/dirección de B; esperar cero filas o 403                                                        |
|  19 | Sin permiso no entra al panel       | Cuenta `customer` o sin rol debe ser rechazada por ruta y backend                                                               |
|  20 | Costo promedio ponderado correcto   | Recibir cantidad/costo conocidos y comparar fórmula con el producto                                                             |

## 7. Prueba de concurrencia

Este caso no se valida haciendo dos clics secuenciales.

1. En una base de ensayo, deje un producto activo con existencia 1, reservado 0 y sin backorder.
2. Prepare dos clientes y dos claves de idempotencia distintas.
3. Envíe las dos solicitudes válidas casi simultáneamente desde procesos separados.
4. Espere ambas respuestas.
5. Debe existir un solo pedido nuevo para ese producto; la otra respuesta debe indicar falta de inventario.
6. Compruebe `stock_reserved = 1`, una reserva activa y ausencia de saldos negativos.
7. Repita varias veces después de cancelar y liberar la reserva.

Si ambas solicitudes se aprueban, detenga la salida a producción. No lo compense ocultando stock en la interfaz.

## 8. Pruebas de RLS

Cree al menos:

- dos clientes Auth enlazados a clientes A y B;
- un usuario por rol de personal;
- una cuenta Auth sin perfil/rol;
- una sesión anónima.

Pruebe con la clave `anon` y el JWT de cada sesión. No use SQL Editor ni service role para demostrar restricciones de un cliente, porque ambas pueden omitir el contexto real.

Verifique:

- A no consulta datos, direcciones, pedidos, pagos o cartera de B;
- ningún cliente obtiene costos, márgenes, listas completas, precios especiales ajenos, compras, gastos o configuración privada;
- un rol operativo solo ejecuta las transiciones de su etapa;
- un administrador no puede crear otro superadministrador si la regla exige superadmin;
- desactivar perfil o rol revoca acceso efectivo;
- seguimiento con token inválido no filtra si el pedido existe.

## 9. Pruebas de WhatsApp

### Sin integración

Deje ausentes los secretos `WHATSAPP_*`, cree un pedido y compruebe:

- pedido y reserva presentes;
- notificación interna presente;
- entrega en `manual_required` después del worker;
- enlace manual con consecutivo y total guardados;
- panel y seguimiento funcionando.

### Error transitorio

En ensayo use una condición controlada que produzca timeout, 429 o 5xx. Compruebe que el intento aumenta una vez, queda `retrying` y `next_attempt_at` aplica espera; el scheduler debe retomarlo sin duplicar pedido.

### Éxito real de ensayo

Use una plantilla aprobada y un número autorizado. Compruebe ID externo y recepción. Recuerde que `sent` acredita aceptación de la API, no `delivered` o `read`, porque esta versión no procesa webhooks de estado.

## 10. Recorrido de aceptación manual

Ejecute al menos en un teléfono angosto y un navegador de escritorio:

1. abrir tienda, buscar, filtrar y cambiar cantidades;
2. recargar y comprobar carrito;
3. validar errores de formulario y consentimiento;
4. comprar como visitante;
5. copiar y abrir seguimiento;
6. iniciar sesión por OTP y ver precio/historial propios;
7. repetir un pedido y confirmar que se recalcula;
8. ver el pedido en el panel;
9. transicionar, cancelar y entregar pedidos de prueba separados;
10. recibir compra, ajustar stock y registrar pago/gasto;
11. generar cada reporte y abrir CSV, `.xls` y PDF;
12. probar cambio forzado del primer ingreso, invitación, recuperación y cierre de sesión;
13. forzar fallo de WhatsApp y usar respaldo;
14. instalar PWA, abrir offline y confirmar que no permite crear pedido;
15. revisar teclado, foco, contraste, tablas móviles, cargas, errores y estados vacíos.

Pruebe la impresión del detalle, caracteres como tildes y `ñ`, valores COP grandes, límite de fechas en `America/Bogota` y archivos exportados con contenido no confiable.

## 11. Reporte de ejecución

Conserve por cada candidato a despliegue:

```text
Commit/versión:
Fecha y responsable:
Node/npm/Supabase CLI/Deno:
Entorno de ensayo:
npm run lint:
npm run typecheck:
npm run test:
npm run format:check:
npm run build:
supabase db reset:
supabase db lint:
supabase test db:
deno check (3 funciones):
Prueba de concurrencia:
Prueba RLS multiusuario:
Prueba SMS/correo:
Prueba WhatsApp o respaldo:
UAT móvil/escritorio:
Incidencias abiertas:
Decisión de promover:
```

No copie claves, JWT, celulares reales ni datos personales en el reporte.

## 12. Criterios de bloqueo

No despliegue o no habilite pedidos reales si ocurre cualquiera:

- falla lint, tipos, pruebas, migración o build;
- una política RLS permite lectura cruzada;
- el navegador puede imponer precio o lista;
- dos pedidos reservan la última unidad;
- una cancelación/entrega deja inventario inconsistente;
- un reintento duplica pedido, pago o recepción;
- un fallo de WhatsApp elimina o revierte el pedido;
- no existe recuperación probada, administrador responsable o backup;
- textos legales, datos reales o responsables operativos siguen sin aprobar.
