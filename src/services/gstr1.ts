// GSTR-1 for a month, from the bills (research: reports/, compliance table rows 7-8). Sections the shop's accountant
// uploads through the GST offline tool: B2B, B2CL (inter-state B2C bill above Rs 1 lakh, from 1 Aug 2024),
// B2CS (other B2C, by place of supply and rate, credit notes netted), CDNR (credit notes to registered buyers),
// HSN summary (Table 12, B2B and B2C tabs from the May 2025 return) and documents issued (Table 13).
// Composition dealers do not file GSTR-1 (they file CMP-08 / GSTR-4), so their Bills of Supply are left out.
// Amounts are paise; the CSVs give rupees with two decimals, with the offline tool's column headings.
import { all, get, AppError } from '../store/db.ts';
import type { Ctx } from './ctx.ts';
import { getDevice } from './ctx.ts';

export const STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};
export const B2CL_LIMIT = 10_000_000; // Rs 1 lakh (Notf 12/2024-CT, from 1 Aug 2024)

const pos = (code: string) => `${code}-${STATES[code] ?? 'Unknown'}`;
const rs = (p: number) => (p / 100).toFixed(2);
const rate = (bp: number) => String(bp / 100);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const istDate = (ms: number) => { const d = new Date(ms + 330 * 60_000); return `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`; };

interface Inv { id: string; doc_type: 'TAX_INVOICE' | 'CREDIT_NOTE'; invoice_no: string; issued_at: number; buyer_gstin: string | null; place_of_supply: string; grand_total: number; status: string; original_invoice_id: string | null; series_id: string; seq_no: number; customer_name: string | null }
interface Line { invoice_id: string; hsn_code: string | null; uqc: string | null; name: string; qty_milli: number; rate_bp: number; taxable: number; cgst: number; sgst: number; igst: number; cess: number; line_total: number }

/** "2026-10" -> [start, end) in epoch ms (IST month). */
function monthRange(month: string): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new AppError('VALIDATION', 'Month must be YYYY-MM.');
  const y = Number(m[1]), mo = Number(m[2]);
  const start = Date.UTC(y, mo - 1, 1) - 330 * 60_000, end = Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1) - 330 * 60_000;
  return [start, end];
}

export function gstr1(ctx: Ctx, month: string) {
  const [from, to] = monthRange(month);
  const home = get<{ state_code: string; gstin: string | null }>(ctx.db, 'SELECT state_code, gstin FROM outlet WHERE id = ?', getDevice(ctx).outletId)!;
  const invs = all<Inv>(ctx.db, `SELECT i.id, i.doc_type, i.invoice_no, i.issued_at, i.buyer_gstin, i.place_of_supply, i.grand_total, i.status, i.original_invoice_id, i.series_id, i.seq_no,
      c.name AS customer_name FROM invoice i LEFT JOIN customer c ON c.id = i.customer_id
     WHERE i.issued_at >= ? AND i.issued_at < ? AND i.gst_scheme = 'regular' ORDER BY i.issued_at, i.invoice_no`, from, to);
  const lines = new Map<string, Line[]>();
  for (const l of all<Line>(ctx.db, `SELECT l.invoice_id, l.hsn_code, l.uqc, l.name, l.qty_milli, l.rate_bp, l.taxable, l.cgst, l.sgst, l.igst, l.cess, l.line_total
      FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id WHERE i.issued_at >= ? AND i.issued_at < ? AND i.gst_scheme = 'regular'`, from, to)) {
    lines.set(l.invoice_id, [...(lines.get(l.invoice_id) ?? []), l]);
  }
  const byRate = (ls: Line[]) => {
    const m = new Map<number, { rateBp: number; taxable: number; cess: number; igst: number; cgst: number; sgst: number }>();
    for (const l of ls) {
      const r = m.get(l.rate_bp) ?? { rateBp: l.rate_bp, taxable: 0, cess: 0, igst: 0, cgst: 0, sgst: 0 };
      r.taxable += l.taxable; r.cess += l.cess; r.igst += l.igst; r.cgst += l.cgst; r.sgst += l.sgst;
      m.set(l.rate_bp, r);
    }
    return [...m.values()].sort((a, b) => a.rateBp - b.rateBp);
  };
  const live = invs.filter((i) => i.status === 'ISSUED');
  const original = new Map(all<{ id: string; buyer_gstin: string | null; place_of_supply: string; grand_total: number; invoice_no: string; issued_at: number }>(ctx.db,
    "SELECT id, buyer_gstin, place_of_supply, grand_total, invoice_no, issued_at FROM invoice WHERE doc_type = 'TAX_INVOICE'").map((o) => [o.id, o]));

  const b2b = live.filter((i) => i.doc_type === 'TAX_INVOICE' && i.buyer_gstin).map((i) => ({
    gstin: i.buyer_gstin!, name: i.customer_name, invoiceNo: i.invoice_no, date: istDate(i.issued_at), value: i.grand_total, pos: i.place_of_supply, rates: byRate(lines.get(i.id) ?? []),
  }));
  const isB2cl = (i: { buyer_gstin: string | null; place_of_supply: string; grand_total: number }) => !i.buyer_gstin && i.place_of_supply !== home.state_code && i.grand_total > B2CL_LIMIT;
  const b2cl = live.filter((i) => i.doc_type === 'TAX_INVOICE' && isB2cl(i)).map((i) => ({ invoiceNo: i.invoice_no, date: istDate(i.issued_at), value: i.grand_total, pos: i.place_of_supply, rates: byRate(lines.get(i.id) ?? []) }));

  // B2CS: other B2C sales minus their credit notes, by place of supply and rate
  const b2csMap = new Map<string, { pos: string; rateBp: number; taxable: number; cess: number }>();
  for (const i of live) {
    const base = i.doc_type === 'TAX_INVOICE' ? i : original.get(i.original_invoice_id ?? '');
    if (!base || base.buyer_gstin || isB2cl(base)) continue;
    const sign = i.doc_type === 'TAX_INVOICE' ? 1 : -1;
    for (const r of byRate(lines.get(i.id) ?? [])) {
      const k = `${i.place_of_supply}|${r.rateBp}`;
      const e = b2csMap.get(k) ?? { pos: i.place_of_supply, rateBp: r.rateBp, taxable: 0, cess: 0 };
      e.taxable += sign * r.taxable; e.cess += sign * r.cess;
      b2csMap.set(k, e);
    }
  }
  const b2cs = [...b2csMap.values()].filter((e) => e.taxable !== 0 || e.cess !== 0).sort((a, b) => a.pos.localeCompare(b.pos) || a.rateBp - b.rateBp);

  const cdnr = live.filter((i) => i.doc_type === 'CREDIT_NOTE' && original.get(i.original_invoice_id ?? '')?.buyer_gstin).map((i) => ({
    gstin: original.get(i.original_invoice_id!)!.buyer_gstin!, name: i.customer_name, noteNo: i.invoice_no, date: istDate(i.issued_at), value: i.grand_total, pos: i.place_of_supply, rates: byRate(lines.get(i.id) ?? []),
  }));
  const cdnur = live.filter((i) => i.doc_type === 'CREDIT_NOTE' && isB2cl(original.get(i.original_invoice_id ?? '') ?? { buyer_gstin: 'x', place_of_supply: '', grand_total: 0 })).map((i) => ({
    noteNo: i.invoice_no, date: istDate(i.issued_at), value: i.grand_total, pos: i.place_of_supply, rates: byRate(lines.get(i.id) ?? []),
  }));

  // HSN summary (Table 12), split into B2B and B2C; credit notes reduce it
  const hsn = (b2bSide: boolean) => {
    const m = new Map<string, { hsn: string; description: string; uqc: string; qtyMilli: number; value: number; rateBp: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number }>();
    for (const i of live) {
      const base = i.doc_type === 'TAX_INVOICE' ? i : original.get(i.original_invoice_id ?? '');
      if (!base || Boolean(base.buyer_gstin) !== b2bSide) continue;
      const sign = i.doc_type === 'TAX_INVOICE' ? 1 : -1;
      for (const l of lines.get(i.id) ?? []) {
        const key = `${l.hsn_code ?? ''}|${l.uqc ?? 'NOS'}|${l.rate_bp}`;
        const e = m.get(key) ?? { hsn: l.hsn_code ?? '', description: l.name, uqc: l.uqc ?? 'NOS', qtyMilli: 0, value: 0, rateBp: l.rate_bp, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
        e.qtyMilli += sign * l.qty_milli; e.value += sign * l.line_total; e.taxable += sign * l.taxable; e.igst += sign * l.igst; e.cgst += sign * l.cgst; e.sgst += sign * l.sgst; e.cess += sign * l.cess;
        m.set(key, e);
      }
    }
    return [...m.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rateBp - b.rateBp);
  };
  const missingHsn = [...new Set(live.flatMap((i) => (lines.get(i.id) ?? []).filter((l) => !l.hsn_code || !/^\d{4,8}$/.test(l.hsn_code)).map((l) => l.name)))];

  // Table 13: per series, the first and last number, how many, how many cancelled
  const docs = [...invs.reduce((m, i) => {
    const e = m.get(i.series_id) ?? { nature: i.doc_type === 'TAX_INVOICE' ? 'Invoices for outward supply' : 'Credit Note', from: i.invoice_no, to: i.invoice_no, minSeq: i.seq_no, maxSeq: i.seq_no, total: 0, cancelled: 0 };
    if (i.seq_no < e.minSeq) { e.minSeq = i.seq_no; e.from = i.invoice_no; }
    if (i.seq_no > e.maxSeq) { e.maxSeq = i.seq_no; e.to = i.invoice_no; }
    e.total++; if (i.status === 'CANCELLED') e.cancelled++;
    return m.set(i.series_id, e);
  }, new Map<string, { nature: string; from: string; to: string; minSeq: number; maxSeq: number; total: number; cancelled: number }>()).values()]
    .map(({ nature, from: f, to: t, total, cancelled }) => ({ nature, from: f, to: t, total, cancelled }));

  return { month, gstin: home.gstin, homeState: home.state_code, b2b, b2cl, b2cs, cdnr, cdnur, hsnB2b: hsn(true), hsnB2c: hsn(false), docs, missingHsn };
}

const csv = (rows: Array<Array<string | number | null>>) => rows.map((r) => r.map((v) => { const s = v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n') + '\r\n';

/** The CSV files for the GST offline tool, one per section. */
export function gstr1Csv(ctx: Ctx, month: string): Record<string, string> {
  const g = gstr1(ctx, month);
  return {
    'b2b.csv': csv([['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'],
      ...g.b2b.flatMap((i) => i.rates.map((r) => [i.gstin, i.name, i.invoiceNo, i.date, rs(i.value), pos(i.pos), 'N', '', 'Regular B2B', '', rate(r.rateBp), rs(r.taxable), rs(r.cess)]))]),
    'b2cl.csv': csv([['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
      ...g.b2cl.flatMap((i) => i.rates.map((r) => [i.invoiceNo, i.date, rs(i.value), pos(i.pos), '', rate(r.rateBp), rs(r.taxable), rs(r.cess), '']))]),
    'b2cs.csv': csv([['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
      ...g.b2cs.map((e) => ['OE', pos(e.pos), '', rate(e.rateBp), rs(e.taxable), rs(e.cess), ''])]),
    'cdnr.csv': csv([['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'],
      ...g.cdnr.flatMap((n) => n.rates.map((r) => [n.gstin, n.name, n.noteNo, n.date, 'C', pos(n.pos), 'N', 'Regular B2B', rs(n.value), '', rate(r.rateBp), rs(r.taxable), rs(r.cess)]))]),
    'cdnur.csv': csv([['UR Type', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'],
      ...g.cdnur.flatMap((n) => n.rates.map((r) => ['B2CL', n.noteNo, n.date, 'C', pos(n.pos), rs(n.value), '', rate(r.rateBp), rs(r.taxable), rs(r.cess)]))]),
    ...Object.fromEntries((['b2b', 'b2c'] as const).map((side) => [`hsn_${side}.csv`, csv([['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
      ...(side === 'b2b' ? g.hsnB2b : g.hsnB2c).map((h) => [h.hsn, h.description, h.uqc, (h.qtyMilli / 1000).toFixed(3), rs(h.value), rate(h.rateBp), rs(h.taxable), rs(h.igst), rs(h.cgst), rs(h.sgst), rs(h.cess)])])])),
    'docs.csv': csv([['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'], ...g.docs.map((d) => [d.nature, d.from, d.to, d.total, d.cancelled])]),
  };
}

/**
 * Composition dealers (CMP-08, quarterly): outward turnover of the quarter, split into taxable goods (taxed at 1%:
 * 0.5% CGST + 0.5% SGST for traders, CGST Act s.10) and exempt goods (no tax), credit notes netted. quarter is the
 * financial year and quarter, e.g. "2026-27-Q3" = October to December 2026.
 * A composition bill charges no tax, so its lines carry 0%; whether a line's goods are taxable is read from the
 * item's GST rate (today's rate: a rate change inside the quarter is not reflected; check with the CA then).
 */
export function compositionSummary(ctx: Ctx, quarter: string, traderRateBp = 100) {
  const m = /^(\d{4})-(\d{2})-Q([1-4])$/.exec(quarter);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) throw new AppError('VALIDATION', 'Quarter must be like 2026-27-Q3.');
  const fyStart = Number(m[1]), q = Number(m[3]);
  const firstMonth = 4 + (q - 1) * 3; // Q1 = Apr-Jun ... Q4 = Jan-Mar of the next year
  const ym = (k: number) => { const mm = firstMonth + k; const y = mm > 12 ? fyStart + 1 : fyStart; return `${y}-${String(((mm - 1) % 12) + 1).padStart(2, '0')}`; };
  const [from] = monthRange(ym(0)), [, to] = monthRange(ym(2));
  const rows = all<{ doc_type: string; line_total: number; rate_bp: number | null }>(ctx.db,
    `SELECT i.doc_type, l.line_total, t.rate_bp FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
       LEFT JOIN item it ON it.id = l.item_id LEFT JOIN tax_group t ON t.id = it.tax_group_id
      WHERE i.gst_scheme = 'composition' AND i.status = 'ISSUED' AND i.issued_at >= ? AND i.issued_at < ?`, from, to);
  let taxable = 0, exempt = 0;
  for (const r of rows) {
    const v = r.doc_type === 'CREDIT_NOTE' ? -r.line_total : r.line_total;
    if ((r.rate_bp ?? 0) > 0) taxable += v; else exempt += v;
  }
  const tax = Math.round((taxable * traderRateBp) / 10000);
  const cgst = Math.floor(tax / 2);
  return { quarter, from: ym(0), to: ym(2), taxableTurnover: taxable, exemptTurnover: exempt, totalTurnover: taxable + exempt, rateBp: traderRateBp, cgst, sgst: tax - cgst, tax };
}
