# Seguridad y WhatsApp

La plataforma adopta dos reglas: el servidor es la autoridad comercial y un fallo de mensajería nunca revierte ni elimina un pedido. Esta guía describe la configuración prevista; no significa que existan credenciales de Meta, Supabase o un número productivo ya habilitados.

## 1. Fronteras de confianza

```text
Navegador
  ├─ clave anon pública + sesión del usuario
  ├─ IDs, cantidades y datos de entrega
  └─ nunca service role, costos internos ni tokens de Meta
        ↓
Edge Function create-order
  ├─ valida CORS, tamaño, Zod, sesión opcional y rate limit
  └─ llama una función PostgreSQL con service role
        ↓
PostgreSQL
  ├─ identifica cliente y precio autorizado
  ├─ bloquea inventario y crea pedido transaccional
  └─ crea notificación y entrega en outbox
        ↓ commit completado
Worker process-whatsapp-outbox
  ├─ exige secreto propio
  ├─ reclama trabajos con lease y SKIP LOCKED
  └─ llama la API oficial de Meta o marca respaldo manual
```

Ni el total estimado del frontend ni un texto de WhatsApp son documentos autoritativos. La fuente histórica es PostgreSQL.

## 2. Inventario de credenciales

| Valor                       | Sensibilidad           | Ubicación correcta                              | Nunca ubicar en                                         |
| --------------------------- | ---------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `VITE_SUPABASE_URL`         | Pública                | `.env.local` y variables de build de Netlify    | No aplica; valide que apunte al proyecto correcto       |
| `VITE_SUPABASE_ANON_KEY`    | Pública con RLS        | `.env.local` y Netlify                          | No usar como sustituto de autorización                  |
| `VITE_APP_URL`              | Pública                | `.env.local` y Netlify                          | —                                                       |
| `SUPABASE_ACCESS_TOKEN`     | Secreta                | sesión/almacén local del CLI                    | navegador, repositorio, Netlify frontend                |
| `SUPABASE_SERVICE_ROLE_KEY` | Crítica, omite RLS     | Supabase Edge Runtime o terminal local temporal | variables `VITE_`, JS, panel de configuración, capturas |
| `OUTBOX_WORKER_SECRET`      | Crítica                | secretos de Supabase y scheduler servidor       | URL, navegador, logs, `app_settings`                    |
| `WHATSAPP_ACCESS_TOKEN`     | Crítica                | secretos de Supabase                            | `whatsapp_settings`, Netlify frontend, repositorio      |
| `WHATSAPP_PHONE_NUMBER_ID`  | Operativa sensible     | secretos de Supabase                            | componentes del navegador                               |
| `STAFF_INVITE_REDIRECT_URL` | No secreta, controlada | secretos/configuración de Edge Functions        | valor abierto recibido del navegador                    |

La clave `anon` es pública por diseño; la seguridad depende de privilegios SQL, RLS y funciones autorizadas. La `service_role` no es una “clave más fuerte para arreglar RLS”: usarla en el cliente destruye la separación de acceso.

No copie `.env.example` con valores reales al control de versiones. Los archivos locales deben permanecer ignorados.

## 3. RLS y autorización

Las migraciones habilitan Row Level Security en todas las tablas base expuestas.

- Visitantes consultan proyecciones públicas y funciones específicas de catálogo, opciones y configuración.
- Un cliente autenticado accede a sus proyecciones de perfil, direcciones, pedidos, pagos y cartera; no a las filas de otros clientes.
- Costos, márgenes, compras, gastos, configuración privada y auditoría no forman parte de las proyecciones de cliente.
- `superadmin` y `admin` administran las tablas comerciales autorizadas.
- `vendedor`, `bodega` y `contabilidad` reciben lecturas o mutaciones limitadas por área y funciones transaccionales.
- `service_role` omite RLS y por ello solo se usa en funciones de servidor y tareas controladas.

Las funciones `SECURITY DEFINER` fijan `search_path`, validan rol o propiedad y revocan ejecución general. Las operaciones sensibles —crear pedido, transicionar estados, recibir compra, registrar pago, ajustar inventario, asignar roles y procesar outbox— no se reemplazan por escrituras directas desde el navegador.

### Verificación mínima

En un proyecto de ensayo, compruebe RLS con sesiones separadas, no solo desde SQL Editor como propietario:

1. visitante: catálogo y seguimiento válido, sin lectura de tablas privadas;
2. cliente A: pedidos de A, rechazo al pedir datos de B;
3. vendedor: flujo comercial permitido, finanzas privadas restringidas;
4. bodega: ajustes/estados logísticos permitidos, asignación de precios restringida;
5. contabilidad: finanzas autorizadas, gobierno de superadministradores restringido;
6. administrador: gestión esperada;
7. cuenta desactivada o sin rol: rechazo del panel.

`supabase test db` cubre políticas automatizadas incluidas, pero la revisión con tokens reales sigue siendo obligatoria antes de producción.

## 4. Protección al crear pedidos

`create-order` se despliega sin verificación JWT de plataforma porque acepta compras de visitantes. La función implementa sus propios controles:

- solo `POST` y preflight `OPTIONS`;
- lista explícita `ALLOWED_ORIGINS` para navegadores;
- JSON máximo de 64 KiB;
- contrato Zod estricto;
- identificador UUID de idempotencia;
- verificación de sesión si llega un token distinto de la clave `anon`;
- límite de 12 solicitudes por sujeto en cinco minutos;
- mensajes públicos sin detalles internos de PostgreSQL;
- service role confinada al runtime.

La función descarta o rechaza campos de precio, descuento y total. PostgreSQL bloquea los productos en un orden estable, recalcula precios y solo confirma si toda la transacción termina.

Configure `ALLOWED_ORIGINS` con orígenes exactos, separados por comas:

```text
https://tienda.ejemplo.com,https://www.tienda.ejemplo.com
```

No use `*` en producción. Actualice este valor cuando cambie el dominio y retire vistas previas antiguas.

## 5. Arquitectura de WhatsApp

### Guardado primero

Al crear un pedido, la transacción genera:

1. `orders` y `order_items`;
2. reservas e historial;
3. una `notification` interna;
4. una `notification_delivery` para WhatsApp;
5. un enlace `wa.me` de respaldo cuando hay número disponible.

El commit ocurre antes de llamar a Meta. Por eso una indisponibilidad, token vencido o plantilla rechazada no elimina la compra.

### Procesamiento

`process-whatsapp-outbox`:

1. compara `x-outbox-secret` sin una comparación de texto trivial;
2. reclama entre 1 y 50 entregas elegibles;
3. evita que dos workers procesen la misma fila mediante lease y `FOR UPDATE SKIP LOCKED`;
4. envía una plantilla a WhatsApp Business Cloud;
5. guarda identificador externo y una respuesta reducida;
6. reintenta errores transitorios con espera exponencial;
7. pasa a `manual_required` si no hay proveedor configurado y existe respaldo;
8. marca `failed` cuando no hay otra ruta.

`sent` significa que la API aceptó la solicitud y devolvió un ID. Esta versión no incorpora un webhook de estados `delivered` o `read`; no interprete `sent` como lectura por el destinatario.

## 6. Preparar Meta Business

Antes de habilitar `automatic_enabled`:

1. use una cuenta empresarial autorizada y verificada según corresponda;
2. registre el número emisor y obtenga su `phone_number_id`;
3. cree una plantilla transaccional para nuevo pedido al administrador;
4. mantenga el orden de parámetros igual al generado por el backend;
5. use idioma `es_CO` o el código exacto aprobado;
6. emita un token de servidor con el alcance mínimo y rotación definida;
7. pruebe primero con números autorizados y un proyecto de ensayo;
8. documente propietario, caducidad y procedimiento de renovación del token.

No active comunicaciones promocionales con esta integración. La finalidad implementada es operativa y transaccional.

## 7. Configurar Supabase

Guarde secretos con CLI o el panel seguro de Supabase:

```bash
supabase secrets set \
  ALLOWED_ORIGINS=https://TU_DOMINIO \
  OUTBOX_WORKER_SECRET=TU_SECRETO_ALEATORIO_LARGO \
  WHATSAPP_ACCESS_TOKEN=TU_TOKEN_DE_SERVIDOR \
  WHATSAPP_PHONE_NUMBER_ID=TU_PHONE_NUMBER_ID \
  WHATSAPP_GRAPH_API_VERSION=v23.0 \
  WHATSAPP_TEMPLATE_NAME=TU_PLANTILLA_APROBADA \
  WHATSAPP_TEMPLATE_LANGUAGE=es_CO \
  STAFF_INVITE_REDIRECT_URL=https://TU_DOMINIO/admin/acceso
```

Después despliegue:

```bash
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy process-whatsapp-outbox --no-verify-jwt
supabase functions deploy invite-staff --no-verify-jwt
```

La función de invitación, aunque use `--no-verify-jwt`, valida una sesión administrativa dentro de la función, limita solicitudes y exige `superadmin` para invitar otro superadministrador.

En el panel `/admin/configuracion`, la fila de WhatsApp solo debe contener metadatos no secretos: proveedor, teléfonos, nombre/idioma de plantilla, reintentos y banderas. El token real nunca se guarda en esa tabla.

## 8. Scheduler obligatorio para reintentos

El intento oportunista después de crear un pedido reduce latencia, pero no reemplaza un scheduler. Configure una llamada servidor a servidor, por ejemplo cada minuto:

```bash
curl --request POST \
  'https://TU_PROJECT_REF.supabase.co/functions/v1/process-whatsapp-outbox' \
  --header 'content-type: application/json' \
  --header 'x-outbox-secret: TU_SECRETO' \
  --data '{"limit":10}'
```

El ejemplo es para una consola segura; no lo coloque en scripts públicos ni historial compartido. Prefiera el almacén secreto del scheduler.

Vigile:

- edad del registro pendiente más antiguo;
- cantidad en `retrying`, `manual_required` y `failed`;
- errores 401 del worker, que suelen indicar secreto incorrecto;
- errores 400/404 de Meta, que suelen indicar plantilla, idioma, número o versión;
- errores 429/5xx, que pueden ser transitorios;
- vencimiento del token.

## 9. Respaldo manual

Cuando el automático no está disponible, la confirmación puede mostrar un enlace `wa.me` creado con datos ya guardados. El operador debe:

1. comprobar que el consecutivo existe;
2. revisar el destinatario oficial;
3. enviar una sola vez;
4. no añadir datos personales innecesarios;
5. registrar la atención según el proceso interno.

Un enlace manual puede quedar en historial del navegador o de WhatsApp. Use dispositivos corporativos protegidos, bloqueo de pantalla y políticas de retención. El respaldo no debe emplearse para campañas.

## 10. Cabeceras, PWA y navegador

`netlify.toml` declara CSP, `X-Content-Type-Options`, `X-Frame-Options`, política de referencia y restricciones de cámara, micrófono y geolocalización. Si se agregan dominios de imágenes o APIs, amplíe la CSP de manera específica; no la desactive globalmente.

La PWA almacena shell e imágenes, no decisiones financieras. Los tokens de sesión se gestionan por Supabase en el navegador; cerrar sesión en equipos compartidos es obligatorio. Un service worker no debe interceptar una confirmación offline como si hubiera sido aceptada.

Los tokens de seguimiento son opacos y únicos, pero funcionan como secretos de enlace. No los incluya en analítica, logs públicos o canales masivos.

## 11. Rotación y respuesta a incidentes

### Si se expone la service role

1. revoque o rote inmediatamente la clave en Supabase;
2. actualice las Edge Functions y procesos autorizados;
3. revise Auth, auditoría, cambios de datos y logs desde el momento de exposición;
4. elimine el secreto del historial del repositorio, no solo del último commit;
5. trate cualquier dato accesible como potencialmente comprometido.

### Si se expone un token de Meta

1. revoque el token en Meta;
2. genere otro con alcance mínimo;
3. actualice el secreto de Supabase;
4. redepliegue o reinicie el entorno si corresponde;
5. revise mensajes y actividad del número.

### Si se expone `OUTBOX_WORKER_SECRET`

1. genere otro valor aleatorio;
2. actualícelo en Supabase y en el scheduler de forma coordinada;
3. revise invocaciones y entregas anómalas;
4. no reutilice el valor anterior.

Registre el incidente fuera de notas de cliente y sin copiar secretos a la bitácora.

## 12. Lista de seguridad antes de producción

- [ ] Ningún archivo rastreado contiene claves o tokens reales.
- [ ] Netlify solo tiene variables públicas `VITE_` necesarias.
- [ ] `ALLOWED_ORIGINS` contiene dominios exactos y no `*`.
- [ ] RLS fue probada con visitante, cliente y cada rol de personal.
- [ ] El primer administrador completó el cambio forzado de la contraseña temporal y usa una credencial única.
- [ ] El proveedor SMS y los límites OTP fueron revisados.
- [ ] El token de Meta tiene propietario y fecha de rotación.
- [ ] La plantilla y sus parámetros fueron aprobados y probados.
- [ ] El worker exige un secreto independiente y el scheduler lo protege.
- [ ] Se monitorean fallos, reintentos y antigüedad de la cola.
- [ ] Copias de seguridad y restauración fueron ensayadas.
- [ ] Textos legales, consentimiento y retención fueron aprobados.
- [ ] Exportaciones y dispositivos administrativos tienen controles de acceso.
