import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const [emailArg, nameArg] = process.argv.slice(2);
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey || !emailArg) {
  console.error('Uso: npm run admin:create -- admin@negocio.com "Nombre"');
  console.error(
    'Configura VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY solo en tu terminal local.',
  );
  process.exit(1);
}

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = `Ca!${randomBytes(12).toString('base64url')}`;
const { data: created, error: createError } = await client.auth.admin.createUser({
  email: emailArg,
  password,
  email_confirm: true,
  user_metadata: { full_name: nameArg || 'Superadministrador', must_change_password: true },
});
if (createError || !created.user) {
  console.error(createError?.message || 'No se pudo crear el usuario.');
  process.exit(1);
}

const { data: role, error: roleError } = await client
  .from('roles')
  .select('id')
  .eq('code', 'superadmin')
  .single();
if (roleError || !role) {
  await client.auth.admin.deleteUser(created.user.id);
  console.error('No existe el rol superadmin. Ejecuta las migraciones primero.');
  process.exit(1);
}

const { error: profileError } = await client.from('profiles').upsert({
  id: created.user.id,
  full_name: nameArg || 'Superadministrador',
  email: emailArg,
  is_active: true,
});
const { error: assignmentError } = await client
  .from('user_roles')
  .upsert({ profile_id: created.user.id, role_id: role.id });
if (profileError || assignmentError) {
  await client.auth.admin.deleteUser(created.user.id);
  console.error(profileError?.message || assignmentError?.message || 'No se pudo asignar el rol.');
  process.exit(1);
}

console.log(`Administrador creado: ${emailArg}`);
console.log(`Contraseña temporal: ${password}`);
console.log(
  'Guárdala en un gestor seguro. La aplicación exigirá cambiarla al primer ingreso. Esta salida no se almacena en el proyecto.',
);
