// Barcode / shelf labels (V20) in TSPL (TSC, TVS and most label printers sold in India) or ZPL II (Zebra; Godex in
// emulation), sent RAW. Never through the Windows driver's graphics path: it blurs barcodes. Built-in printer fonts
// have no rupee sign, so prices print as "Rs". research: reports/ "Hardware runs on five byte-level formats".
import { all, get, AppError } from '../../store/db.ts';
import type { Actor, Ctx } from '../ctx.ts';
import { runCommand } from '../commands.ts';
import { audit } from '../audit.ts';
import { assertPerm } from '../permissions.ts';
import { enqueueJob } from './jobs.ts';
import { isValidGtin } from '../../core/barcode.ts';
import { mulDivRound } from '../../core/money.ts';

export type LabelLang = 'tspl' | 'zpl';
export interface LabelSize { wMm: number; hMm: number; gapMm: number }
export interface LabelData {
  name: string;
  /** Paise. Printed as "MRP Rs 125.00 (Incl. of all taxes)" (Legal Metrology declaration). */
  mrp: number | null;
  /** The shop's price when it is below MRP ("Our price"). */
  price: number | null;
  /** The code to print as a barcode: EAN-13 when it is a valid 13-digit GTIN, else Code 128. */
  barcode: string | null;
  /** Unit sale price for pre-packaged goods (LMPC Rules 2021), e.g. "Rs 12.50/100g". */
  unitPrice?: string | null;
  batchNo?: string | null;
  expiry?: string | null;
}

const DOTS_PER_MM = 8; // 203 dpi
/** Only printable ASCII reaches the printer (no rupee sign or Indian scripts in built-in fonts); quotes are made safe. */
const ascii = (s: string) => s.replace(/₹/g, 'Rs ').replace(/[^\x20-\x7e]/g, '?').replace(/"/g, "'");
const rs = (p: number) => `Rs ${(p / 100).toFixed(2)}`;
const fit = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, chars - 1)}.` : s);

/**
 * The text lines, most important first, cut to what fits above the barcode: the name and the MRP declaration always
 * (never shortened: "MRP Rs x (Incl. of all taxes)" goes on two lines when one is too narrow), then our price, unit
 * price, batch and expiry.
 */
function lines(d: LabelData, chars: number, maxLines: number): string[] {
  const must = [fit(ascii(d.name), chars)];
  if (d.mrp !== null) {
    const full = `MRP ${rs(d.mrp)} (Incl. of all taxes)`;
    must.push(...(full.length <= chars ? [full] : [`MRP ${rs(d.mrp)}`, '(Incl. of all taxes)']));
  }
  const extra: string[] = [];
  if (d.price !== null && d.mrp !== null && d.price < d.mrp) extra.push(fit(`Our price ${rs(d.price)}`, chars));
  else if (d.price !== null && d.mrp === null) extra.push(fit(`Price ${rs(d.price)}`, chars));
  if (d.unitPrice) extra.push(fit(ascii(d.unitPrice), chars));
  if (d.batchNo || d.expiry) extra.push(fit(ascii([d.batchNo ? `B:${d.batchNo}` : '', d.expiry ? `EXP:${d.expiry}` : ''].filter(Boolean).join(' ')), chars));
  return [...must, ...extra.slice(0, Math.max(0, maxLines - must.length))];
}

/** One label's commands; copies prints the same label n times. */
export function renderLabel(lang: LabelLang, size: LabelSize, d: LabelData, copies = 1): string {
  if (!Number.isInteger(copies) || copies < 1 || copies > 999) throw new AppError('VALIDATION', 'Copies must be 1 to 999.');
  const w = size.wMm * DOTS_PER_MM, h = size.hMm * DOTS_PER_MM;
  const chars = Math.max(8, Math.floor((w - 24) / 12)); // font "2" / 22-dot font is about 12 dots a character
  const ean = d.barcode && /^\d{13}$/.test(d.barcode) && isValidGtin(d.barcode);
  const code = d.barcode ? ascii(d.barcode) : null;
  const lineH = 24;
  // leave about 96 dots for the barcode and its digits when there is one
  const text = lines(d, chars, Math.max(2, Math.floor((h - 8 - (code ? 96 : 0)) / lineH)));
  const textBottom = 8 + text.length * lineH;
  const barH = Math.max(32, Math.min(80, h - textBottom - 36));
  // EAN-13 at narrow 2 is about 226 dots with quiet zones; centre it
  const barX = Math.max(8, Math.floor((w - (ean ? 226 : Math.min(w - 16, 22 * (code?.length ?? 0) + 70))) / 2));
  if (lang === 'tspl') {
    const out = [`SIZE ${size.wMm} mm,${size.hMm} mm`, `GAP ${size.gapMm} mm,0 mm`, 'DIRECTION 1', 'REFERENCE 0,0', 'CODEPAGE 1252', 'CLS'];
    text.forEach((t, i) => out.push(`TEXT 16,${8 + i * lineH},"2",0,1,1,"${t}"`));
    if (code) out.push(ean ? `BARCODE ${barX},${textBottom + 4},"EAN13",${barH},1,0,2,2,"${code.slice(0, 12)}"` : `BARCODE ${barX},${textBottom + 4},"128",${barH},1,0,2,2,"${code}"`);
    out.push(`PRINT 1,${copies}`);
    return out.join('\r\n') + '\r\n';
  }
  const out = ['^XA', `^PW${w}^LL${h}^LH0,0^CI28`];
  text.forEach((t, i) => out.push(`^FO16,${8 + i * lineH}^A0N,22,22^FD${t}^FS`));
  if (code) out.push(ean ? `^FO${barX},${textBottom + 4}^BY2^BEN,${barH},Y,N^FD${code.slice(0, 12)}^FS` : `^FO${barX},${textBottom + 4}^BY2^BCN,${barH},Y,N,N^FD${code}^FS`);
  out.push(`^PQ${copies}`, '^XZ');
  return out.join('\n') + '\n';
}

/** Unit sale price text from the pack size in the name, e.g. "Basmati Rice 5kg" at Rs 600 -> "Rs 120.00/kg"; null when not found. */
export function unitPriceText(name: string, price: number): string | null {
  const m = /(\d+(?:\.\d+)?)\s*(kg|g|gm|l|ltr|ml)\b/i.exec(name);
  if (!m) return null;
  const n = Number(m[1]), u = m[2]!.toLowerCase();
  if (!(n > 0)) return null;
  const milli = Math.round(n * 1000);
  if (u === 'kg' || u === 'l' || u === 'ltr') return `${rs(mulDivRound(price, 1000, milli))}/${u === 'kg' ? 'kg' : 'l'}`;
  // grams / ml: per 100 (the usual shelf unit)
  return `${rs(mulDivRound(price, 100 * 1000, milli))}/100${u === 'ml' ? 'ml' : 'g'}`;
}

interface LabelPrinter { id: string; name: string; label_lang: LabelLang | null; label_w_mm: number; label_h_mm: number; label_gap_mm: number; active: number }

/** Labels for items (and their batches): one job per item, with its copies. */
export function printLabels(ctx: Ctx, actor: Actor, requestId: string, input: { printerId: string; items: Array<{ itemId: string; batchId?: string | null; copies: number }> }) {
  return runCommand(ctx, requestId, 'labels.print', actor, () => {
    assertPerm(actor, 'catalog.write');
    const p = get<LabelPrinter>(ctx.db, 'SELECT id, name, label_lang, label_w_mm, label_h_mm, label_gap_mm, active FROM printer WHERE id = ?', input.printerId);
    if (!p || p.active !== 1) throw new AppError('NOT_FOUND', 'Printer not found or switched off.', 404);
    if (!p.label_lang) throw new AppError('NOT_A_LABEL_PRINTER', `${p.name} is not set up as a label printer (Settings > Printers: label language).`, 422);
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 500) throw new AppError('VALIDATION', 'Choose 1 to 500 items.');
    const jobs: string[] = [];
    for (const [n, it] of input.items.entries()) {
      const item = get<{ name: string; mrp: number | null; price: number; barcode: string | null; sku: string | null }>(ctx.db, 'SELECT name, mrp, price, barcode, sku FROM item WHERE id = ? AND deleted_at IS NULL', it.itemId);
      if (!item) throw new AppError('NOT_FOUND', 'Item not found.', 404);
      const b = it.batchId ? get<{ batch_no: string; expiry_date: string | null; mrp: number | null; sale_price: number | null }>(ctx.db, 'SELECT batch_no, expiry_date, mrp, sale_price FROM batch WHERE id = ? AND item_id = ?', it.batchId, it.itemId) : null;
      const code = item.barcode ?? all<{ code: string }>(ctx.db, 'SELECT code FROM item_scan_code WHERE item_id = ? AND pack_qty_milli = 1000 ORDER BY created_at LIMIT 1', it.itemId)[0]?.code ?? item.sku;
      const price = b?.sale_price ?? item.price;
      const data: LabelData = { name: item.name, mrp: b?.mrp ?? item.mrp, price, barcode: code, unitPrice: unitPriceText(item.name, price), batchNo: b?.batch_no ?? null, expiry: b?.expiry_date ?? null };
      const payload = new TextEncoder().encode(renderLabel(p.label_lang, { wMm: p.label_w_mm, hMm: p.label_h_mm, gapMm: p.label_gap_mm }, data, it.copies));
      const id = enqueueJob(ctx, { kind: 'LABEL', refId: it.itemId, printerId: p.id, payload, dedupeKey: `label:${requestId}:${n}` });
      if (id) jobs.push(id);
    }
    audit(ctx, actor.userId, 'labels.print', 'printer', p.id, { items: input.items.length, copies: input.items.reduce((s, i) => s + i.copies, 0) });
    return { jobs: jobs.length, printer: p.name };
  });
}
