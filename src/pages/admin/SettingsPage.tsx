/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { CheckCircle2, Save, Settings2 } from 'lucide-react';
import { upsertRecords } from '../../features/admin/adminService';
import { useAdminData } from '../../features/admin/useAdminData';
import {
  ResourceManager,
  type ResourceField,
} from '../../features/admin/components/ResourceManager';
import {
  Button,
  ErrorState,
  inputClass,
  labelClass,
  LoadingState,
  PageHeader,
  panelClass,
  StatusBadge,
  type TableColumn,
} from '../../features/admin/components/AdminUi';
import type { AdminRecord } from '../../features/admin/types';

interface AppSetting extends AdminRecord {
  key: string;
  value: unknown;
  description?: string | null;
  is_public?: boolean;
}
interface MethodRecord extends AdminRecord {
  name: string;
  code: string;
  description?: string;
  fee?: number;
  is_active?: boolean;
  sort_order?: number;
}
interface WhatsAppSetting extends AdminRecord {
  provider?: string;
  admin_phone?: string;
  business_phone?: string;
  template_name?: string;
  is_enabled?: boolean;
  status?: string;
}
type SettingsTab = 'business' | 'payments' | 'delivery' | 'whatsapp';

const settingFields = [
  {
    key: 'business_name',
    label: 'Nombre del negocio',
    type: 'text',
    group: 'Identidad',
    public: true,
  },
  { key: 'logo_url', label: 'URL del logo', type: 'url', group: 'Identidad', public: true },
  {
    key: 'primary_color',
    label: 'Color principal',
    type: 'color',
    group: 'Identidad',
    public: true,
  },
  {
    key: 'business_whatsapp',
    label: 'WhatsApp del negocio',
    type: 'tel',
    group: 'Contacto',
    public: true,
  },
  {
    key: 'admin_whatsapp',
    label: 'WhatsApp del administrador',
    type: 'tel',
    group: 'Contacto',
    public: false,
  },
  {
    key: 'bank_details',
    label: 'Datos bancarios',
    type: 'textarea',
    group: 'Contacto',
    public: true,
  },
  { key: 'currency', label: 'Moneda', type: 'text', group: 'Operación', public: true },
  { key: 'timezone', label: 'Zona horaria', type: 'text', group: 'Operación', public: true },
  {
    key: 'delivery_fee',
    label: 'Valor de domicilio predeterminado',
    type: 'number',
    group: 'Operación',
    public: true,
  },
  {
    key: 'order_prefix',
    label: 'Prefijo de pedidos',
    type: 'text',
    group: 'Operación',
    public: false,
  },
  {
    key: 'minimum_stock_default',
    label: 'Stock mínimo predeterminado',
    type: 'number',
    group: 'Operación',
    public: false,
  },
  {
    key: 'volume_pricing_enabled',
    label: 'Activar precios por volumen',
    type: 'checkbox',
    group: 'Operación',
    public: false,
  },
  {
    key: 'terms_and_conditions',
    label: 'Términos y condiciones',
    type: 'textarea',
    group: 'Legal',
    public: true,
  },
  {
    key: 'privacy_policy',
    label: 'Política de privacidad',
    type: 'textarea',
    group: 'Legal',
    public: true,
  },
] as const;

const settingValue = (value: unknown): string | boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && 'value' in value)
    return settingValue((value as { value: unknown }).value);
  return value == null ? '' : JSON.stringify(value);
};

export function SettingsPage() {
  const settingsState = useAdminData<AppSetting>(
    'app_settings',
    { orderBy: 'key', ascending: true, limit: 300 },
    true,
  );
  const [tab, setTab] = useState<SettingsTab>('business');
  const [values, setValues] = useState<Record<string, string | boolean>>({
    currency: 'COP',
    timezone: 'America/Bogota',
    primary_color: '#741d17',
    volume_pricing_enabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsState.data.length) return;
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(
        settingsState.data.map((setting) => [setting.key, settingValue(setting.value)]),
      ),
    }));
  }, [settingsState.data]);

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    try {
      await upsertRecords(
        'app_settings',
        settingFields.map((field) => ({
          key: field.key,
          value:
            field.type === 'number' ? Number(values[field.key] || 0) : (values[field.key] ?? ''),
          description: field.label,
          is_public: field.public,
        })),
        'key',
      );
      setSuccess('Configuración guardada. Los valores públicos se reflejarán en la tienda.');
      window.setTimeout(() => setSuccess(null), 4500);
      await settingsState.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'No fue posible guardar la configuración.',
      );
    } finally {
      setSaving(false);
    }
  };

  const methodFields: ResourceField[] = [
    { key: 'name', label: 'Nombre', required: true },
    { key: 'code', label: 'Código', required: true },
    { key: 'description', label: 'Descripción', type: 'textarea', fullWidth: true },
    {
      key: 'instructions',
      label: 'Instrucciones para el cliente',
      type: 'textarea',
      fullWidth: true,
    },
    { key: 'sort_order', label: 'Orden', type: 'number', min: 0, step: 1, defaultValue: 0 },
    { key: 'is_active', label: 'Activo', type: 'checkbox', defaultValue: true },
  ];
  const methodColumns: TableColumn<MethodRecord>[] = [
    {
      key: 'name',
      header: 'Forma de pago',
      render: (method) => (
        <div>
          <p className="font-bold">{method.name}</p>
          <p className="text-xs uppercase text-artisan-muted">{method.code}</p>
        </div>
      ),
    },
    { key: 'description', header: 'Descripción', render: (method) => method.description || '—' },
    { key: 'order', header: 'Orden', render: (method) => method.sort_order ?? 0 },
    {
      key: 'status',
      header: 'Estado',
      render: (method) => (
        <StatusBadge status={method.is_active === false ? 'inactive' : 'active'} />
      ),
    },
  ];
  const deliveryFields: ResourceField[] = [
    { key: 'name', label: 'Nombre', required: true },
    { key: 'code', label: 'Código', required: true },
    { key: 'description', label: 'Descripción', type: 'textarea', fullWidth: true },
    { key: 'fee', label: 'Tarifa', type: 'number', min: 0, step: 100, defaultValue: 0 },
    { key: 'requires_address', label: 'Requiere dirección', type: 'checkbox', defaultValue: true },
    { key: 'sort_order', label: 'Orden', type: 'number', min: 0, step: 1, defaultValue: 0 },
    { key: 'is_active', label: 'Activo', type: 'checkbox', defaultValue: true },
  ];
  const deliveryColumns: TableColumn<MethodRecord>[] = [
    {
      key: 'name',
      header: 'Forma de entrega',
      render: (method) => (
        <div>
          <p className="font-bold">{method.name}</p>
          <p className="text-xs uppercase text-artisan-muted">{method.code}</p>
        </div>
      ),
    },
    { key: 'description', header: 'Descripción', render: (method) => method.description || '—' },
    {
      key: 'fee',
      header: 'Tarifa',
      render: (method) =>
        new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: 'COP',
          maximumFractionDigits: 0,
        }).format(method.fee ?? 0),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (method) => (
        <StatusBadge status={method.is_active === false ? 'inactive' : 'active'} />
      ),
    },
  ];
  const whatsappFields: ResourceField[] = [
    {
      key: 'provider',
      label: 'Proveedor',
      type: 'select',
      required: true,
      options: [
        { value: 'meta_cloud', label: 'WhatsApp Business Cloud (Meta)' },
        { value: 'manual', label: 'Respaldo manual' },
      ],
    },
    { key: 'admin_phone', label: 'Celular del administrador', type: 'tel', required: true },
    { key: 'business_phone', label: 'Celular del negocio', type: 'tel' },
    { key: 'template_name', label: 'Nombre de plantilla aprobada' },
    { key: 'template_language', label: 'Idioma de plantilla', defaultValue: 'es_CO' },
    {
      key: 'max_retries',
      label: 'Cantidad de reintentos',
      type: 'number',
      min: 0,
      step: 1,
      defaultValue: 3,
    },
    { key: 'is_enabled', label: 'Envío automático activo', type: 'checkbox', defaultValue: false },
    {
      key: 'notes',
      label: 'Notas de configuración',
      type: 'textarea',
      fullWidth: true,
      help: 'Los tokens y secretos se configuran en Supabase; nunca se guardan aquí.',
    },
  ];
  const whatsappColumns: TableColumn<WhatsAppSetting>[] = [
    {
      key: 'provider',
      header: 'Proveedor',
      render: (setting) => setting.provider?.replaceAll('_', ' ') || 'Manual',
    },
    { key: 'phone', header: 'Administrador', render: (setting) => setting.admin_phone || '—' },
    { key: 'template', header: 'Plantilla', render: (setting) => setting.template_name || '—' },
    {
      key: 'status',
      header: 'Estado',
      render: (setting) => (
        <StatusBadge
          status={setting.is_enabled ? 'active' : 'inactive'}
          label={setting.is_enabled ? 'Automático' : 'Respaldo manual'}
        />
      ),
    },
  ];
  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'business', label: 'Negocio' },
    { id: 'payments', label: 'Formas de pago' },
    { id: 'delivery', label: 'Formas de entrega' },
    { id: 'whatsapp', label: 'WhatsApp' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Sistema"
        title="Configuración"
        description="Centraliza identidad, operación, métodos y notificaciones. Las credenciales sensibles permanecen como secretos del servidor."
      />
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-artisan-line bg-white p-1.5 shadow-sm">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold ${tab === item.id ? 'bg-wine text-white' : 'text-artisan-muted hover:bg-artisan-paper'}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {tab === 'business' && (
        <section className={`${panelClass} p-5 sm:p-6`}>
          {settingsState.loading ? (
            <LoadingState />
          ) : settingsState.error ? (
            <ErrorState message={settingsState.error} onRetry={() => void settingsState.reload()} />
          ) : (
            <div className="space-y-8">
              {[...new Set(settingFields.map((field) => field.group))].map((group) => (
                <fieldset key={group}>
                  <legend className="mb-4 font-display text-xl font-bold text-artisan-ink">
                    {group}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {settingFields
                      .filter((field) => field.group === group)
                      .map((field) => (
                        <label
                          key={field.key}
                          className={field.type === 'textarea' ? 'sm:col-span-2' : ''}
                        >
                          <span className={labelClass}>{field.label}</span>
                          {field.type === 'textarea' ? (
                            <textarea
                              className={`${inputClass} min-h-24`}
                              value={String(values[field.key] ?? '')}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                            />
                          ) : field.type === 'checkbox' ? (
                            <span className="flex min-h-11 items-center gap-3 rounded-xl border border-artisan-line bg-white px-3.5">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-wine"
                                checked={Boolean(values[field.key])}
                                onChange={(event) =>
                                  setValues((current) => ({
                                    ...current,
                                    [field.key]: event.target.checked,
                                  }))
                                }
                              />
                              <span className="text-sm">Sí, activar</span>
                            </span>
                          ) : (
                            <input
                              type={field.type}
                              className={inputClass}
                              value={String(values[field.key] ?? '')}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                            />
                          )}
                        </label>
                      ))}
                  </div>
                </fieldset>
              ))}
              <div className="flex justify-end border-t border-artisan-line pt-5">
                <Button disabled={saving} onClick={() => void saveSettings()}>
                  <Save className="h-4 w-4" />
                  {saving ? 'Guardando…' : 'Guardar configuración'}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === 'payments' && (
        <ResourceManager
          table="payment_methods"
          columns={methodColumns}
          fields={methodFields}
          createLabel="Nueva forma de pago"
          modalTitle="Forma de pago"
          emptyTitle="Sin formas de pago"
          emptyDescription="Configura los métodos que estarán disponibles en la tienda."
          searchPlaceholder="Buscar forma de pago…"
          orderBy="sort_order"
          statusField="is_active"
        />
      )}
      {tab === 'delivery' && (
        <ResourceManager
          table="delivery_methods"
          columns={deliveryColumns}
          fields={deliveryFields}
          createLabel="Nueva forma de entrega"
          modalTitle="Forma de entrega"
          emptyTitle="Sin formas de entrega"
          emptyDescription="Configura domicilio, recogida u otras modalidades."
          searchPlaceholder="Buscar forma de entrega…"
          orderBy="sort_order"
          statusField="is_active"
        />
      )}
      {tab === 'whatsapp' && (
        <>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex gap-3">
              <Settings2 className="h-5 w-5 shrink-0" />
              <p>
                Los access tokens, phone IDs y claves se configuran como secretos de Supabase. Este
                formulario solo administra valores no sensibles y el modo de respaldo.
              </p>
            </div>
          </div>
          <ResourceManager
            table="whatsapp_settings"
            columns={whatsappColumns}
            fields={whatsappFields}
            createLabel="Configurar WhatsApp"
            modalTitle="Configuración de WhatsApp"
            emptyTitle="WhatsApp automático no configurado"
            emptyDescription="La plataforma seguirá guardando pedidos y ofrecerá el envío manual de respaldo."
            searchPlaceholder="Buscar proveedor o número…"
          />
        </>
      )}
    </>
  );
}
export default SettingsPage;
