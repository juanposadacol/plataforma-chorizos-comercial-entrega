import { useMemo } from 'react';
import type { Expense } from '../../features/admin/types';
import { useAdminData } from '../../features/admin/useAdminData';
import { firstText, formatAdminDate, formatMoney } from '../../features/admin/utils';
import {
  ResourceManager,
  type ResourceField,
} from '../../features/admin/components/ResourceManager';
import { PageHeader, type TableColumn } from '../../features/admin/components/AdminUi';

interface ExpenseCategory extends Record<string, unknown> {
  id: string;
  name: string;
}
interface PaymentMethod extends Record<string, unknown> {
  id: string;
  name: string;
  code?: string;
}

export function ExpensesPage() {
  const { data: categories } = useAdminData<ExpenseCategory>('expense_categories', {
    orderBy: 'name',
    ascending: true,
    limit: 100,
  });
  const { data: paymentMethods } = useAdminData<PaymentMethod>('payment_methods', {
    orderBy: 'name',
    ascending: true,
    limit: 100,
  });
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const fields: ResourceField[] = [
    {
      key: 'expense_date',
      label: 'Fecha',
      type: 'date',
      required: true,
      defaultValue: new Date().toISOString().slice(0, 10),
    },
    {
      key: 'category_id',
      label: 'Categoría',
      type: 'select',
      required: true,
      options: categories.map((category) => ({ value: category.id, label: category.name })),
    },
    { key: 'description', label: 'Descripción', required: true, fullWidth: true },
    { key: 'beneficiary', label: 'Beneficiario' },
    { key: 'amount', label: 'Valor', type: 'number', required: true, min: 0, step: 100 },
    {
      key: 'payment_method_id',
      label: 'Forma de pago',
      type: 'select',
      required: true,
      options: paymentMethods.map((method) => ({ value: method.id, label: method.name })),
    },
    { key: 'account', label: 'Cuenta o caja' },
    {
      key: 'order_id',
      label: 'Pedido relacionado',
      help: 'Opcional. Usa el identificador del pedido.',
    },
    { key: 'receipt_url', label: 'URL del soporte', fullWidth: true },
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      required: true,
      defaultValue: 'confirmed',
      options: [
        { value: 'draft', label: 'Borrador' },
        { value: 'confirmed', label: 'Confirmado' },
        { value: 'voided', label: 'Anulado' },
      ],
    },
    { key: 'notes', label: 'Observaciones', type: 'textarea', fullWidth: true },
  ];
  const columns: TableColumn<Expense>[] = [
    {
      key: 'date',
      header: 'Fecha',
      render: (expense) => formatAdminDate(expense.expense_date ?? expense.created_at),
    },
    {
      key: 'description',
      header: 'Descripción',
      render: (expense) => (
        <div>
          <p className="font-bold">{expense.description}</p>
          <p className="text-xs text-artisan-muted">{expense.beneficiary || 'Sin beneficiario'}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Categoría',
      render: (expense) =>
        categoryById.get(expense.category_id ?? '') ??
        (firstText(expense, 'category_name') || 'Otros'),
    },
    {
      key: 'method',
      header: 'Forma de pago',
      render: (expense) => (
        <span className="capitalize">
          {expense.payment_method_name || expense.payment_method?.replaceAll('_', ' ') || '—'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Valor',
      render: (expense) => (
        <span className="font-black text-wine">{formatMoney(expense.amount)}</span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Finanzas"
        title="Gastos"
        description="Registra egresos operativos con categoría, soporte y relación opcional a un pedido. Estos valores alimentan la utilidad neta."
      />
      <ResourceManager
        table="expenses"
        columns={columns}
        fields={fields}
        createLabel="Registrar gasto"
        modalTitle="Gasto"
        modalDescription="Los gastos financieros conservan historial y no se eliminan desde la interfaz."
        emptyTitle="Aún no hay gastos"
        emptyDescription="Registra el primer egreso para calcular la utilidad neta y el flujo de caja."
        searchPlaceholder="Buscar descripción, beneficiario, categoría o valor…"
      />
    </>
  );
}
export default ExpensesPage;
