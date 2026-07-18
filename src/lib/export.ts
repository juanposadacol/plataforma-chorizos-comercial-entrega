import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export type ExportRow = Record<string, string | number | boolean | null | undefined>;

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const columnsOf = (rows: ExportRow[]) => [...new Set(rows.flatMap((row) => Object.keys(row)))];
const normalize = (value: ExportRow[string]) => (value == null ? '' : String(value));

export const exportCsv = (filename: string, rows: ExportRow[]) => {
  const columns = columnsOf(rows);
  const escape = (value: ExportRow[string]) => {
    const raw = normalize(value);
    const safe = typeof value === 'string' && /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\r\n');
  download(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
};

export const exportExcel = async (filename: string, rows: ExportRow[]) => {
  const columns = columnsOf(rows);
  const xmlEscape = (value: ExportRow[string]) =>
    normalize(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  const cell = (value: ExportRow[string], header = false) =>
    `<Cell${header ? ' ss:StyleID="Header"' : ''}><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xmlEscape(value)}</Data></Cell>`;
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#741D17" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="Reporte"><Table>
<Row>${columns.map((column) => cell(column, true)).join('')}</Row>
${rows.map((row) => `<Row>${columns.map((column) => cell(row[column])).join('')}</Row>`).join('\n')}
</Table></Worksheet></Workbook>`;
  download(
    new Blob([`\uFEFF${xml}`], { type: 'application/vnd.ms-excel;charset=utf-8' }),
    `${filename}.xls`,
  );
};

export const exportPdf = (filename: string, title: string, rows: ExportRow[]) => {
  const doc = new jsPDF({ orientation: 'landscape' });
  const columns = columnsOf(rows);
  doc.setTextColor(75, 16, 13);
  doc.setFontSize(17);
  doc.text(title, 14, 16);
  doc.setTextColor(120, 104, 93);
  doc.setFontSize(9);
  doc.text(
    `Generado ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date())}`,
    14,
    23,
  );
  autoTable(doc, {
    startY: 29,
    head: [columns],
    body: rows.map((row) => columns.map((column) => normalize(row[column]))),
    theme: 'striped',
    headStyles: { fillColor: [116, 29, 23] },
    styles: { fontSize: 8 },
  });
  doc.save(`${filename}.pdf`);
};
