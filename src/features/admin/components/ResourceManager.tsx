import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Edit3, Plus, Power, Save } from 'lucide-react';
import type { AdminRecord } from '../types';
import { insertRecord, updateRecord } from '../adminService';
import { useAdminData } from '../useAdminData';
import { matchesSearch } from '../utils';
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
  SearchField,
  type TableColumn,
} from './AdminUi';

export type ResourceFieldType =
  'text' | 'email' | 'tel' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox';

export interface ResourceField {
  key: string;
  label: string;
  type?: ResourceFieldType;
  placeholder?: string;
  required?: boolean;
  min?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number | boolean;
  help?: string;
  fullWidth?: boolean;
}

interface ResourceManagerProps<T extends AdminRecord> {
  table: string;
  columns: TableColumn<T>[];
  fields: ResourceField[];
  createLabel: string;
  modalTitle: string;
  modalDescription?: string;
  emptyTitle: string;
  emptyDescription: string;
  searchPlaceholder?: string;
  orderBy?: string;
  statusField?: 'active' | 'is_active' | 'status';
  activeValue?: string | boolean;
  inactiveValue?: string | boolean;
  realtime?: boolean;
  beforeSave?: (values: Record<string, unknown>, editing: T | null) => Record<string, unknown>;
  toolbarExtra?: ReactNode;
  renderDetails?: (row: T) => ReactNode;
}

const initialValues = (
  fields: ResourceField[],
  record?: AdminRecord | null,
): Record<string, string | boolean> =>
  Object.fromEntries(
    fields.map((field) => {
      const value =
        record?.[field.key] ?? field.defaultValue ?? (field.type === 'checkbox' ? false : '');
      return [field.key, typeof value === 'boolean' ? value : String(value ?? '')];
    }),
  );

export function ResourceManager<T extends AdminRecord>({
  table,
  columns,
  fields,
  createLabel,
  modalTitle,
  modalDescription,
  emptyTitle,
  emptyDescription,
  searchPlaceholder,
  orderBy = 'created_at',
  statusField,
  activeValue = true,
  inactiveValue = false,
  realtime = false,
  beforeSave,
  toolbarExtra,
  renderDetails,
}: ResourceManagerProps<T>) {
  const { data, loading, refreshing, error, reload } = useAdminData<T>(
    table,
    { orderBy, ascending: orderBy === 'name', limit: 1000 },
    realtime,
  );
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [details, setDetails] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    initialValues(fields),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filtered = useMemo(() => data.filter((row) => matchesSearch(row, search)), [data, search]);

  const openCreate = () => {
    setEditing(null);
    setValues(initialValues(fields));
    setSaveError(null);
    setFormOpen(true);
  };

  const openEdit = (row: T) => {
    setEditing(row);
    setValues(initialValues(fields, row));
    setSaveError(null);
    setFormOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      let payload: Record<string, unknown> = {};
      fields.forEach((field) => {
        const value = values[field.key];
        if (field.type === 'number') payload[field.key] = value === '' ? null : Number(value);
        else if (field.type === 'checkbox') payload[field.key] = Boolean(value);
        else payload[field.key] = value === '' ? null : value;
      });
      payload = beforeSave?.(payload, editing) ?? payload;
      if (editing) await updateRecord(table, editing.id, payload);
      else await insertRecord(table, payload);
      setFormOpen(false);
      setSuccess(editing ? 'Cambios guardados correctamente.' : 'Registro creado correctamente.');
      window.setTimeout(() => setSuccess(null), 3500);
      await reload();
    } catch (caught) {
      setSaveError(
        caught instanceof Error ? caught.message : 'No fue posible guardar los cambios.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (row: T) => {
    if (!statusField) return;
    setSaveError(null);
    const isActive =
      row[statusField] === activeValue ||
      (statusField === 'status' && row[statusField] === 'active');
    try {
      await updateRecord(table, row.id, { [statusField]: isActive ? inactiveValue : activeValue });
      setSuccess(
        isActive ? 'Registro desactivado sin eliminar su historial.' : 'Registro activado.',
      );
      window.setTimeout(() => setSuccess(null), 3500);
      await reload();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.');
    }
  };

  const actionColumn: TableColumn<T> = {
    key: 'actions',
    header: 'Acciones',
    className: 'w-36',
    render: (row) => (
      <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-lg text-artisan-muted hover:bg-artisan-paper hover:text-wine"
          onClick={() => openEdit(row)}
          aria-label="Editar"
        >
          <Edit3 className="h-4 w-4" />
        </button>
        {statusField && (
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-lg text-artisan-muted hover:bg-artisan-paper hover:text-wine"
            onClick={() => void handleStatus(row)}
            aria-label="Cambiar estado"
          >
            <Power className="h-4 w-4" />
          </button>
        )}
      </div>
    ),
  };

  return (
    <>
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      )}
      {saveError && !formOpen && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {saveError}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField value={search} onChange={setSearch} placeholder={searchPlaceholder} />
        <div className="flex flex-wrap gap-2">
          {toolbarExtra}
          <ExportCsvButton filename={table} rows={filtered} />
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {createLabel}
          </Button>
        </div>
      </div>
      <div
        className="overflow-hidden rounded-2xl border border-artisan-line bg-white shadow-sm"
        aria-busy={refreshing}
      >
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={search ? 'No encontramos coincidencias' : emptyTitle}
            description={search ? 'Prueba con otro nombre, número o referencia.' : emptyDescription}
            action={
              !search ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  {createLabel}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            rows={filtered}
            columns={[...columns, actionColumn]}
            getRowKey={(row) => row.id}
            onRowClick={renderDetails ? setDetails : undefined}
            rowLabel={(row) => String(row.name ?? row.id)}
          />
        )}
      </div>

      <Modal
        open={formOpen}
        title={`${editing ? 'Editar' : 'Crear'} ${modalTitle.toLocaleLowerCase('es')}`}
        description={modalDescription}
        onClose={() => !saving && setFormOpen(false)}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field.key} className={field.fullWidth ? 'sm:col-span-2' : ''}>
                <span className={labelClass}>
                  {field.label}
                  {field.required && <span className="ml-1 text-wine">*</span>}
                </span>
                {field.type === 'textarea' ? (
                  <textarea
                    className={`${inputClass} min-h-24 resize-y`}
                    value={String(values[field.key] ?? '')}
                    required={field.required}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                ) : field.type === 'select' ? (
                  <select
                    className={inputClass}
                    value={String(values[field.key] ?? '')}
                    required={field.required}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  >
                    <option value="">Selecciona una opción</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <span className="flex min-h-11 items-center gap-3 rounded-xl border border-artisan-line bg-white px-3.5 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-wine"
                      checked={Boolean(values[field.key])}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [field.key]: event.target.checked }))
                      }
                    />
                    <span className="text-sm text-artisan-ink">Sí, habilitar</span>
                  </span>
                ) : (
                  <input
                    className={inputClass}
                    type={field.type ?? 'text'}
                    value={String(values[field.key] ?? '')}
                    required={field.required}
                    min={field.min}
                    step={field.step}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                )}
                {field.help && (
                  <span className="mt-1 block text-xs text-artisan-muted">{field.help}</span>
                )}
              </label>
            ))}
          </div>
          {saveError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {saveError}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-artisan-line pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(details)} title="Detalle" onClose={() => setDetails(null)} size="lg">
        {details && renderDetails?.(details)}
      </Modal>
    </>
  );
}
