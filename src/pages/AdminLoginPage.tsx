import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../features/auth/AuthContext';
import { getErrorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';

const schema = z.object({
  email: z.email('Escribe un correo válido.'),
  password: z.string().min(8, 'Mínimo 8 caracteres.'),
});
type Values = z.infer<typeof schema>;

export function AdminLoginPage() {
  const { user, access, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordMode = ['recovery', 'first-login'].includes(
    new URLSearchParams(location.search).get('mode') ?? '',
  );
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });
  if (user && access.isStaff && !passwordMode) return <Navigate to="/admin" replace />;
  const submit = async (values: Values) => {
    if (!supabase) return setError('Supabase no está configurado.');
    setBusy(true);
    setError('');
    setMessage('');
    const { error: authError } = await supabase.auth.signInWithPassword(values);
    setBusy(false);
    if (authError) setError('No pudimos iniciar sesión. Revisa tus datos y permisos.');
    else
      navigate((location.state as { from?: string } | null)?.from || '/admin', { replace: true });
  };
  const recover = async () => {
    const email = getValues('email');
    if (!z.string().email().safeParse(email).success)
      return setError('Escribe primero tu correo administrativo.');
    if (!supabase) return setError('Supabase no está configurado.');
    setBusy(true);
    const { error: recoverError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/acceso?mode=recovery`,
    });
    setBusy(false);
    if (recoverError) setError(getErrorMessage(recoverError));
    else setMessage('Si la cuenta existe, recibirás un enlace seguro.');
  };
  const updatePassword = async () => {
    setError('');
    setMessage('');
    if (newPassword.length < 12) return setError('Usa una contraseña de al menos 12 caracteres.');
    if (newPassword !== confirmPassword) return setError('Las contraseñas no coinciden.');
    if (!supabase || !user) return setError('El enlace es inválido o expiró. Solicita uno nuevo.');
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
      data: { ...user.user_metadata, must_change_password: false },
    });
    setBusy(false);
    if (updateError) return setError(getErrorMessage(updateError));
    setMessage('Contraseña actualizada. Abriendo el panel…');
    setTimeout(() => navigate('/admin', { replace: true }), 700);
  };
  if (passwordMode) {
    return (
      <main className="admin-login-page">
        <section className="admin-login-aside">
          <div className="brand-mark">CA</div>
          <p className="eyebrow">Recuperación segura</p>
          <h1>Crea una nueva contraseña.</h1>
          <p>El enlace verifica tu identidad antes de permitir el cambio.</p>
        </section>
        <section className="admin-login-form">
          <div>
            <span className="dialog-icon">
              <LockKeyhole />
            </span>
            <p className="eyebrow eyebrow--wine">Cuenta administrativa</p>
            <h2>Nueva contraseña</h2>
            {loading ? (
              <p>Verificando el enlace…</p>
            ) : user ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void updatePassword();
                }}
              >
                <label>
                  Nueva contraseña
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </label>
                <label>
                  Confirmar contraseña
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
                {error && (
                  <p className="form-submit-error" role="alert">
                    {error}
                  </p>
                )}
                {message && (
                  <p className="success-notice" role="status">
                    {message}
                  </p>
                )}
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />} Guardar
                  contraseña
                </button>
              </form>
            ) : (
              <>
                <p className="form-submit-error" role="alert">
                  El enlace no es válido o expiró.
                </p>
                <a className="primary-button" href="/admin/acceso">
                  Solicitar otro enlace
                </a>
              </>
            )}
            <a className="back-store" href="/">
              ← Volver a la tienda
            </a>
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="admin-login-page">
      <section className="admin-login-aside">
        <div className="brand-mark">CA</div>
        <p className="eyebrow">Operación comercial</p>
        <h1>Todo el negocio en un solo lugar.</h1>
        <p>
          Pedidos, precios, clientes, inventario, compras, pagos, gastos, utilidad y reportes con
          permisos por rol.
        </p>
        <ul>
          <li>
            <ShieldCheck /> Precios validados en servidor
          </li>
          <li>
            <ShieldCheck /> Inventario reservado sin carreras
          </li>
          <li>
            <ShieldCheck /> Historial y auditoría
          </li>
        </ul>
      </section>
      <section className="admin-login-form">
        <div>
          <span className="dialog-icon">
            <LockKeyhole />
          </span>
          <p className="eyebrow eyebrow--wine">Acceso privado</p>
          <h2>Panel administrativo</h2>
          <p>Usa la cuenta creada por el superadministrador.</p>
          <form onSubmit={handleSubmit(submit)} noValidate>
            <label>
              Correo administrativo
              <div className="field-with-icon">
                <Mail />
                <input type="email" autoComplete="email" {...register('email')} />
              </div>
              {errors.email && <span className="field-error">{errors.email.message}</span>}
            </label>
            <label>
              Contraseña
              <input type="password" autoComplete="current-password" {...register('password')} />
              {errors.password && <span className="field-error">{errors.password.message}</span>}
            </label>
            {error && (
              <p className="form-submit-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="success-notice" role="status">
                {message}
              </p>
            )}
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />} Iniciar sesión
            </button>
            <button
              className="text-button"
              disabled={busy}
              type="button"
              onClick={() => void recover()}
            >
              Olvidé mi contraseña
            </button>
          </form>
          <a className="back-store" href="/">
            ← Volver a la tienda
          </a>
        </div>
      </section>
    </main>
  );
}
