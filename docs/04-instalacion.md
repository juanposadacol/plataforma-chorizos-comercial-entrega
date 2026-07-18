# Instalación y despliegue

Esta guía cubre desarrollo local, un proyecto remoto de Supabase y la publicación del frontend en Netlify. Los valores entre `TU_...` son marcadores: no los copie literalmente ni agregue credenciales reales al repositorio.

## 1. Requisitos

- Node.js `20.19` o superior y npm.
- Git, si el proyecto se administrará como repositorio.
- Para Supabase local: Docker Desktop y Supabase CLI.
- Para un entorno remoto: una cuenta y un proyecto de Supabase.
- Para publicar: un sitio de Netlify y un dominio opcional.
- Para OTP de clientes: proveedor de SMS habilitado en Supabase Auth.
- Para WhatsApp automático: activos aprobados en Meta Business y una plantilla aprobada. WhatsApp puede dejarse en modo manual durante la puesta a punto.

Compruebe las herramientas:

```bash
node --version
npm --version
supabase --version
```

## 2. Instalar dependencias

Desde la raíz del proyecto:

```bash
npm install
npm run typecheck
npm run test
npm run build
```

`npm install` es el comando de compatibilidad solicitado. En automatización, cuando `package-lock.json` no haya cambiado, prefiera `npm ci` para una instalación reproducible.

## 3. Vista local sin backend

Para revisar la interfaz sin crear datos reales, copie `.env.example` a `.env.local` y conserve únicamente:

```dotenv
VITE_ENABLE_DEMO_DATA=true
VITE_APP_URL=http://localhost:5173
```

Después ejecute:

```bash
npm run dev
```

Este modo muestra catálogo de demostración, pero bloquea la creación de pedidos. No valida Supabase, RLS, inventario, correo, SMS ni WhatsApp y debe permanecer desactivado en producción.

## 4. Supabase local

### 4.1 Iniciar y migrar

Con Docker activo:

```bash
supabase start
supabase db reset
supabase status
```

`db reset` recrea la base local, aplica las migraciones en orden y carga `supabase/seed.sql`. El seed es demostrativo. Incluye una identidad administrativa técnica para relaciones y pruebas, pero su contraseña se genera aleatoriamente y no es recuperable ni una credencial conocida para iniciar sesión. Cree su propio administrador local mediante el flujo documentado si necesita entrar al panel.

De `supabase status`, tome la URL local, la clave `anon` y la clave `service_role`. La clave `service_role` se usa solo en procesos locales privilegiados; no se copia al frontend.

### 4.2 Configurar el frontend local

Cree `.env.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=TU_ANON_LOCAL
VITE_APP_URL=http://localhost:5173
VITE_ENABLE_DEMO_DATA=false
```

El prefijo `VITE_` hace que el valor sea legible por el navegador. Por eso **solo** la URL, la clave pública `anon` y valores no sensibles pueden usarlo.

### 4.3 Servir las Edge Functions

Copie `supabase/functions/.env.example` como `supabase/functions/.env.local` y use credenciales locales o marcadores no productivos. Como mínimo:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=TU_ANON_LOCAL
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_LOCAL
ALLOWED_ORIGINS=http://localhost:5173
OUTBOX_WORKER_SECRET=UN_VALOR_LOCAL_ALEATORIO_LARGO
```

WhatsApp puede quedar sin sus tres valores durante el desarrollo; la entrega pasará a respaldo manual.

```bash
supabase functions serve --env-file supabase/functions/.env.local
npm run dev
```

No versionar `.env.local` ni `supabase/functions/.env.local`.

## 5. Crear el proyecto remoto de Supabase

Use primero un proyecto de ensayo; no pruebe migraciones nuevas directamente sobre producción.

### 5.1 Vincular y aplicar el esquema

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push
```

Revise el resultado en Database > Tables y confirme que RLS esté habilitado. `db push` aplica migraciones, pero no es una certificación de que los datos comerciales sean correctos.

La migración de bootstrap productivo crea únicamente referencias indispensables: roles del sistema, lista Pública, formas básicas de pago/entrega y ajustes mínimos. No crea usuarios, clientes, pedidos, credenciales ni inventario. Revise y adapte esos maestros antes de habilitar la tienda.

Si necesita cargar el seed en un entorno de ensayo, hágalo conscientemente con la herramienta SQL o el flujo local de reset. No cargue datos demo en producción.

### 5.2 Configurar Auth

En Authentication > URL Configuration:

- `Site URL`: el dominio definitivo, por ejemplo `https://tienda.ejemplo.com`.
- Redirect URLs: el dominio definitivo y los dominios de vista previa estrictamente necesarios.
- Para recuperación administrativa, permita la ruta `/admin/acceso` del dominio autorizado.

Para el acceso de clientes por OTP, configure un proveedor SMS compatible en Supabase Auth y pruebe números colombianos en formato internacional. Sin proveedor SMS, comprar como visitante sigue siendo posible, pero el inicio de sesión por código no enviará mensajes.

Revise también límites de envío, protección contra abuso, duración de sesión y plantillas de correo/SMS antes de producción.

### 5.3 Configurar secretos de Edge Functions

Genere un secreto de alta entropía para el worker; no reutilice contraseñas ni tokens de Meta.

```bash
supabase secrets set \
  ALLOWED_ORIGINS=https://TU_DOMINIO \
  OUTBOX_WORKER_SECRET=TU_SECRETO_ALEATORIO \
  WHATSAPP_ACCESS_TOKEN=TU_TOKEN_DE_META \
  WHATSAPP_PHONE_NUMBER_ID=TU_PHONE_NUMBER_ID \
  WHATSAPP_GRAPH_API_VERSION=v23.0 \
  WHATSAPP_TEMPLATE_NAME=TU_PLANTILLA_APROBADA \
  WHATSAPP_TEMPLATE_LANGUAGE=es_CO \
  STAFF_INVITE_REDIRECT_URL=https://TU_DOMINIO/admin/acceso
```

Puede omitir temporalmente los valores `WHATSAPP_*`; el pedido se guardará y la entrega quedará marcada para manejo manual. `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` son suministradas por el entorno de Supabase a sus funciones alojadas.

Despliegue las funciones:

```bash
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy process-whatsapp-outbox --no-verify-jwt
supabase functions deploy invite-staff --no-verify-jwt
```

`create-order` admite visitantes, por lo que valida por sí misma origen, contrato, sesión opcional y límite de solicitudes. `process-whatsapp-outbox` exige `x-outbox-secret`. `invite-staff` exige una sesión administrativa dentro de la función y reserva la asignación de `superadmin` a otro superadministrador. No quite estas validaciones aunque las funciones se desplieguen con `--no-verify-jwt`.

### 5.4 Programar la cola de WhatsApp

La creación del pedido intenta despertar el worker, pero los reintentos requieren una llamada periódica del lado servidor. Configure Supabase Cron, un scheduler de confianza o una función equivalente para ejecutar, aproximadamente cada minuto:

```http
POST https://TU_PROJECT_REF.supabase.co/functions/v1/process-whatsapp-outbox
Content-Type: application/json
x-outbox-secret: TU_SECRETO_ALEATORIO

{"limit":10}
```

No programe esta llamada desde el navegador y no incluya el secreto en una URL. Compruebe en `notification_deliveries` que los registros pasan de `pending` a `sent`, `retrying`, `manual_required` o `failed`.

## 6. Crear el primer superadministrador

Hágalo después de aplicar las migraciones. Hay dos procedimientos; use uno, no ambos.

### Opción A: script local

Exponga temporalmente las variables solo en la terminal desde la que ejecutará el script. En PowerShell:

```powershell
$env:VITE_SUPABASE_URL='https://TU_PROJECT_REF.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='TU_SERVICE_ROLE'
npm run admin:create -- admin@tu-dominio.com "Nombre del administrador"
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
Remove-Item Env:VITE_SUPABASE_URL
```

El script crea el usuario, su perfil y el rol `superadmin`, e imprime una contraseña temporal una sola vez. Guárdela en un gestor de contraseñas e inicie sesión en `/admin/acceso`. La ruta protegida obligará a definir una contraseña nueva de al menos 12 caracteres antes de abrir el panel y retirará la marca de primer ingreso. No capture ni pegue la salida temporal en tickets, chats o documentación.

Si el proceso falla, confirme que las migraciones estén aplicadas y que exista el rol `superadmin`. No coloque la `service_role` en `.env.local` del frontend ni en Netlify.

### Opción B: Supabase Dashboard y SQL

1. Cree el usuario de correo en Authentication > Users.
2. Copie su UUID, no su contraseña.
3. Ejecute como propietario en SQL Editor, sustituyendo los marcadores:

```sql
insert into public.profiles (id, full_name, email, is_active)
values ('UUID_AUTH', 'Nombre del administrador', 'admin@tu-dominio.com', true)
on conflict (id) do update
set full_name = excluded.full_name,
    email = excluded.email,
    is_active = true,
    deleted_at = null;

insert into public.user_roles (profile_id, role_id)
select 'UUID_AUTH', id
from public.roles
where code = 'superadmin'
on conflict do nothing;
```

Verifique el acceso con una ventana privada. La existencia de un usuario en Auth sin fila activa en `profiles` y sin `user_roles` no concede acceso administrativo.

## 7. Publicar el frontend en Netlify

El repositorio ya incluye `netlify.toml` con:

- build: `npm run build`;
- publicación: `dist`;
- Node 20;
- redirección SPA hacia `index.html`;
- cabeceras de seguridad y caché para assets.

En el sitio de Netlify configure únicamente:

```text
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_PUBLICA
VITE_APP_URL=https://TU_DOMINIO
VITE_ENABLE_DEMO_DATA=false
```

No agregue allí `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `OUTBOX_WORKER_SECRET` ni credenciales de WhatsApp. En esta arquitectura pertenecen al CLI local o a los secretos de Supabase.

Antes de promover el sitio:

1. ejecute `npm run build` localmente;
2. publique primero una vista de ensayo;
3. agregue su URL exacta a `ALLOWED_ORIGINS` y a las redirecciones de Supabase Auth;
4. pruebe acceso, catálogo, pedido, seguimiento, administración y recuperación de contraseña;
5. asigne el dominio definitivo y repita la configuración con el dominio final.

Esta guía describe el procedimiento; no implica que un sitio de Netlify o proyecto de Supabase ya hayan sido creados.

## 8. Verificación de instalación

Ejecute:

```bash
npm run lint
npm run typecheck
npm run test
npm run format:check
npm run build
supabase db lint --level error
supabase test db
deno check supabase/functions/create-order/index.ts
deno check supabase/functions/process-whatsapp-outbox/index.ts
```

Luego realice el recorrido manual de [docs/08-pruebas.md](08-pruebas.md). Un build exitoso no sustituye la validación de RLS, datos reales, inventario concurrente ni servicios externos.

## 9. Lista de salida a producción

- [ ] Proyecto de Supabase de producción creado y migrado.
- [ ] Datos demo excluidos; catálogo, precios, costos y existencias conciliados.
- [ ] Primer superadministrador creado y contraseña temporal rotada.
- [ ] Roles del equipo revisados con mínimo privilegio.
- [ ] Dominio final registrado en Netlify, Supabase Auth y `ALLOWED_ORIGINS`.
- [ ] OTP SMS probado o acceso de clientes comunicado como no disponible.
- [ ] Textos legales y consentimiento aprobados para Colombia.
- [ ] Copias de seguridad, recuperación, monitoreo y alertas definidos.
- [ ] Scheduler de outbox activo y observado.
- [ ] WhatsApp automático probado con plantilla aprobada, o respaldo manual aceptado.
- [ ] Flujo de pedido, cancelación, entrega, compra, pago y reporte probado con datos de ensayo.
- [ ] `lint`, `typecheck`, pruebas y build ejecutados sobre el mismo commit a publicar.
