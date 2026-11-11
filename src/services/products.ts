// Retail products (V16): brands, several scan codes per item, size/colour variants, batches with expiry and MRP,
// weighing-scale barcode layouts, and what a scan at the counter means (lookupScan).
import { all, get, run, AppError } from '../store/db.ts';
import type { Actor, Ctx } from './ctx.ts';
import { runCommand } from './commands.ts';
import { audit } from './audit.ts';
import { emit } from './outbox.ts';
import { assertPerm } from './permissions.ts';
import { camelAll } from './camel.ts';
import { createItem, type ItemInput } from './catalog.ts';
import { barcodeKey, classifyScan, DEFAULT_SCALE_PROFILES, validateScaleProfile, type ScaleProfile } from '../core/barcode.ts';
import { mulDivRound } from '../core/money.ts';
import { istDay } from '../core/numbering.ts';

function fail(msg: string): never { throw new AppError('VALIDATION', msg); }
const text = (v: unknown, label: string, max: number) => {
  if (typeof v !== 'string' || !v.trim()) fail(`${label} is required.`);
  const t = (v as string).trim().replace(/\s+/g, ' ');
  if (t.length > max) fail(`${label} is too long (max ${max}).`);
  return t;
};
const isoDate = (v: unknown, label: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(`${label} must be a date (YYYY-MM-DD).`);
  return v as string;
};

// ---------------------------------------------------------------- brands

export function listBrands(ctx: Ctx) {
  return camelAll(all(ctx.db, 'SELECT id, name FROM brand WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE'));
}

export function createBrand(ctx: Ctx, actor: Actor, requestId: string, input: { name: string }) {
  return runCommand(ctx, requestId, 'brand.create', actor, () => {
    assertPerm(actor, 'catalog.write');
    const name = text(input.name, 'Brand name', 60);
    if (get(ctx.db, 'SELECT 1 FROM brand WHERE lower(name) = lower(?) AND deleted_at IS NULL', name)) throw new AppError('DUPLICATE', `The brand "${name}" already exists.`, 409);
    const id = ctx.ids.next();
    run(ctx.db, 'INSERT INTO brand (id, name, created_at) VALUES (?,?,?)', id, name, ctx.clock.now());
    audit(ctx, actor.userId, 'brand.create', 'brand', id, { name });
    return { id, name };
  });
}

// ---------------------------------------------------------------- scan codes

export function listScanCodes(ctx: Ctx, itemId: string) {
  return camelAll(all(ctx.db, 'SELECT code, pack_qty_milli FROM item_scan_code WHERE item_id = ? ORDER BY created_at', itemId));
}

/** Another barcode for an item, e.g. the case barcode that adds 12 pieces (packQtyMilli 12000), or a second EAN. */
export function addScanCode(ctx: Ctx, actor: Actor, requestId: string, itemId: string, input: { code: string; packQtyMilli?: number }) {
  return runCommand(ctx, requestId, 'item.code.add', actor, () => {
    assertPerm(actor, 'catalog.write');
    if (!get(ctx.db, 'SELECT 1 FROM item WHERE id = ? AND deleted_at IS NULL', itemId)) throw new AppError('NOT_FOUND', 'Item not found.', 404);
    const code = text(input.code, 'Barcode', 40);
    const pack = input.packQtyMilli ?? 1000;
    if (!Number.isInteger(pack) || pack <= 0 || pack > 10_000_000) fail('Pack quantity must be more than zero.');
    if (classifyScan(code, scaleProfiles(ctx)).kind === 'scale') fail('This code looks like a weighing-scale label (its prefix is set up under Scale barcodes). Use another code.');
    const owner = get<{ item_id: string }>(ctx.db, 'SELECT item_id FROM item_scan_code WHERE code_key = ?', barcodeKey(code));
    if (owner) throw new AppError('DUPLICATE_BARCODE', owner.item_id === itemId ? 'This item already has this barcode.' : 'Another item already uses this barcode.', 409);
    run(ctx.db, 'INSERT INTO item_scan_code (code_key, code, item_id, pack_qty_milli, created_at) VALUES (?,?,?,?,?)', barcodeKey(code), code, itemId, pack, ctx.clock.now());
    audit(ctx, actor.userId, 'item.code.add', 'item', itemId, { code, packQtyMilli: pack });
    return { code, packQtyMilli: pack };
  });
}

export function removeScanCode(ctx: Ctx, actor: Actor, requestId: string, itemId: string, code: string) {
  return runCommand(ctx, requestId, 'item.code.remove', actor, () => {
    assertPerm(actor, 'catalog.write');
    const r = run(ctx.db, 'DELETE FROM item_scan_code WHERE code_key = ? AND item_id = ?', barcodeKey(code), itemId);
    if (Number(r.changes) === 0) throw new AppError('NOT_FOUND', 'This item has no such barcode.', 404);
    const main = get<{ barcode: string | null }>(ctx.db, 'SELECT barcode FROM item WHERE id = ?', itemId)?.barcode;
    if (main && barcodeKey(main) === barcodeKey(code)) run(ctx.db, 'UPDATE item SET barcode = NULL, version = version + 1, updated_at = ? WHERE id = ?', ctx.clock.now(), itemId);
    audit(ctx, actor.userId, 'item.code.remove', 'item', itemId, { code });
    return { removed: code };
  });
}

// ---------------------------------------------------------------- variants (size x colour)

export interface VariantsInput {
  /** "Polo T-shirt"; each variant is named "Polo T-shirt Blue M". */
  name: string;
  /** Attribute names in order, e.g. ["Colour", "Size"]; at most 3. */
  attributes: Array<{ name: string; values: string[] }>;
  /** Everything an item needs (tax group, price, MRP, HSN, ...) except the name and barcode. */
  base: Omit<ItemInput, 'name' | 'barcode'>;
  /** Extra price per value, e.g. { "Size": { "XL": 5000 } } adds Rs 50 to XL; MRP follows by the same amount. */
  priceExtra?: Record<string, Record<string, number>>;
  /** SKU prefix: variants get "<prefix>-<value initials>", e.g. POLO-BLU-M. */
  skuPrefix?: string | null;
}

function combos(attrs: Array<{ name: string; values: string[] }>): Array<Array<[string, string]>> {
  return attrs.reduce<Array<Array<[string, string]>>>((acc, a) => acc.flatMap((c) => a.values.map((v) => [...c, [a.name, v] as [string, string]])), [[]]);
}
const code3 = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'X';

/** A template and one stocked item per combination (4 colours x 5 sizes = 20 items), each with its own SKU, barcode and stock. */
export function createVariants(ctx: Ctx, actor: Actor, requestId: string, input: VariantsInput) {
  return runCommand(ctx, requestId, 'item.variants', actor, () => {
    assertPerm(actor, 'catalog.write');
    const name = text(input.name, 'Product name', 80);
    if (!Array.isArray(input.attributes) || input.attributes.length < 1 || input.attributes.length > 3) fail('Give 1 to 3 attributes, e.g. Colour and Size.');
    const attrs = input.attributes.map((a) => {
      const an = text(a.name, 'Attribute name', 20);
      const values = [...new Set((a.values ?? []).map((v) => text(v, `${an} value`, 20)))];
      if (values.length === 0) fail(`Give at least one ${an}.`);
      return { name: an, values };
    });
    if (new Set(attrs.map((a) => a.name.toLowerCase())).size !== attrs.length) fail('Each attribute can be used once.');
    const all = combos(attrs);
    if (all.length > 200) fail('At most 200 variants at a time.');
    const id = ctx.ids.next();
    const now = ctx.clock.now();
    run(ctx.db, 'INSERT INTO item_template (id, name, category_id, brand_id, attributes_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      id, name, input.base.categoryId ?? null, input.base.brandId ?? null, JSON.stringify(attrs), now, now);
    const prefix = input.skuPrefix ? text(input.skuPrefix, 'SKU prefix', 12).toUpperCase() : null;
    const items = all.map((combo, n) => {
      const extra = combo.reduce((s, [a, v]) => s + (input.priceExtra?.[a]?.[v] ?? 0), 0);
      const vname = `${name} ${combo.map(([, v]) => v).join(' ')}`;
      // each variant is an ordinary item: price, MRP and the above-MRP check all apply to it
      const made = createItem(ctx, actor, `${requestId}:v${n}`, {
        ...input.base, name: vname, barcode: null,
        price: input.base.price + extra, mrp: input.base.mrp === null || input.base.mrp === undefined ? input.base.mrp : input.base.mrp + extra,
        sku: prefix ? `${prefix}-${combo.map(([, v]) => code3(v)).join('-')}` : input.base.sku ?? null,
      });
      run(ctx.db, 'UPDATE item SET template_id = ?, variant_json = ? WHERE id = ?', id, JSON.stringify(Object.fromEntries(combo)), made.id);
      return { id: made.id, name: vname, variant: Object.fromEntries(combo) };
    });
    audit(ctx, actor.userId, 'item.variants', 'item_template', id, { name, count: items.length });
    emit(ctx, 'item', id, 'upsert', { templateId: id, count: items.length });
    return { templateId: id, items };
  });
}

// ---------------------------------------------------------------- batches

export interface BatchInput { batchNo: string; mfgDate?: string | null; expiryDate?: string | null; mrp?: number | null; salePrice?: number | null; cost?: number | null; supplierId?: string | null }

/** The batch for this number and MRP, made when stock of it first arrives (inside the GRN's transaction). */
export function findOrCreateBatch(ctx: Ctx, itemId: string, b: BatchInput): string {
  const batchNo = text(b.batchNo, 'Batch number', 30).toUpperCase();
  const mfg = isoDate(b.mfgDate, 'Manufacturing date'), exp = isoDate(b.expiryDate, 'Expiry date');
  if (mfg && exp && exp < mfg) fail(`Batch ${batchNo}: the expiry date is before the manufacturing date.`);
  for (const [v, l] of [[b.mrp, 'MRP'], [b.salePrice, 'Selling price'], [b.cost, 'Cost']] as const) {
    if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) fail(`Batch ${batchNo}: ${l} must be a whole number of paise.`);
  }
  if (b.mrp !== undefined && b.mrp !== null && b.salePrice !== undefined && b.salePrice !== null && b.salePrice > b.mrp) fail(`Batch ${batchNo}: the selling price is above the MRP.`);
  const found = get<{ id: string; expiry_date: string | null }>(ctx.db, 'SELECT id, expiry_date FROM batch WHERE item_id = ? AND batch_no = ? AND ifnull(mrp, -1) = ?', itemId, batchNo, b.mrp ?? -1);
  if (found) {
    if (exp && found.expiry_date && exp !== found.expiry_date) fail(`Batch ${batchNo} is already in stock with expiry ${found.expiry_date}. Check the batch number.`);
    if (b.salePrice !== undefined && b.salePrice !== null) run(ctx.db, 'UPDATE batch SET sale_price = ? WHERE id = ?', b.salePrice, found.id);
    return found.id;
  }
  const id = ctx.ids.next();
  run(ctx.db, 'INSERT INTO batch (id, item_id, batch_no, mfg_date, expiry_date, mrp, sale_price, cost, supplier_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, itemId, batchNo, mfg, exp, b.mrp ?? null, b.salePrice ?? null, b.cost ?? null, b.supplierId ?? null, ctx.clock.now());
  return id;
}

export interface BatchStock { id: string; batchNo: string; mfgDate: string | null; expiryDate: string | null; mrp: number | null; salePrice: number | null; qtyMilli: number; expired: boolean }

/** Batches with stock, earliest expiry first (FEFO); `expired` from today's date in IST. */
export function batchesWithStock(ctx: Ctx, itemId: string): BatchStock[] {
  const today = istDay(ctx.clock.now());
  return all<{ id: string; batch_no: string; mfg_date: string | null; expiry_date: string | null; mrp: number | null; sale_price: number | null; qty_milli: number }>(ctx.db,
    `SELECT b.id, b.batch_no, b.mfg_date, b.expiry_date, b.mrp, b.sale_price, s.qty_milli
       FROM batch b JOIN item_stock s ON s.item_id = b.item_id AND s.batch_key = b.id
      WHERE b.item_id = ? AND s.qty_milli > 0
      ORDER BY b.expiry_date IS NULL, b.expiry_date, b.created_at`, itemId)
    .map((r) => ({ id: r.id, batchNo: r.batch_no, mfgDate: r.mfg_date, expiryDate: r.expiry_date, mrp: r.mrp, salePrice: r.sale_price, qtyMilli: r.qty_milli, expired: r.expiry_date !== null && r.expiry_date < today }));
}

/**
 * Which batch a sale takes (research: Logic ERP's rule, plus FEFO): expired batches never; when every batch in stock
 * has the same MRP, the one expiring first; when MRPs differ the cashier picks (the customer pays the MRP on the pack
 * in hand). Null batch = not batch tracked.
 */
export function pickBatch(ctx: Ctx, itemId: string, qtyMilli: number): { batchId: string } | { choose: BatchStock[] } | { none: true; expired: BatchStock[] } {
  const all = batchesWithStock(ctx, itemId);
  const ok = all.filter((b) => !b.expired);
  if (ok.length === 0) return { none: true, expired: all.filter((b) => b.expired) };
  const mrps = new Set(ok.map((b) => b.mrp ?? -1));
  if (mrps.size > 1) return { choose: ok };
  const enough = ok.find((b) => b.qtyMilli >= qtyMilli);
  return { batchId: (enough ?? ok[0]!).id };
}

// ---------------------------------------------------------------- weighing-scale barcode layouts

export function scaleProfiles(ctx: Ctx): ScaleProfile[] {
  const rows = all<{ profile_json: string }>(ctx.db, 'SELECT profile_json FROM scale_profile WHERE active = 1 ORDER BY sort_order, id');
  return rows.length ? rows.map((r) => JSON.parse(r.profile_json) as ScaleProfile) : DEFAULT_SCALE_PROFILES;
}

/** Replaces the shop's layouts (Settings > Scale barcodes). An empty list goes back to the two defaults. */
export function saveScaleProfiles(ctx: Ctx, actor: Actor, requestId: string, profiles: ScaleProfile[]) {
  return runCommand(ctx, requestId, 'scale.profiles', actor, () => {
    assertPerm(actor, 'settings.write');
    if (!Array.isArray(profiles) || profiles.length > 10) fail('At most 10 scale barcode layouts.');
    const seen = new Set<string>();
    profiles.forEach((p, i) => {
      const errs = validateScaleProfile(p);
      if (errs.length) fail(`Layout ${i + 1} (${p.name || 'no name'}): ${errs.join(' ')}`);
      for (const x of p.prefixes) { if (seen.has(`${x}:${p.length}`)) fail(`Two layouts use the prefix ${x} for ${p.length}-character codes.`); seen.add(`${x}:${p.length}`); }
    });
    run(ctx.db, 'DELETE FROM scale_profile');
    profiles.forEach((p, i) => run(ctx.db, 'INSERT INTO scale_profile (id, profile_json, sort_order, active, updated_at) VALUES (?,?,?,1,?)',
      p.id || ctx.ids.next(), JSON.stringify({ ...p, id: p.id || undefined }), i, ctx.clock.now()));
    audit(ctx, actor.userId, 'scale.profiles', 'settings', 'scale_profile', { count: profiles.length });
    return { profiles: scaleProfiles(ctx) };
  });
}

// ---------------------------------------------------------------- a scan at the counter

export type ScanResult =
  | { found: true; itemId: string; name: string; qtyMilli: number; unitPrice: number; mrp: number | null; batchTracked: boolean; source: 'barcode' | 'scale' | 'sku' | 'plu'; scale?: { valueKind: string; value: number; amount: number | null } }
  | { found: false; code: string; reason: string };

/**
 * What the counter should add for a scanned or typed code: a barcode (with its pack size), a weighing-scale label
 * (weight label: qty = weight; price label: qty = price / rate, amount kept), an SKU or a PLU.
 */
export function lookupScan(ctx: Ctx, raw: string): ScanResult {
  const code = String(raw ?? '').trim();
  if (!code) return { found: false, code, reason: 'Nothing was scanned.' };
  const item = (where: string, p: string) => get<{ id: string; name: string; price: number; mrp: number | null; batch_tracked: number; is_weighed: number }>(ctx.db,
    `SELECT id, name, price, mrp, batch_tracked, is_weighed FROM item WHERE ${where} AND deleted_at IS NULL AND active = 1`, p);
  const s = classifyScan(code, scaleProfiles(ctx));
  if (s.kind === 'scale') {
    const it = item('ltrim(plu, \'0\') = ltrim(?, \'0\')', s.read.itemCode);
    if (!it) return { found: false, code, reason: `No item has the scale code (PLU) ${s.read.itemCode}.` };
    const base = { found: true as const, itemId: it.id, name: it.name, mrp: it.mrp, batchTracked: it.batch_tracked === 1, unitPrice: it.price, source: 'scale' as const };
    if (s.read.valueKind === 'price') {
      if (it.price <= 0) return { found: false, code, reason: `${it.name} has no price per unit, so the weight cannot be worked out from the label's price.` };
      return { ...base, qtyMilli: Math.max(1, mulDivRound(s.read.value, 1000, it.price)), scale: { valueKind: 'price', value: s.read.value, amount: s.read.value } };
    }
    if (s.read.value <= 0) return { found: false, code, reason: 'The label shows a weight of zero.' };
    if (s.read.valueKind === 'weight' && it.is_weighed !== 1) return { found: false, code, reason: `${it.name} is not set up as a weighed item, so a weight label cannot be billed for it.` };
    return { ...base, qtyMilli: s.read.value, scale: { valueKind: s.read.valueKind, value: s.read.value, amount: null } };
  }
  const hit = get<{ item_id: string; pack_qty_milli: number }>(ctx.db, 'SELECT item_id, pack_qty_milli FROM item_scan_code WHERE code_key = ?', s.key);
  if (hit) {
    const it = item('id = ?', hit.item_id);
    if (it) return { found: true, itemId: it.id, name: it.name, qtyMilli: hit.pack_qty_milli, unitPrice: it.price, mrp: it.mrp, batchTracked: it.batch_tracked === 1, source: 'barcode' };
  }
  const bySku = item('upper(sku) = ?', code.toUpperCase());
  if (bySku) return { found: true, itemId: bySku.id, name: bySku.name, qtyMilli: 1000, unitPrice: bySku.price, mrp: bySku.mrp, batchTracked: bySku.batch_tracked === 1, source: 'sku' };
  if (/^\d{1,8}$/.test(code)) {
    const byPlu = item('ltrim(plu, \'0\') = ltrim(?, \'0\')', code);
    if (byPlu) return { found: true, itemId: byPlu.id, name: byPlu.name, qtyMilli: 1000, unitPrice: byPlu.price, mrp: byPlu.mrp, batchTracked: byPlu.batch_tracked === 1, source: 'plu' };
  }
  return { found: false, code, reason: 'No item has this barcode.' };
}
