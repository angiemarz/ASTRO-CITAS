// Exportar citas seleccionadas a Excel (.xlsx editable), PDF o CSV. Todo se genera en el navegador con los
// datos que ya tienes cargados; nada se envía a ningún servicio externo.
import { strToU8, zipSync } from 'fflate';
import { PAYMENT_LABELS, PLATFORM_LABELS, STATUS_LABELS } from '../../shared/domain';
import type { Appointment } from '../../shared/types';

export interface ExportFmt {
  ymd: (iso: string) => string;
  time: (iso: string) => string;
  today: () => string;
}

export const HEADERS = [
  'Fecha',
  'Hora inicio',
  'Hora fin',
  'Cliente',
  'Contacto',
  'Servicios / rituales',
  'Intención',
  'Promociones',
  'Plataforma',
  'Estado',
  'Moneda',
  'Precio original',
  'Descuento',
  'Precio final',
  'Abonado',
  'Saldo',
  'Pago',
  'Notas',
] as const;
/** Columnas (índice) que son dinero: en Excel van como número para poder sumar. */
const MONEY_COLS = new Set([11, 12, 13, 14, 15]);

export function toRows(items: Appointment[], fmt: ExportFmt): (string | number)[][] {
  return items.map((a) => [
    fmt.ymd(a.start_at),
    fmt.time(a.start_at),
    fmt.time(a.end_at),
    a.client_name,
    a.contact_value ?? '',
    a.services.map((s) => s.name).join(' + '),
    a.services.map((s) => s.intention).filter(Boolean).join(', ') || (a.ritual_topic ?? ''),
    a.promotions.map((p) => p.name).join(' + '),
    PLATFORM_LABELS[a.platform],
    STATUS_LABELS[a.status],
    a.currency,
    a.original_price,
    a.discount,
    a.final_price,
    a.paid_total,
    a.balance,
    PAYMENT_LABELS[a.payment_status],
    a.notes ?? '',
  ]);
}

/** Totales por moneda de las citas que no están canceladas. */
export function totalsByCurrency(items: Appointment[]) {
  const t: Record<string, { total: number; paid: number; balance: number }> = {};
  for (const a of items) {
    if (a.status === 'cancelled' || a.status === 'no_show') continue;
    const x = (t[a.currency] ??= { total: 0, paid: 0, balance: 0 });
    x.total += a.final_price;
    x.paid += Math.min(a.paid_total, a.final_price);
    x.balance += a.balance;
  }
  return t;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- CSV ----------
export function downloadCsv(items: Appointment[], fmt: ExportFmt) {
  const rows = [HEADERS as unknown as string[], ...toRows(items, fmt)];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  save(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `citas-${fmt.today()}.csv`);
}

// ---------- Excel (.xlsx) ----------
const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function colName(i: number) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function buildXlsx(items: Appointment[], fmt: ExportFmt): Uint8Array {
  const rows = toRows(items, fmt);
  const widths = [11, 10, 10, 24, 20, 38, 18, 26, 14, 14, 9, 14, 12, 14, 12, 12, 14, 40];
  const cell = (r: number, c: number, v: string | number, style: number) => {
    const ref = `${colName(c)}${r}`;
    if (typeof v === 'number') return `<c r="${ref}" s="${style}"><v>${Number.isFinite(v) ? v : 0}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const head = `<row r="1" ht="22" customHeight="1">${HEADERS.map((h, c) => cell(1, c, h, 1)).join('')}</row>`;
  const body = rows
    .map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(i + 2, c, v, MONEY_COLS.has(c) ? 2 : c === 5 || c === 17 ? 3 : 0)).join('')}</row>`)
    .join('');
  const last = `${colName(HEADERS.length - 1)}${rows.length + 1}`;
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${head}${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/></worksheet>`;
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF74428A"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Citas" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/styles.xml': strToU8(styles),
  };
  return zipSync(files);
}

export function downloadXlsx(items: Appointment[], fmt: ExportFmt) {
  const bytes = buildXlsx(items, fmt);
  save(
    new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `citas-${fmt.today()}.xlsx`,
  );
}

// ---------- PDF ----------
/** El PDF usa letras estándar: se quitan emojis y símbolos que no soporta. */
const pdfText = (s: string | number) => String(s).replace(/[^ -~ -ÿ\n]/g, '').replace(/ {2,}/g, ' ').trim();

export async function downloadPdf(items: Appointment[], fmt: ExportFmt, businessName: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const money = (n: number, c: string) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
  doc.setFontSize(16);
  doc.setTextColor(74, 36, 89);
  doc.text(pdfText(`${businessName} · Citas`), 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`${items.length} cita(s) · generado el ${fmt.today()}`, 40, 56);

  const rows = toRows(items, fmt);
  // Columnas del PDF: las más útiles para leer en papel
  const cols = [0, 1, 3, 5, 6, 7, 9, 13, 14, 15, 16];
  const body = rows.map((r) =>
    cols.map((c) => {
      const v = r[c];
      return MONEY_COLS.has(c) ? money(Number(v), String(r[10])) : pdfText(v);
    }),
  );
  autoTable(doc, {
    startY: 68,
    head: [cols.map((c) => HEADERS[c])],
    body,
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [116, 66, 138], textColor: 255 },
    alternateRowStyles: { fillColor: [247, 242, 250] },
    columnStyles: { 3: { cellWidth: 120 }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
    margin: { left: 40, right: 40, bottom: 40 },
  });
  const totals = Object.entries(totalsByCurrency(items));
  if (totals.length) {
    const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
    doc.setFontSize(10);
    doc.setTextColor(74, 36, 89);
    let y = lastY + 18;
    if (y > doc.internal.pageSize.getHeight() - 50) {
      doc.addPage();
      y = 50;
    }
    doc.text('Totales (sin canceladas):', 40, y);
    totals.forEach(([c, t], i) => doc.text(`${money(t.total, c)} · abonado ${money(t.paid, c)} · por cobrar ${money(t.balance, c)}`, 40, y + 15 * (i + 1)));
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Página ${p} de ${pages}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }
  doc.save(`citas-${fmt.today()}.pdf`);
}
