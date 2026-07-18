import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Edit3, MailPlus, Power, Save, ShieldCheck } from 'lucide-react';
import {
  invokeAdminFunction,
  invokeAdminRpc,
  updateRecord,
} from '../../features/admin/adminService';
import { useAdminData } from '../../features/admin/useAdminData';
import type { AdminProfile } from '../../features/admin/types';
import { firstText, formatAdminDate, matchesSearch } from '../../features/admin/utils';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  ExportCsvButton,
  inputClass,
  labelClass,
  LoadingState,
  Modal,
  PageHeader,
  panelClass,
  SearchField,
  StatusBadge,
  type TableColumn,
} from '../../features/admin/components/AdminUi';

interface RoleRecord extends Record<string, unknown> {
  id: string;
  name: string;
  code?: string;
  description?: string;
}
interface UserRole extends Record<string, unknown> {
  id: string;
  profile_id: string;
  role_id: string;
}

export function UsersPage() {
  const profilesState = useAdminData<AdminProfile>(
    'profiles',
    { orderBy: 'created_at', limit: 1000 },
    true,
  );
  const rolesState = useAdminData<RoleRecord>('roles', {
    orderBy: 'name',
    ascending: true,
    limit: 100,
  });
  const assignmentsState = useAdminData<UserRole>(
    'user_roles',
    { orderBy: 'created_at', limit: 2000 },
    true,
  );
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleProfile, setRoleProfile] = useState<AdminProfile | null>(null);
  const [invite, setInvite] = useState({ full_name: '', email: '', roles: [] as string[] });
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const rolesById = useMemo(
    () => new Map(rolesState.data.map((role) => [role.id, role])),
    [rolesState.data],
  );
  const rolesFor = (profileId: string) =>
    assignmentsState.data
      .filter((assignment) => assignment.profile_id === profileId)
      .map((assignment) => rolesById.get(assignment.role_id))
      .filter(Boolean) as RoleRecord[];
  const filtered = profilesState.data.filter(
    (profile) =>
      matchesSearch(profile, search) ||
      rolesFor(profile.id).some((role) => matchesSearch(role, search)),
  );
  const notify = (text: string) => {
    setSuccess(text);
    window.setTimeout(() => setSuccess(null), 4500);
  };

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await invokeAdminFunction('invite-staff', {
        email: invite.email,
        full_name: invite.full_name,
        roles: invite.roles,
      });
      setInviteOpen(false);
      setInvite({ full_name: '', email: '', roles: [] });
      notify('Invitación enviada. El nuevo usuario deberá completar su acceso desde el correo.');
      await Promise.all([profilesState.reload(), assignmentsState.reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible enviar la invitación.');
    } finally {
      setSaving(false);
    }
  };
  const openRoles = (profile: AdminProfile) => {
    setRoleProfile(profile);
    setSelectedRoles(rolesFor(profile.id).map((role) => role.code ?? role.name));
    setError(null);
  };
  const saveRoles = async () => {
    if (!roleProfile) return;
    setSaving(true);
    setError(null);
    try {
      await invokeAdminRpc('set_user_roles', {
        p_profile_id: roleProfile.id,
        p_roles: selectedRoles,
      });
      setRoleProfile(null);
      notify('Roles actualizados. Los permisos RLS se aplican de inmediato.');
      await assignmentsState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar los roles.');
    } finally {
      setSaving(false);
    }
  };
  const toggleActive = async (profile: AdminProfile) => {
    setError(null);
    try {
      await updateRecord('profiles', profile.id, {
        is_active: !(
          profile.active ??
          (profile as AdminProfile & { is_active?: boolean }).is_active ??
          true
        ),
      });
      notify('Estado del usuario actualizado.');
      await profilesState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.');
    }
  };
  const toggleRole = (code: string) =>
    setSelectedRoles((current) =>
      current.includes(code) ? current.filter((role) => role !== code) : [...current, code],
    );
  const toggleInviteRole = (code: string) =>
    setInvite((current) => ({
      ...current,
      roles: current.roles.includes(code)
        ? current.roles.filter((role) => role !== code)
        : [...current.roles, code],
    }));

  const columns: TableColumn<AdminProfile>[] = [
    {
      key: 'user',
      header: 'Usuario',
      render: (profile) => (
        <div>
          <p className="font-bold">{profile.full_name || 'Sin nombre'}</p>
          <p className="text-xs text-artisan-muted">{profile.email || profile.phone || '—'}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (profile) => (
        <div className="flex flex-wrap gap-1">
          {rolesFor(profile.id).length ? (
            rolesFor(profile.id).map((role) => (
              <span
                key={role.id}
                className="rounded-full bg-wine/10 px-2 py-1 text-xs font-bold text-wine"
              >
                {role.name}
              </span>
            ))
          ) : (
            <span className="text-artisan-muted">Sin rol</span>
          )}
        </div>
      ),
    },
    { key: 'created', header: 'Creado', render: (profile) => formatAdminDate(profile.created_at) },
    {
      key: 'status',
      header: 'Estado',
      render: (profile) => (
        <StatusBadge
          status={
            (profile as AdminProfile & { is_active?: boolean }).is_active === false
              ? 'inactive'
              : 'active'
          }
        />
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (profile) => (
        <div className="flex gap-1">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-lg text-artisan-muted hover:bg-artisan-paper hover:text-wine"
            aria-label="Editar roles"
            onClick={() => openRoles(profile)}
          >
            <Edit3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-lg text-artisan-muted hover:bg-artisan-paper hover:text-wine"
            aria-label="Cambiar estado"
            onClick={() => void toggleActive(profile)}
          >
            <Power className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Seguridad"
        title="Usuarios y permisos"
        description="Invita al equipo y asigna roles. La autorización se valida también en Supabase mediante RLS, no solo en la interfaz."
        actions={
          <>
            <ExportCsvButton filename="usuarios" rows={filtered} />
            <Button
              onClick={() => {
                setError(null);
                setInviteOpen(true);
              }}
            >
              <MailPlus className="h-4 w-4" />
              Invitar usuario
            </Button>
          </>
        }
      />
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      )}
      {error && !inviteOpen && !roleProfile && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Buscar por nombre, correo o rol…"
      />
      <section className={`${panelClass} overflow-hidden`}>
        {profilesState.loading || rolesState.loading || assignmentsState.loading ? (
          <LoadingState />
        ) : profilesState.error || rolesState.error || assignmentsState.error ? (
          <ErrorState
            message={profilesState.error || rolesState.error || assignmentsState.error || ''}
            onRetry={() =>
              void Promise.all([
                profilesState.reload(),
                rolesState.reload(),
                assignmentsState.reload(),
              ])
            }
          />
        ) : filtered.length ? (
          <DataTable rows={filtered} columns={columns} getRowKey={(profile) => profile.id} />
        ) : (
          <EmptyState
            title="Sin usuarios"
            description="Invita al primer miembro del equipo para asignarle permisos."
          />
        )}
      </section>
      <Modal
        open={inviteOpen}
        title="Invitar usuario"
        description="La invitación se envía desde una función segura; ninguna clave administrativa llega al navegador."
        onClose={() => !saving && setInviteOpen(false)}
      >
        <form onSubmit={submitInvite} className="space-y-4">
          <label>
            <span className={labelClass}>Nombre completo *</span>
            <input
              required
              className={inputClass}
              value={invite.full_name}
              onChange={(event) =>
                setInvite((current) => ({ ...current, full_name: event.target.value }))
              }
            />
          </label>
          <label>
            <span className={labelClass}>Correo *</span>
            <input
              required
              type="email"
              className={inputClass}
              value={invite.email}
              onChange={(event) =>
                setInvite((current) => ({ ...current, email: event.target.value }))
              }
            />
          </label>
          <fieldset>
            <legend className={labelClass}>Roles *</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {rolesState.data
                .filter((role) => (role.code ?? role.name) !== 'customer')
                .map((role) => {
                  const code = role.code ?? role.name;
                  return (
                    <label
                      key={role.id}
                      className="flex items-start gap-3 rounded-xl border border-artisan-line bg-white p-3"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-wine"
                        checked={invite.roles.includes(code)}
                        onChange={() => toggleInviteRole(code)}
                      />
                      <span>
                        <span className="block text-sm font-bold">{role.name}</span>
                        <span className="block text-xs text-artisan-muted">{role.description}</span>
                      </span>
                    </label>
                  );
                })}
            </div>
          </fieldset>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
            <Button type="button" variant="secondary" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || invite.roles.length === 0}>
              <MailPlus className="h-4 w-4" />
              {saving ? 'Enviando…' : 'Enviar invitación'}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(roleProfile)}
        title="Asignar roles"
        description={
          roleProfile ? `Permisos para ${firstText(roleProfile, 'full_name', 'email')}` : undefined
        }
        onClose={() => !saving && setRoleProfile(null)}
      >
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {rolesState.data.map((role) => {
              const code = role.code ?? role.name;
              return (
                <label
                  key={role.id}
                  className="flex items-start gap-3 rounded-xl border border-artisan-line bg-white p-3"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-wine"
                    checked={selectedRoles.includes(code)}
                    onChange={() => toggleRole(code)}
                  />
                  <span>
                    <span className="block text-sm font-bold">{role.name}</span>
                    <span className="block text-xs text-artisan-muted">{role.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="rounded-xl bg-artisan-paper p-4 text-sm text-artisan-muted">
            <ShieldCheck className="mb-2 h-5 w-5 text-wine" />
            Los cambios actualizan las políticas de acceso del servidor en la siguiente consulta.
          </div>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
            <Button variant="secondary" onClick={() => setRoleProfile(null)}>
              Cancelar
            </Button>
            <Button disabled={saving || !selectedRoles.length} onClick={() => void saveRoles()}>
              <Save className="h-4 w-4" />
              {saving ? 'Guardando…' : 'Guardar roles'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
export default UsersPage;
