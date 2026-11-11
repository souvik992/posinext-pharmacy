// Buying stock (V17): suppliers and what the shop owes them, goods receipts (GRN) against the supplier's bill, purchase
// returns (debit notes) and supplier payments. A GRN creates batches (with expiry and MRP), adds stock at its landed
// cost (free quantity lowers the cost per unit), and can update the item's selling price and MRP.
import { all, get, run, AppError } from '../store/db.ts';
import type { Actor, Ctx } from './ctx.ts';
import { getDevice } from './ctx.ts';
import { runCommand } from './commands.ts';
import { audit } from './audit.ts';
import { assertPerm } from './permissions.ts';
import { gstinProblem } from '../core/gstin.ts';
import { mulDivRound, sum } from '../core/money.ts';
import { financialYear } from '../core/numbering.ts';
import { findOrCreateBatch } from './products.ts';
import { postMove } from './inventory.ts';
import { inclusiveUnitPrice } from './catalog.ts';

function fail(msg: string): never { throw new AppError('VALIDATION', msg); }
const opt = (v: unknown, label: string, max: number): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') fail(`${label} must be text.`);
  const t = (v as string).trim();
  if (t.length > max) fail(`${label} is too long (max ${max}).`);
  return t || null;
};
const paise = (v: unknown, label: string) => { if (!Number.isInteger(v) || (v as number) < 0) fail(`${label} must be a whole number of paise, zero or more.`); return v as number; };

/** Next number for a document kind in this financial year: GRN/26-27/000001, DN/26-27/000001. */
function nextDocNo(ctx: Ctx, kind: 'GRN' | 'DN'): string {
  const fy = financialYear(ctx.clock.now());
  run(ctx.db, 'INSERT INTO doc_counter (kind, fy, last) VALUES (?,?,1) ON CONFLICT(kind, fy) DO UPDATE SET last = last + 1', kind, fy);
  const n = get<{ last: number }>(ctx.db, 'SELECT last FROM doc_counter WHERE kind = ? AND fy = ?', kind, fy)!.last;
  return `${kind}/${fy}/${String(n).padStart(6, '0')}`;
}

const outletState = (ctx: Ctx) => get<{ state_code: string }>(ctx.db, 'SELECT state_code FROM outlet WHERE id = ?', getDevice(ctx).outletId)!.state_code;

// ---------------------------------------------------------------- suppliers

export interface SupplierInput { name: string; gstin?: string | null; mobile?: string | null; stateCode?: string | null; address?: string | null }

function checkSupplier(ctx: Ctx, s: SupplierInput, selfId: string | null) {
  const name = opt(s.name, 'Supplier name', 80) ?? fail('Supplier name is required.');
  const dup = get<{ id: string }>(ctx.db, 'SELECT id FROM supplier WHERE lower(name) = lower(?) AND deleted_at IS NULL', name);
  if (dup && dup.id !== selfId) throw new AppError('DUPLICATE', `The supplier "${name}" already exists.`, 409);
  const gstin = opt(s.gstin, 'GSTIN', 15)?.toUpperCase() ?? null;
  if (gstin) { const p = gstinProblem(gstin); if (p) fail(p); }
  const mobile = opt(s.mobile, 'Mobile', 15);
  if (mobile && !/^\+?\d{10,13}$/.test(mobile)) fail('Mobile must be 10 to 13 digits.');
  const stateCode = gstin ? gstin.slice(0, 2) : opt(s.stateCode, 'State code', 2);
  if (stateCode && !/^\d{2}$/.test(stateCode)) fail('State code is 2 digits (e.g. 29 for Karnataka).');
  return { name, gstin, mobile, stateCode, address: opt(s.address, 'Address', 300) };
}

export function createSupplier(ctx: Ctx, actor: Actor, requestId: string, input: SupplierInput & { openingBalance?: number }) {
  return runCommand(ctx, requestId, 'supplier.create', actor, () => {
    assertPerm(actor, 'stock.write');
    const s = checkSupplier(ctx, input, null);
    const id = ctx.ids.next(), now = ctx.clock.now();
    run(ctx.db, 'INSERT INTO supplier (id, name, gstin, mobile, state_code, address, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', id, s.name, s.gstin, s.mobile, s.stateCode, s.address, now, now);
    if (input.openingBalance) {
      if (!Number.isInteger(input.openingBalance)) fail('Opening balance must be a whole number of paise.');
      ledger(ctx, actor, id, 'OPENING', input.openingBalance, null, 'Opening balance');
    }
    audit(ctx, actor.userId, 'supplier.create', 'supplier', id, { name: s.name });
    return { id };
  });
}

export function updateSupplier(ctx: Ctx, actor: Actor, requestId: string, id: string, input: SupplierInput) {
  return runCommand(ctx, requestId, 'supplier.update', actor, () => {
    assertPerm(actor, 'stock.write');
    if (!get(ctx.db, 'SELECT 1 FROM supplier WHERE id = ? AND deleted_at IS NULL', id)) throw new AppError('NOT_FOUND', 'Supplier not found.', 404);
    const s = checkSupplier(ctx, input, id);
    run(ctx.db, 'UPDATE supplier SET name=?, gstin=?, mobile=?, state_code=?, address=?, updated_at=? WHERE id=?', s.name, s.gstin, s.mobile, s.stateCode, s.address, ctx.clock.now(), id);
    audit(ctx, actor.userId, 'supplier.update', 'supplier', id, { name: s.name });
    return { id };
  });
}

function ledger(ctx: Ctx, actor: Actor, supplierId: string, kind: 'OPENING' | 'BILL' | 'BILL_VOID' | 'PAYMENT' | 'RETURN' | 'ADJUST', amount: number, refId: string | null, note: string | null) {
  if (amount === 0) return;
  run(ctx.db, 'INSERT INTO supplier_ledger (id, supplier_id, kind, amount, ref_id, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ctx.ids.next(), supplierId, kind, amount, refId, note, actor.userId, ctx.clock.now());
}

/** Suppliers with what the shop owes each (positive = payable). */
export function listSuppliers(ctx: Ctx) {
  return all<{ id: string; name: string; gstin: string | null; mobile: string | null; state_code: string | null; address: string | null; balance: number }>(ctx.db,
    `SELECT s.id, s.name, s.gstin, s.mobile, s.state_code, s.address, ifnull((SELECT sum(amount) FROM supplier_ledger l WHERE l.supplier_id = s.id), 0) AS balance
       FROM supplier s WHERE s.deleted_at IS NULL ORDER BY s.name COLLATE NOCASE`)
    .map((r) => ({ id: r.id, name: r.name, gstin: r.gstin, mobile: r.mobile, stateCode: r.state_code, address: r.address, balance: r.balance }));
}

export function supplierStatement(ctx: Ctx, supplierId: string) {
  let bal = 0;
  return all<{ kind: string; amount: number; ref_id: string | null; note: string | null; created_at: number }>(ctx.db,
    'SELECT kind, amount, ref_id, note, created_at FROM supplier_ledger WHERE supplier_id = ? ORDER BY seq', supplierId)
    .map((r) => ({ kind: r.kind, amount: r.amount, refId: r.ref_id, note: r.note, at: r.created_at, balance: (bal += r.amount) }));
}

/** Money paid to a supplier (cash, UPI, bank, cheque): lowers what the shop owes. */
export function paySupplier(ctx: Ctx, actor: Actor, requestId: string, input: { supplierId: string; amount: number; mode: string; reference?: string | null }) {
  return runCommand(ctx, requestId, 'supplier.pay', actor, () => {
    assertPerm(actor, 'stock.write');
    if (!get(ctx.db, 'SELECT 1 FROM supplier WHERE id = ?', input.supplierId)) throw new AppError('NOT_FOUND', 'Supplier not found.', 404);
    if (!Number.isInteger(input.amount) || input.amount <= 0) fail('Amount must be more than zero.');
    if (!['CASH', 'UPI', 'BANK', 'CHEQUE', 'CARD'].includes(input.mode)) fail('Mode must be CASH, UPI, BANK, CHEQUE or CARD.');
    const ref = opt(input.reference, 'Reference', 60);
    ledger(ctx, actor, input.supplierId, 'PAYMENT', -input.amount, null, `${input.mode}${ref ? ` ${ref}` : ''}`);
    audit(ctx, actor.userId, 'supplier.pay', 'supplier', input.supplierId, { amount: input.amount, mode: input.mode });
    return { paid: input.amount };
  });
}

// ---------------------------------------------------------------- goods receipt (GRN)

export interface GrnLineInput {
  itemId: string;
  qtyMilli: number;
  /** Free quantity from the supplier (scheme): stock goes up, cost per unit goes down. */
  freeQtyMilli?: number;
  /** Cost per unit before GST (as on the supplier's bill). */
  unitCost: number;
  /** Discount on the line, paise (trade discount on the bill). */
  discount?: number;
  /** GST rate on the supplier's bill; defaults to the item's rate. */
  rateBp?: number;
  batch?: { batchNo: string; mfgDate?: string | null; expiryDate?: string | null } | null;
  mrp?: number | null;
  /** New selling price (tax included as the item is set up); updates the batch, or the item when not batch tracked. */
  salePrice?: number | null;
}

export interface GrnInput { supplierId: string; billNo?: string | null; billDate?: string | null; lines: GrnLineInput[]; otherCharges?: number; note?: string | null; roundToRupee?: boolean }

export function postGrn(ctx: Ctx, actor: Actor, requestId: string, input: GrnInput) {
  return runCommand(ctx, requestId, 'grn.post', actor, () => {
    assertPerm(actor, 'stock.write');
    const sup = get<{ id: string; state_code: string | null }>(ctx.db, 'SELECT id, state_code FROM supplier WHERE id = ? AND deleted_at IS NULL', input.supplierId);
    if (!sup) throw new AppError('NOT_FOUND', 'Supplier not found.', 404);
    if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 500) fail('A goods receipt has 1 to 500 lines.');
    const billNo = opt(input.billNo, 'Supplier bill number', 30);
    const billDate = opt(input.billDate, 'Bill date', 10);
    if (billDate && !/^\d{4}-\d{2}-\d{2}$/.test(billDate)) fail('Bill date must be YYYY-MM-DD.');
    if (billNo && get(ctx.db, "SELECT 1 FROM grn WHERE supplier_id = ? AND lower(bill_no) = lower(?) AND status = 'POSTED'", sup.id, billNo)) {
      throw new AppError('DUPLICATE', `Bill ${billNo} from this supplier is already entered.`, 409);
    }
    const interState = sup.state_code !== null && sup.state_code !== outletState(ctx);
    const other = input.otherCharges === undefined ? 0 : paise(input.otherCharges, 'Other charges');
    const id = ctx.ids.next(), grnNo = nextDocNo(ctx, 'GRN');

    const lines = input.lines.map((l, i) => {
      const it = get<{ id: string; name: string; batch_tracked: number; rate_bp: number; cess_bp: number; price_includes_tax: number; mrp: number | null; price: number }>(ctx.db,
        `SELECT i.id, i.name, i.batch_tracked, t.rate_bp, t.cess_bp, t.price_includes_tax, i.mrp, i.price FROM item i JOIN tax_group t ON t.id = i.tax_group_id WHERE i.id = ? AND i.deleted_at IS NULL`, l.itemId);
      if (!it) throw new AppError('NOT_FOUND', `Line ${i + 1}: item not found.`, 404);
      if (!Number.isInteger(l.qtyMilli) || l.qtyMilli <= 0) fail(`Line ${i + 1} (${it.name}): quantity must be more than zero.`);
      const free = l.freeQtyMilli ?? 0;
      if (!Number.isInteger(free) || free < 0) fail(`Line ${i + 1} (${it.name}): free quantity must be zero or more.`);
      const unitCost = paise(l.unitCost, `Line ${i + 1}: cost`);
      const gross = mulDivRound(l.qtyMilli, unitCost, 1000);
      const discount = l.discount === undefined ? 0 : paise(l.discount, `Line ${i + 1}: discount`);
      if (discount > gross) fail(`Line ${i + 1} (${it.name}): the discount is more than the line.`);
      const rateBp = l.rateBp ?? it.rate_bp;
      if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) fail(`Line ${i + 1}: GST rate is not valid.`);
      const taxable = gross - discount, tax = mulDivRound(taxable, rateBp, 10000);
      const mrp = l.mrp === undefined || l.mrp === null ? it.mrp : paise(l.mrp, `Line ${i + 1}: MRP`);
      const sale = l.salePrice === undefined || l.salePrice === null ? null : paise(l.salePrice, `Line ${i + 1}: selling price`);
      if (sale !== null && mrp !== null && inclusiveUnitPrice(sale, it.rate_bp, it.cess_bp, it.price_includes_tax === 1) > mrp) fail(`Line ${i + 1} (${it.name}): the new selling price is above the MRP.`);
      if (it.batch_tracked === 1 && !l.batch?.batchNo) fail(`Line ${i + 1} (${it.name}): give the batch number (and expiry).`);
      // landed cost per unit for margins and stock value: taxable / (paid + free) qty
      const landed = mulDivRound(taxable, 1000, l.qtyMilli + free);
      const batchId = it.batch_tracked === 1 ? findOrCreateBatch(ctx, it.id, { ...l.batch!, mrp, salePrice: sale, cost: landed, supplierId: sup.id }) : null;
      return { l, it, free, unitCost, discount, rateBp, taxable, tax, mrp, sale, landed, batchId, lineNo: i + 1 };
    });
    const taxableTotal = sum(lines.map((x) => x.taxable)), taxTotal = sum(lines.map((x) => x.tax));
    const pre = taxableTotal + taxTotal + other;
    const total = input.roundToRupee === false ? pre : Math.floor((pre + 50) / 100) * 100;
    run(ctx.db, `INSERT INTO grn (id, grn_no, supplier_id, bill_no, bill_date, inter_state, taxable_total, tax_total, other_charges, round_off, total, note, status, created_by, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'POSTED', ?, ?)`, id, grnNo, sup.id, billNo, billDate, interState ? 1 : 0, taxableTotal, taxTotal, other, total - pre, total, opt(input.note, 'Note', 200), actor.userId, ctx.clock.now());
    for (const x of lines) {
      run(ctx.db, `INSERT INTO grn_line (id, grn_id, line_no, item_id, batch_id, qty_milli, free_qty_milli, unit_cost, discount, taxable, rate_bp, tax, line_total, mrp, sale_price)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ctx.ids.next(), id, x.lineNo, x.it.id, x.batchId, x.l.qtyMilli, x.free, x.unitCost, x.discount, x.taxable, x.rateBp, x.tax, x.taxable + x.tax, x.mrp, x.sale);
      postMove(ctx, actor, { itemId: x.it.id, batchId: x.batchId, deltaMilli: x.l.qtyMilli + x.free, kind: 'PURCHASE', refType: 'grn', refId: id, unitCost: x.landed });
      // the item remembers its last cost; without batches, the new MRP and selling price apply to the item itself
      run(ctx.db, 'UPDATE item SET purchase_price = ?, updated_at = ? WHERE id = ?', x.landed, ctx.clock.now(), x.it.id);
      if (x.it.batch_tracked !== 1 && (x.sale !== null || (x.mrp !== null && x.mrp !== x.it.mrp))) {
        const price = x.sale ?? x.it.price;
        if (x.mrp !== null && inclusiveUnitPrice(price, x.it.rate_bp, x.it.cess_bp, x.it.price_includes_tax === 1) > x.mrp) fail(`Line ${x.lineNo} (${x.it.name}): the selling price would be above the new MRP; give a new selling price too.`);
        run(ctx.db, 'UPDATE item SET price = ?, mrp = ?, version = version + 1 WHERE id = ?', price, x.mrp, x.it.id);
      }
    }
    ledger(ctx, actor, sup.id, 'BILL', total, id, `${grnNo}${billNo ? ` (bill ${billNo})` : ''}`);
    audit(ctx, actor.userId, 'grn.post', 'grn', id, { grnNo, supplierId: sup.id, total, lines: lines.length });
    return { id, grnNo, taxableTotal, taxTotal, total, interState };
  });
}

/** Undoes a receipt entered wrongly: its stock comes out again (it must still be there) and the supplier is owed less. */
export function voidGrn(ctx: Ctx, actor: Actor, requestId: string, id: string, reason: string) {
  return runCommand(ctx, requestId, 'grn.void', actor, () => {
    assertPerm(actor, 'stock.write');
    const g = get<{ id: string; grn_no: string; supplier_id: string; total: number; status: string }>(ctx.db, 'SELECT id, grn_no, supplier_id, total, status FROM grn WHERE id = ?', id);
    if (!g) throw new AppError('NOT_FOUND', 'Goods receipt not found.', 404);
    if (g.status !== 'POSTED') throw new AppError('ALREADY_VOIDED', 'This goods receipt is already voided.', 409);
    const why = opt(reason, 'Reason', 200) ?? fail('Give a reason.');
    for (const l of all<{ item_id: string; batch_id: string | null; qty_milli: number; free_qty_milli: number }>(ctx.db, 'SELECT item_id, batch_id, qty_milli, free_qty_milli FROM grn_line WHERE grn_id = ?', id)) {
      postMove(ctx, actor, { itemId: l.item_id, batchId: l.batch_id, deltaMilli: -(l.qty_milli + l.free_qty_milli), kind: 'PURCHASE_VOID', refType: 'grn', refId: id, reason: why });
    }
    run(ctx.db, "UPDATE grn SET status = 'VOIDED', voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?", ctx.clock.now(), actor.userId, why, id);
    ledger(ctx, actor, g.supplier_id, 'BILL_VOID', -g.total, id, `${g.grn_no} voided: ${why}`);
    audit(ctx, actor.userId, 'grn.void', 'grn', id, { reason: why });
    return { id, voided: true };
  });
}

export function getGrn(ctx: Ctx, id: string) {
  const g = get<Record<string, unknown>>(ctx.db, 'SELECT g.*, s.name AS supplier_name FROM grn g JOIN supplier s ON s.id = g.supplier_id WHERE g.id = ?', id);
  if (!g) throw new AppError('NOT_FOUND', 'Goods receipt not found.', 404);
  const lines = all(ctx.db, `SELECT l.*, i.name AS item_name, b.batch_no, b.expiry_date FROM grn_line l JOIN item i ON i.id = l.item_id LEFT JOIN batch b ON b.id = l.batch_id WHERE l.grn_id = ? ORDER BY l.line_no`, id);
  return { ...g, lines };
}

export function listGrns(ctx: Ctx, o: { supplierId?: string; limit?: number } = {}) {
  return all(ctx.db, `SELECT g.id, g.grn_no, g.bill_no, g.bill_date, g.total, g.status, g.created_at, s.name AS supplier_name
      FROM grn g JOIN supplier s ON s.id = g.supplier_id ${o.supplierId ? 'WHERE g.supplier_id = ?' : ''} ORDER BY g.created_at DESC LIMIT ?`,
  ...(o.supplierId ? [o.supplierId] : []), Math.min(Math.max(o.limit ?? 100, 1), 500));
}

// ---------------------------------------------------------------- purchase return (debit note)

export interface PurchaseReturnInput { supplierId: string; grnId?: string | null; reason: string; lines: Array<{ itemId: string; batchId?: string | null; qtyMilli: number; unitCost?: number; rateBp?: number }> }

/** Goods sent back to the supplier (expired, damaged, wrong): a debit note; stock goes out, the shop owes less. */
export function postPurchaseReturn(ctx: Ctx, actor: Actor, requestId: string, input: PurchaseReturnInput) {
  return runCommand(ctx, requestId, 'purchase.return', actor, () => {
    assertPerm(actor, 'stock.write');
    const sup = get<{ id: string; state_code: string | null }>(ctx.db, 'SELECT id, state_code FROM supplier WHERE id = ?', input.supplierId);
    if (!sup) throw new AppError('NOT_FOUND', 'Supplier not found.', 404);
    const reason = opt(input.reason, 'Reason', 200) ?? fail('Give a reason (expired, damaged, wrong item, ...).');
    if (input.grnId && !get(ctx.db, "SELECT 1 FROM grn WHERE id = ? AND supplier_id = ? AND status = 'POSTED'", input.grnId, sup.id)) fail('That goods receipt is not from this supplier.');
    if (!Array.isArray(input.lines) || input.lines.length === 0) fail('Give at least one line.');
    const id = ctx.ids.next(), docNo = nextDocNo(ctx, 'DN');
    const lines = input.lines.map((l, i) => {
      if (!Number.isInteger(l.qtyMilli) || l.qtyMilli <= 0) fail(`Line ${i + 1}: quantity must be more than zero.`);
      // default cost and rate: what this batch (or item) last came in at
      const last = get<{ unit_cost: number; rate_bp: number; discount: number; qty_milli: number }>(ctx.db,
        `SELECT l.unit_cost, l.rate_bp, l.discount, l.qty_milli FROM grn_line l JOIN grn g ON g.id = l.grn_id
          WHERE l.item_id = ? AND ifnull(l.batch_id, '') = ? AND g.status = 'POSTED' ${input.grnId ? 'AND g.id = ?' : ''} ORDER BY g.created_at DESC LIMIT 1`,
        l.itemId, l.batchId ?? '', ...(input.grnId ? [input.grnId] : []));
      const unitCost = l.unitCost ?? (last ? last.unit_cost - mulDivRound(last.discount, 1000, last.qty_milli) : fail(`Line ${i + 1}: give the cost (no earlier purchase of it was found).`));
      const rateBp = l.rateBp ?? last?.rate_bp ?? get<{ rate_bp: number }>(ctx.db, 'SELECT t.rate_bp FROM item i JOIN tax_group t ON t.id = i.tax_group_id WHERE i.id = ?', l.itemId)!.rate_bp;
      const taxable = mulDivRound(l.qtyMilli, unitCost, 1000), tax = mulDivRound(taxable, rateBp, 10000);
      postMove(ctx, actor, { itemId: l.itemId, batchId: l.batchId ?? null, deltaMilli: -l.qtyMilli, kind: 'PURCHASE_RETURN', refType: 'purchase_return', refId: id, reason, unitCost });
      return { l, unitCost, rateBp, taxable, tax, lineNo: i + 1 };
    });
    const taxableTotal = sum(lines.map((x) => x.taxable)), taxTotal = sum(lines.map((x) => x.tax)), total = taxableTotal + taxTotal;
    run(ctx.db, 'INSERT INTO purchase_return (id, doc_no, supplier_id, grn_id, inter_state, taxable_total, tax_total, total, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, docNo, sup.id, input.grnId ?? null, sup.state_code !== null && sup.state_code !== outletState(ctx) ? 1 : 0, taxableTotal, taxTotal, total, reason, actor.userId, ctx.clock.now());
    for (const x of lines) {
      run(ctx.db, 'INSERT INTO purchase_return_line (id, return_id, line_no, item_id, batch_id, qty_milli, unit_cost, taxable, rate_bp, tax, line_total) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ctx.ids.next(), id, x.lineNo, x.l.itemId, x.l.batchId ?? null, x.l.qtyMilli, x.unitCost, x.taxable, x.rateBp, x.tax, x.taxable + x.tax);
    }
    ledger(ctx, actor, sup.id, 'RETURN', -total, id, `${docNo}: ${reason}`);
    audit(ctx, actor.userId, 'purchase.return', 'purchase_return', id, { docNo, total });
    return { id, docNo, total };
  });
}
