// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import usersPageSource from './UsersPage.tsx?raw';
import coreSchema from '../../../supabase/migrations/202607170001_core_schema.sql?raw';

afterEach(cleanup);

const useAdminData = vi.hoisted(() => vi.fn());
vi.mock('../../features/admin/useAdminData', () => ({ useAdminData }));
vi.mock('../../features/admin/adminService', () => ({
  invokeAdminFunction: vi.fn(),
  invokeAdminRpc: vi.fn(),
  updateRecord: vi.fn(),
}));

// Palabras que abren una restricción de tabla, no una columna.
const TABLE_CONSTRAINTS = new Set([
  'primary',
  'constraint',
  'unique',
  'foreign',
  'check',
  'exclude',
]);

/** Columnas reales de una tabla, leídas de la migración de esquema. */
const columnsOf = (table: string): string[] => {
  const block = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(
    coreSchema,
  );
  if (!block?.[1]) throw new Error(`No se encontró la definición de ${table}`);
  return block[1]
    .split('\n')
    .map((line) => /^\s{2}([a-z_]+)\s+[a-z]/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name) && !TABLE_CONSTRAINTS.has(name as string));
};

// 1. Contrato esquema ↔ consulta. Esta prueba habría detectado el fallo de
// producción "column user_roles.created_at does not exist" y lo detecta de nuevo
// si alguien cambia cualquiera de los dos lados.
describe('1. la consulta de user_roles usa una columna que existe', () => {
  const realColumns = columnsOf('user_roles');

  it('user_roles no tiene created_at ni id: su clave es compuesta', () => {
    expect(realColumns).toEqual([
      'profile_id',
      'role_id',
      'assigned_by',
      'assigned_at',
      'expires_at',
    ]);
    expect(realColumns).not.toContain('created_at');
    expect(realColumns).not.toContain('id');
  });

  it('UsersPage ordena user_roles por una columna real', () => {
    const call = /useAdminData<UserRole>\(\s*'user_roles',\s*\{([^}]*)\}/.exec(usersPageSource);
    expect(call).not.toBeNull();

    const orderBy = /orderBy:\s*'([a-z_]+)'/.exec(call?.[1] ?? '')?.[1];
    expect(orderBy).toBe('assigned_at');
    expect(realColumns).toContain(orderBy);
  });

  it('ninguna consulta de UsersPage pide user_roles.created_at', () => {
    const userRolesCall = /useAdminData<UserRole>\(\s*'user_roles',\s*\{([^}]*)\}/.exec(
      usersPageSource,
    );
    expect(userRolesCall?.[1]).not.toContain('created_at');
  });

  it('profiles sí tiene created_at, así que ese orden es correcto', () => {
    expect(columnsOf('profiles')).toContain('created_at');
  });
});

// 2. La pantalla vuelve a listar nombre/correo, rol, estado y acciones.
describe('2. la pantalla Usuarios carga y lista correctamente', () => {
  const state = <T,>(data: T[]) => ({
    data,
    loading: false,
    refreshing: false,
    error: null,
    reload: vi.fn(),
  });

  beforeEach(() => {
    useAdminData.mockReset();
    useAdminData.mockImplementation((table: string) => {
      if (table === 'profiles')
        return state([
          {
            id: 'profile-1',
            full_name: 'Administrador Demo',
            email: 'admin.demo@chorizos.invalid',
            is_active: true,
            created_at: '2026-07-01T12:00:00Z',
          },
        ]);
      if (table === 'roles')
        return state([
          { id: 'role-1', code: 'superadmin', name: 'Superadministrador', description: 'Total' },
          { id: 'role-2', code: 'admin', name: 'Administrador', description: 'Comercial' },
        ]);
      if (table === 'user_roles')
        return state([
          { profile_id: 'profile-1', role_id: 'role-1', assigned_at: '2026-07-01T12:00:00Z' },
        ]);
      return state([]);
    });
  });

  it('muestra nombre, correo, rol, estado y acciones', async () => {
    const { UsersPage } = await import('./UsersPage');
    render(<UsersPage />);

    // `DataTable` pinta la vista de tabla y la de tarjetas, así que cada dato
    // aparece más de una vez: se comprueba presencia, no unicidad.
    expect(screen.getAllByText('Administrador Demo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('admin.demo@chorizos.invalid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Superadministrador').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /editar roles/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /cambiar estado/i }).length).toBeGreaterThan(0);
    // StatusBadge sin `label` cae al propio valor del estado ('active').
    expect(screen.getAllByText('active').length).toBeGreaterThan(0);
    // Sin estado de error: la consulta ya no falla.
    expect(screen.queryByText(/does not exist/i)).not.toBeInTheDocument();
  });

  it('solicita user_roles ordenado por assigned_at', async () => {
    const { UsersPage } = await import('./UsersPage');
    render(<UsersPage />);

    expect(useAdminData).toHaveBeenCalledWith(
      'user_roles',
      { orderBy: 'assigned_at', limit: 2000 },
      true,
    );
  });

  it('propaga el error del servidor si la consulta falla', async () => {
    useAdminData.mockImplementation((table: string) =>
      table === 'user_roles'
        ? { ...state([]), error: 'column user_roles.created_at does not exist' }
        : state([]),
    );
    const { UsersPage } = await import('./UsersPage');
    render(<UsersPage />);

    expect(screen.getByText('column user_roles.created_at does not exist')).toBeInTheDocument();
  });
});
