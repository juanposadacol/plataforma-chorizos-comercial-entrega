import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { z } from 'npm:zod@3.24.2';
import {
  bearerToken,
  corsHeaders,
  isAllowedOrigin,
  jsonResponse,
  readJson,
} from '../_shared/http.ts';

const schema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    full_name: z.string().trim().min(2).max(140),
    roles: z
      .array(z.enum(['superadmin', 'admin', 'vendedor', 'bodega', 'contabilidad']))
      .min(1)
      .max(5)
      .transform((roles) => [...new Set(roles)]),
  })
  .strict();

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return jsonResponse(request, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'POST' });
  }
  if (!isAllowedOrigin(request)) {
    return jsonResponse(request, 403, { error: { code: 'ORIGIN_NOT_ALLOWED' } });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) {
    return jsonResponse(request, 503, { error: { code: 'SERVER_NOT_CONFIGURED' } });
  }
  const token = bearerToken(request);
  if (!token || token === anonKey) {
    return jsonResponse(request, 401, { error: { code: 'AUTH_REQUIRED' } });
  }

  let input: z.infer<typeof schema>;
  try {
    const parsed = schema.safeParse(await readJson(request, 16 * 1024));
    if (!parsed.success) {
      return jsonResponse(request, 422, {
        error: { code: 'VALIDATION_ERROR', fields: parsed.error.flatten().fieldErrors },
      });
    }
    input = parsed.data;
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_JSON';
    return jsonResponse(request, code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: { code } });
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse(request, 401, { error: { code: 'INVALID_SESSION' } });
  }
  const { data: access, error: accessError } = await userClient.rpc('get_my_access');
  const roles = ((access as { roles?: unknown[] } | null)?.roles ?? []).map(String);
  if (accessError || !roles.some((role) => role === 'superadmin' || role === 'admin')) {
    return jsonResponse(request, 403, { error: { code: 'ADMIN_REQUIRED' } });
  }
  if (input.roles.includes('superadmin') && !roles.includes('superadmin')) {
    return jsonResponse(request, 403, { error: { code: 'SUPERADMIN_REQUIRED' } });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: allowed, error: limitError } = await admin.rpc('check_request_rate_limit', {
    p_bucket: 'invite_staff',
    p_subject: userData.user.id,
    p_max_requests: 10,
    p_window_seconds: 3600,
  });
  if (limitError || !allowed) {
    return jsonResponse(request, limitError ? 500 : 429, {
      error: { code: limitError ? 'RATE_LIMIT_CHECK_FAILED' : 'RATE_LIMITED' },
    });
  }

  const redirectTo = Deno.env.get('STAFF_INVITE_REDIRECT_URL');
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    input.email,
    {
      data: { full_name: input.full_name },
      ...(redirectTo ? { redirectTo } : {}),
    },
  );
  if (inviteError || !invited.user) {
    console.error('Staff invite failed', { status: inviteError?.status, code: inviteError?.code });
    return jsonResponse(request, inviteError?.status === 422 ? 409 : 502, {
      error: { code: 'INVITE_FAILED', message: 'No se pudo enviar la invitación.' },
    });
  }

  const { error: provisionError } = await admin.rpc('provision_staff_roles', {
    p_actor_user_id: userData.user.id,
    p_user_id: invited.user.id,
    p_email: input.email,
    p_full_name: input.full_name,
    p_roles: input.roles,
  });
  if (provisionError) {
    // Avoid leaving an invited account without the authorization selected by the administrator.
    await admin.auth.admin.deleteUser(invited.user.id);
    console.error('Staff provisioning failed', { code: provisionError.code });
    return jsonResponse(request, 500, {
      error: { code: 'ROLE_PROVISION_FAILED', message: 'La invitación no pudo configurarse.' },
    });
  }

  return jsonResponse(request, 201, {
    data: { user_id: invited.user.id, email: input.email, roles: input.roles },
  });
});
