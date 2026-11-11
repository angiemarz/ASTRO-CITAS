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

// ---------- Paleta AstroBloomx ----------
const C = {
  plum: '4A2459',
  plumMid: '74428A',
  gold: 'C5A25A',
  goldSoft: 'F5ECD3',
  blush: 'FBF3F8',
  zebra: 'F8F3FB',
  line: 'E6DDEF',
  text: '371A43',
  muted: '8D5AA3',
};
/** Colores de las etiquetas de estado y de pago (texto, fondo). */
const STATUS_COLORS: Record<string, [string, string]> = {
  scheduled: ['3B5B9D', 'E3ECFA'],
  confirmed: ['2F6FB5', 'DCEBFA'],
  in_progress: ['9A6A12', 'FBEFD5'],
  completed: ['257A4A', 'DFF3E6'],
  cancelled: ['7A7A7A', 'EDEDED'],
  no_show: ['A82E6C', 'FBE3EE'],
};
const PAY_COLORS: Record<string, [string, string]> = {
  unpaid: ['A82E6C', 'FBE3EE'],
  partial: ['9A6A12', 'FBEFD5'],
  paid: ['257A4A', 'DFF3E6'],
};

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

/** Registro de estilos: cada combinación de fuente/relleno/borde/formato recibe un número y no se repite. */
class Styles {
  fonts: string[] = [];
  fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  xfs: string[] = [];
  private idx = new Map<string, number>();
  constructor() {
    this.font({});
    this.xf({});
  }
  private pick(list: string[], xml: string) {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }
  font(o: { b?: boolean; i?: boolean; sz?: number; color?: string; name?: string }) {
    return this.pick(
      this.fonts,
      `<font>${o.b ? '<b/>' : ''}${o.i ? '<i/>' : ''}<sz val="${o.sz ?? 11}"/><color rgb="FF${o.color ?? C.text}"/><name val="${o.name ?? 'Calibri'}"/></font>`,
    );
  }
  fill(rgb?: string) {
    return rgb ? this.pick(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
  }
  border(o: { bottom?: [string, string]; top?: [string, string] }) {
    const side = (n: string, v?: [string, string]) => (v ? `<${n} style="${v[0]}"><color rgb="FF${v[1]}"/></${n}>` : `<${n}/>`);
    return this.pick(this.borders, `<border><left/><right/>${side('top', o.top)}${side('bottom', o.bottom)}<diagonal/></border>`);
  }
  xf(o: {
    font?: Parameters<Styles['font']>[0];
    fill?: string;
    border?: Parameters<Styles['border']>[0];
    numFmt?: number;
    h?: 'left' | 'center' | 'right';
    v?: 'top' | 'center';
    wrap?: boolean;
    indent?: number;
  }) {
    const key = JSON.stringify(o);
    const hit = this.idx.get(key);
    if (hit !== undefined) return hit;
    const f = this.font(o.font ?? {});
    const fi = this.fill(o.fill);
    const b = this.border(o.border ?? {});
    const align = `<alignment horizontal="${o.h ?? 'left'}" vertical="${o.v ?? 'center'}"${o.wrap ? ' wrapText="1"' : ''}${o.indent ? ` indent="${o.indent}"` : ''}/>`;
    this.xfs.push(
      `<xf numFmtId="${o.numFmt ?? 0}" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`,
    );
    this.idx.set(key, this.xfs.length - 1);
    return this.xfs.length - 1;
  }
  xml() {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>` +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
    );
  }
}

export function buildXlsx(items: Appointment[], fmt: ExportFmt, business = 'AstroBloomx'): Uint8Array {
  const rows = toRows(items, fmt);
  const n = HEADERS.length;
  const widths = [12, 10, 10, 26, 20, 40, 18, 28, 15, 15, 9, 15, 13, 15, 13, 13, 22, 44];
  const st = new Styles();
  const HEAD_ROW = 4;
  const FIRST = HEAD_ROW + 1;
  const LAST = HEAD_ROW + rows.length;

  const cells: Record<number, string> = {};
  const put = (r: number, c: number, v: string | number | null, style: number, formula?: string) => {
    const ref = `${colName(c)}${r}`;
    let x: string;
    if (v === null) x = `<c r="${ref}" s="${style}"/>`;
    else if (formula) x = `<c r="${ref}" s="${style}"><f>${esc(formula)}</f><v>${Number(v) || 0}</v></c>`;
    else if (typeof v === 'number') x = `<c r="${ref}" s="${style}"><v>${Number.isFinite(v) ? v : 0}</v></c>`;
    else x = `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    cells[r] = (cells[r] ?? '') + x;
  };
  const rowAttrs: Record<number, string> = {};

  // Título
  const titleXf = st.xf({ font: { b: true, sz: 20, color: C.plum, name: 'Georgia' }, fill: C.blush, h: 'left', indent: 1 });
  const subXf = st.xf({ font: { i: true, sz: 10, color: C.muted }, fill: C.blush, h: 'left', indent: 1, border: { bottom: ['medium', C.gold] } });
  put(1, 0, `✦ ${business} · Citas`, titleXf);
  for (let c = 1; c < n; c++) put(1, c, null, titleXf);
  put(2, 0, `${items.length} cita(s) · generado el ${fmt.today()}`, subXf);
  for (let c = 1; c < n; c++) put(2, c, null, subXf);
  rowAttrs[1] = ' ht="36" customHeight="1"';
  rowAttrs[2] = ' ht="20" customHeight="1"';
  rowAttrs[3] = ' ht="8" customHeight="1"';

  // Encabezado
  const headXf = st.xf({ font: { b: true, sz: 11, color: 'FFFFFF' }, fill: C.plumMid, h: 'center', wrap: true, border: { bottom: ['medium', C.gold] } });
  HEADERS.forEach((h, c) => put(HEAD_ROW, c, h, headXf));
  rowAttrs[HEAD_ROW] = ' ht="30" customHeight="1"';

  // Datos
  rows.forEach((row, i) => {
    const r = FIRST + i;
    const a = items[i];
    const fill = i % 2 ? C.zebra : undefined;
    const border = { bottom: ['thin', C.line] as [string, string] };
    row.forEach((v, c) => {
      let style: number;
      if (MONEY_COLS.has(c)) style = st.xf({ fill, border, numFmt: 164, h: 'right', font: c === 13 ? { b: true } : {} });
      else if (c === 9 || c === 16) {
        const [fg, bg] = (c === 9 ? STATUS_COLORS[a.status] : PAY_COLORS[a.payment_status]) ?? [C.text, C.zebra];
        style = st.xf({ font: { b: true, sz: 10, color: fg }, fill: bg, border, h: 'center' });
      } else if (c === 0 || c === 1 || c === 2 || c === 10) style = st.xf({ fill, border, h: 'center' });
      else if (c === 3) style = st.xf({ fill, border, font: { b: true } });
      else style = st.xf({ fill, border, wrap: true, v: 'center' });
      put(r, c, v, style);
    });
  });

  // Totales por moneda (con fórmulas, para que sigan vivos si editas)
  const totals = Object.entries(totalsByCurrency(items));
  let r = LAST + 2;
  const totLabel = st.xf({ font: { b: true, color: C.plum }, fill: C.goldSoft, border: { top: ['medium', C.gold] }, h: 'right' });
  const totMoney = st.xf({ font: { b: true, color: C.plum }, fill: C.goldSoft, border: { top: ['medium', C.gold] }, numFmt: 164, h: 'right' });
  const totBlank = st.xf({ fill: C.goldSoft, border: { top: ['medium', C.gold] } });
  const rng = (col: string) => `${col}${FIRST}:${col}${LAST}`;
  for (const [cur, t] of totals) {
    for (let c = 0; c < n; c++) put(r, c, null, totBlank);
    cells[r] = ''; // reiniciar fila
    for (let c = 0; c < 11; c++) {
      if (c === 10) put(r, c, `Total ${cur} (sin canceladas)`, totLabel);
      else put(r, c, null, totBlank);
    }
    const sum = (col: string) =>
      `SUMIFS(${rng(col)},${rng('J')},"<>${STATUS_LABELS.cancelled}",${rng('J')},"<>${STATUS_LABELS.no_show}",${rng('K')},"${cur}")`;
    put(r, 11, null, totBlank);
    put(r, 12, null, totBlank);
    put(r, 13, t.total, totMoney, sum('N'));
    put(r, 14, t.paid, totMoney, sum('O'));
    put(r, 15, t.balance, totMoney, sum('P'));
    for (let c = 16; c < n; c++) put(r, c, null, totBlank);
    rowAttrs[r] = ' ht="24" customHeight="1"';
    r++;
  }
  // Las dos celdas de relleno 11 y 12 quedan vacías en los totales
  const rowNums = Object.keys(cells).map(Number).sort((a, b) => a - b);
  const sheetData = rowNums.map((k) => `<row r="${k}"${rowAttrs[k] ?? ''}>${cells[k]}</row>`).join('');

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetPr><tabColor rgb="FF${C.plumMid}"/><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="${HEAD_ROW}" topLeftCell="A${FIRST}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="20" customHeight="1"/>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${sheetData}</sheetData>` +
    (rows.length ? `<autoFilter ref="A${HEAD_ROW}:${colName(n - 1)}${LAST}"/>` : '') +
    `<mergeCells count="2"><mergeCell ref="A1:${colName(n - 1)}1"/><mergeCell ref="A2:${colName(n - 1)}2"/></mergeCells>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;

  const files = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Citas" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/styles.xml': strToU8(st.xml()),
  };
  return zipSync(files);
}

export function downloadXlsx(items: Appointment[], fmt: ExportFmt, business = 'AstroBloomx') {
  const bytes = buildXlsx(items, fmt, business);
  save(
    new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `citas-${fmt.today()}.xlsx`,
  );
}

// ---------- PDF ----------
/** El PDF usa letras estándar: se quitan emojis y símbolos que no soporta. */
const pdfText = (s: string | number) => String(s).replace(/[^ -~ -ÿ\n]/g, '').replace(/ {2,}/g, ' ').trim();
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];

export async function downloadPdf(items: Appointment[], fmt: ExportFmt, businessName: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const money = (n: number, c: string) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
  const biz = pdfText(businessName) || 'AstroBloomx';

  // Encabezado de la primera página: franja morada con filo dorado
  const banner = () => {
    doc.setFillColor(...rgb(C.plum));
    doc.rect(0, 0, W, 64, 'F');
    doc.setFillColor(...rgb(C.gold));
    doc.rect(0, 64, W, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('times', 'bold');
    doc.setFontSize(22);
    doc.text(biz, M, 33);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...rgb('EAD7A8'));
    doc.text('A G E N D A   ·   R E P O R T E   D E   C I T A S', M, 49);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text(`${items.length} cita(s)`, W - M, 33, { align: 'right' });
    doc.setFontSize(9);
    doc.setTextColor(...rgb('EAD7A8'));
    doc.text(`Generado el ${fmt.today()}`, W - M, 49, { align: 'right' });
  };
  banner();

  // Columnas del PDF: las más útiles para leer en papel
  const rows = toRows(items, fmt);
  const cols = [0, 1, 3, 5, 6, 7, 9, 13, 14, 15, 16];
  const SHORT_PAY: Record<string, string> = { 'Abonada parcialmente': 'Abonada', 'Pagada completamente': 'Pagada' };
  const body = rows.map((r) => cols.map((c) => (MONEY_COLS.has(c) ? money(Number(r[c]), String(r[10])) : c === 16 ? SHORT_PAY[String(r[c])] ?? pdfText(r[c]) : pdfText(r[c]))));
  const colIdx = (c: number) => cols.indexOf(c);

  autoTable(doc, {
    startY: 84,
    head: [cols.map((c) => HEADERS[c])],
    body,
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { fontSize: 8.5, cellPadding: { top: 6, bottom: 6, left: 6, right: 6 }, textColor: rgb(C.text), valign: 'middle', lineColor: rgb(C.line), lineWidth: { bottom: 0.5 } as never, overflow: 'linebreak' },
    headStyles: { fillColor: rgb(C.plumMid), textColor: 255, fontStyle: 'bold', halign: 'center', lineWidth: 0 },
    alternateRowStyles: { fillColor: rgb(C.zebra) },
    columnStyles: {
      [colIdx(0)]: { halign: 'center', cellWidth: 54 },
      [colIdx(1)]: { halign: 'center', cellWidth: 46 },
      [colIdx(3)]: { cellWidth: 104 },
      [colIdx(5)]: { cellWidth: 140 },
      [colIdx(6)]: { cellWidth: 50 },
      [colIdx(7)]: { cellWidth: 66 },
      [colIdx(9)]: { halign: 'center', cellWidth: 58 },
      [colIdx(13)]: { halign: 'right', fontStyle: 'bold', cellWidth: 66 },
      [colIdx(14)]: { halign: 'right', cellWidth: 62 },
      [colIdx(15)]: { halign: 'right', cellWidth: 62 },
      [colIdx(16)]: { halign: 'center', cellWidth: 58 },
    },
    margin: { left: M, right: M, top: 40, bottom: 40 },
    // Etiquetas de color para el estado de la cita y del pago
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      const a = items[d.row.index];
      const col = cols[d.column.index];
      const pair = col === 9 ? STATUS_COLORS[a?.status] : col === 16 ? PAY_COLORS[a?.payment_status] : undefined;
      if (pair) {
        d.cell.styles.textColor = rgb(pair[0]);
        d.cell.styles.fillColor = rgb(pair[1]);
        d.cell.styles.fontStyle = 'bold';
      }
      if (col === 15 && a && a.balance > 0.004 && a.status !== 'cancelled') d.cell.styles.textColor = rgb('A82E6C');
    },
    // Línea dorada bajo el encabezado
    didDrawCell: (d) => {
      if (d.section === 'head') {
        doc.setDrawColor(...rgb(C.gold));
        doc.setLineWidth(1.5);
        doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
      }
    },
  });

  // Tarjetas de totales por moneda
  const totals = Object.entries(totalsByCurrency(items));
  if (totals.length) {
    let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100) + 22;
    const cardH = 52;
    if (y + cardH > H - 50) {
      doc.addPage();
      y = 50;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...rgb(C.muted));
    doc.text('TOTALES (SIN CANCELADAS)', M, y - 8);
    const gap = 12;
    const w = Math.min(250, (W - 2 * M - gap * (totals.length - 1)) / totals.length);
    totals.forEach(([cur, t], i) => {
      const x = M + i * (w + gap);
      doc.setFillColor(...rgb(C.goldSoft));
      doc.setDrawColor(...rgb(C.gold));
      doc.setLineWidth(0.8);
      doc.roundedRect(x, y, w, cardH, 8, 8, 'FD');
      doc.setTextColor(...rgb(C.plum));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(money(t.total, cur), x + 12, y + 22);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...rgb('257A4A'));
      doc.text(`Abonado ${money(t.paid, cur)}`, x + 12, y + 37);
      doc.setTextColor(...rgb('A82E6C'));
      doc.text(`Por cobrar ${money(t.balance, cur)}`, x + 12, y + 48);
    });
  }

  // Pie de página en todas las hojas
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...rgb(C.gold));
    doc.setLineWidth(0.6);
    doc.line(M, H - 30, W - M, H - 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...rgb(C.muted));
    doc.text(biz, M, H - 17);
    doc.text(`Página ${p} de ${pages}`, W - M, H - 17, { align: 'right' });
  }
  doc.save(`citas-${fmt.today()}.pdf`);
}
