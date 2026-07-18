# Plataforma comercial de chorizos

Aplicación web en español para vender chorizos artesanales y administrar pedidos, clientes, precios, inventario, compras, pagos, gastos, notificaciones y reportes. Conserva la identidad visual y las fotografías del sitio original, pero reemplaza el pedido efímero por una operación persistente en Supabase.

> **Estado de entrega:** el código y la infraestructura declarativa están preparados para configurarse, probarse y desplegarse. Este repositorio no contiene credenciales reales ni acredita que exista un despliegue productivo. Antes de operar se deben cargar datos reales, configurar los servicios externos y completar la lista de salida a producción.

## Qué incluye

- Tienda responsiva con catálogo, búsqueda, filtros, carrito persistente, checkout y seguimiento mediante token opaco.
- Identificación de clientes por celular y acceso opcional con OTP de Supabase Auth.
- Precios público, por lista, especiales por cliente y tramos por volumen configurables.
- Creación transaccional de pedidos: el servidor recalcula precios, valida existencias, crea snapshots y reserva inventario.
- Panel privado con pedidos, clientes, productos, precios, inventario, compras, proveedores, pagos, gastos, reportes, usuarios, notificaciones y configuración.
- Kardex, recepción de compras, costo promedio, cartera, caja, auditoría y conservación histórica.
- Cola de notificaciones y Edge Function para WhatsApp Business Cloud, con enlace manual de respaldo.
- Exportaciones CSV, Excel compatible (`.xls`) y PDF desde reportes; exportación CSV en listados administrativos compatibles.
- PWA instalable con caché de recursos estáticos y una pantalla sin conexión. Confirmar precios o pedidos siempre requiere conexión.
- Migraciones PostgreSQL, RLS, datos de demostración, pruebas unitarias y pruebas de base de datos.

## Regla de seguridad principal

El navegador nunca decide el precio final. Solo envía identificadores, cantidades y datos de entrega. La función transaccional de PostgreSQL aplica, en orden:

1. precio especial vigente del cliente y producto;
2. precio por volumen, si la función está habilitada y coincide un tramo;
3. precio de la lista asignada al cliente;
4. precio público.

Después valida inventario, guarda el pedido y sus snapshots, reserva existencias y crea la notificación. WhatsApp ocurre después del `commit`; si falla, el pedido permanece guardado.

## Tecnologías

- React 19, Vite 8, TypeScript, React Router y Tailwind CSS.
- React Hook Form, Zod, TanStack Query, Recharts y jsPDF.
- Supabase Auth, PostgreSQL, RLS, Realtime y Edge Functions.
- Netlify para servir el frontend estático y resolver las rutas SPA.
- Vitest, ESLint y Prettier para control de calidad.

## Inicio rápido

Requiere Node.js `>=20.19`.

```bash
npm install
npm run dev
```

Sin variables de Supabase, la tienda muestra un estado de configuración pendiente. Para revisar únicamente la interfaz con datos locales de demostración, cree `.env.local` con:

```dotenv
VITE_ENABLE_DEMO_DATA=true
```

El modo demostración es de solo lectura: **no crea pedidos y no debe habilitarse en producción**. Para una instalación funcional, siga [docs/04-instalacion.md](docs/04-instalacion.md).

## Variables y secretos

El frontend solo necesita valores publicables:

```dotenv
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_ANON_PUBLICA
VITE_APP_URL=https://TU_DOMINIO
VITE_ENABLE_DEMO_DATA=false
```

`SUPABASE_SERVICE_ROLE_KEY`, `OUTBOX_WORKER_SECRET`, `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` son secretos de servidor. Nunca deben llevar prefijo `VITE_`, guardarse en el repositorio ni configurarse como variables del frontend en Netlify. Consulte [docs/07-seguridad-whatsapp.md](docs/07-seguridad-whatsapp.md).

## Comandos

| Comando                                 | Propósito                                     |
| --------------------------------------- | --------------------------------------------- |
| `npm run dev`                           | Servidor local de Vite                        |
| `npm run lint`                          | Análisis estático sin advertencias permitidas |
| `npm run typecheck`                     | Comprobación de TypeScript                    |
| `npm run test`                          | Pruebas unitarias con Vitest                  |
| `npm run build`                         | Compilación de producción en `dist/`          |
| `npm run preview`                       | Vista local de `dist/`                        |
| `npm run format:check`                  | Verificación de formato                       |
| `npm run admin:create -- correo nombre` | Creación controlada del primer administrador  |

Las comprobaciones de PostgreSQL y Edge Functions se describen en [docs/08-pruebas.md](docs/08-pruebas.md).

## Documentación

1. [Diagnóstico del proyecto original](docs/01-diagnostico-original.md)
2. [Arquitectura y flujos](docs/02-arquitectura-y-flujos.md)
3. [Modelo de datos](docs/03-modelo-de-datos.md)
4. [Instalación y despliegue](docs/04-instalacion.md)
5. [Manual administrativo](docs/05-manual-administrativo.md)
6. [Manual para clientes](docs/06-manual-clientes.md)
7. [Seguridad y WhatsApp](docs/07-seguridad-whatsapp.md)
8. [Pruebas y aceptación](docs/08-pruebas.md)
9. [Decisiones, estado y pendientes](docs/09-decisiones-y-estado.md)

## Antes de publicar

- Ejecute migraciones, seed y todas las verificaciones documentadas.
- Reemplace los datos demo por catálogo, costos, inventario, tarifas y datos comerciales aprobados.
- Configure dominio, CORS, redirecciones de Auth, proveedor de SMS, primer administrador y copias de seguridad.
- Cargue textos legales revisados para Colombia y obtenga el consentimiento aplicable.
- Configure el programador de la cola y, si se usará envío automático, las credenciales y la plantilla aprobada de Meta.
- Realice una prueba completa en un proyecto de ensayo antes de habilitar pedidos reales.
