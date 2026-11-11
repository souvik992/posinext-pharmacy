// Customers (V18), keyed by mobile number, and khata: what a customer owes (an append-only ledger: credit sales add,
// receipts and returns take away). A GSTIN on the customer makes the bill a B2B tax invoice with their state as the
// place of supply.
import { all, get, run, AppError } from '../store/db.ts';
import type { Actor, Ctx } from './ctx.ts';
import { runCommand } from './commands.ts';
import { retailCommand } from './retailJournal.ts';
import { audit } from './audit.ts';
import { assertPerm } from './permissions.ts';
import { requireApproval, type Override } from './auth.ts';
import { gstinProblem } from '../core/gstin.ts';
import { openShiftRow } from './orders.ts';

function fail(msg: string): never { throw new AppError('VALIDATION', msg); }
const opt = (v: unknown, label: string, max: number): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') fail(`${label} must be text.`);
  const t = (v as string).trim().replace(/\s+/g, ' ');
  if (t.length > max) fail(`${label} is too long (max ${max}).`);
  return t || null;
};

/** 10-digit Indian mobile (a leading +91 or 0 is dropped). */
export function normaliseMobile(raw: unknown): string {
  const d = String(raw ?? '').replace(/[\s-]/g, '').replace(/^(\+91|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  if (!/^[6-9]\d{9}$/.test(d)) fail('Enter a 10-digit mobile number.');
  return d;
}

export interface CustomerInput { mobile: string; name?: string | null; gstin?: string | null; address?: string | null; creditLimit?: number; creditDays?: number }

function check(c: Omit<CustomerInput, 'mobile'>) {
  const gstin = opt(c.gstin, 'GSTIN', 15)?.toUpperCase() ?? null;
  if (gstin) { const p = gstinProblem(gstin); if (p) fail(p); }
  const limit = c.creditLimit ?? 0, days = c.creditDays ?? 0;
  if (!Number.isInteger(limit) || limit < 0) fail('Credit limit must be zero (no limit) or more.');
  if (!Number.isInteger(days) || days < 0 || days > 365) fail('Credit days must be 0 to 365.');
  return { name: opt(c.name, 'Name', 60), gstin, stateCode: gstin ? gstin.slice(0, 2) : null, address: opt(c.address, 'Address', 300), limit, days };
}

/** Adds a customer, or updates the one with this mobile number (the counter types the number; that is the key). */
export function saveCustomer(ctx: Ctx, actor: Actor, requestId: string, input: CustomerInput & { openingDue?: number }) {
  return retailCommand(ctx, requestId, 'customer.save', actor, () => {
    assertPerm(actor, 'order.write');
    const mobile = normaliseMobile(input.mobile);
    const c = check(input);
    const cur = get<{ id: string; credit_limit: number }>(ctx.db, 'SELECT id, credit_limit FROM customer WHERE mobile = ? AND deleted_at IS NULL', mobile);
    const now = ctx.clock.now();
    // cashiers add customers; credit terms are set by a manager
    if ((c.limit !== (cur?.credit_limit ?? 0) || c.days > 0 || input.openingDue) && actor.role === 'cashier') fail('Ask a manager to set credit limits or an opening due.');
    let id: string;
    if (cur) {
      id = cur.id;
      run(ctx.db, `UPDATE customer SET name = coalesce(?, name), gstin = coalesce(?, gstin), state_code = coalesce(?, state_code), address = coalesce(?, address),
                   credit_limit = ?, credit_days = ?, updated_at = ? WHERE id = ?`, c.name, c.gstin, c.stateCode, c.address, c.limit, c.days, now, id);
    } else {
      id = ctx.ids.next();
      run(ctx.db, 'INSERT INTO customer (id, mobile, name, gstin, state_code, address, credit_limit, credit_days, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        id, mobile, c.name, c.gstin, c.stateCode, c.address, c.limit, c.days, now, now);
    }
    if (input.openingDue) {
      if (!Number.isInteger(input.openingDue)) fail('Opening due must be a whole number of paise.');
      postCustomerLedger(ctx, actor, id, 'OPENING', input.openingDue, null, null, 'Opening due');
    }
    audit(ctx, actor.userId, cur ? 'customer.update' : 'customer.create', 'customer', id, { mobile });
    return customerView(ctx, id);
  });
}

export function postCustomerLedger(ctx: Ctx, actor: Actor | null, customerId: string, kind: 'OPENING' | 'SALE' | 'SALE_CANCEL' | 'RETURN' | 'RECEIPT' | 'ADJUST', amount: number, refId: string | null, mode: string | null, note: string | null) {
  if (amount === 0) return;
  run(ctx.db, 'INSERT INTO customer_ledger (id, customer_id, kind, amount, ref_id, mode, note, shift_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ctx.ids.next(), customerId, kind, amount, refId, mode, note, openShiftRow(ctx)?.id ?? null, actor?.userId ?? null, ctx.clock.now());
}

export const customerDue = (ctx: Ctx, customerId: string) => get<{ d: number | null }>(ctx.db, 'SELECT sum(amount) d FROM customer_ledger WHERE customer_id = ?', customerId)?.d ?? 0;

export function customerView(ctx: Ctx, id: string) {
  const c = get<{ id: string; mobile: string; name: string | null; gstin: string | null; state_code: string | null; address: string | null; credit_limit: number; credit_days: number }>(ctx.db,
    'SELECT id, mobile, name, gstin, state_code, address, credit_limit, credit_days FROM customer WHERE id = ?', id);
  if (!c) throw new AppError('NOT_FOUND', 'Customer not found.', 404);
  const oldest = get<{ at: number | null }>(ctx.db, "SELECT min(created_at) at FROM customer_ledger WHERE customer_id = ? AND kind IN ('SALE','OPENING')", id)?.at ?? null;
  return { id: c.id, mobile: c.mobile, name: c.name, gstin: c.gstin, stateCode: c.state_code, address: c.address, creditLimit: c.credit_limit, creditDays: c.credit_days, due: customerDue(ctx, id), oldestDueAt: oldest };
}

export function findCustomer(ctx: Ctx, mobile: string) {
  let m: string;
  try { m = normaliseMobile(mobile); } catch { return null; }
  const c = get<{ id: string }>(ctx.db, 'SELECT id FROM customer WHERE mobile = ? AND deleted_at IS NULL', m);
  return c ? customerView(ctx, c.id) : null;
}

/** Customers by name or number; dueOnly: those who owe something, biggest first (the collection list). */
export function listCustomers(ctx: Ctx, o: { q?: string; dueOnly?: boolean; limit?: number } = {}) {
  const q = o.q?.trim();
  return all<{ id: string; mobile: string; name: string | null; gstin: string | null; credit_limit: number; due: number }>(ctx.db,
    `SELECT c.id, c.mobile, c.name, c.gstin, c.credit_limit, ifnull((SELECT sum(amount) FROM customer_ledger l WHERE l.customer_id = c.id), 0) AS due
       FROM customer c WHERE c.deleted_at IS NULL ${q ? 'AND (c.mobile LIKE ? OR c.name LIKE ?)' : ''}
       ${o.dueOnly ? 'AND due > 0 ORDER BY due DESC' : 'ORDER BY c.name COLLATE NOCASE, c.mobile'} LIMIT ?`,
  ...(q ? [`%${q}%`, `%${q}%`] : []), Math.min(Math.max(o.limit ?? 200, 1), 1000))
    .map((r) => ({ id: r.id, mobile: r.mobile, name: r.name, gstin: r.gstin, creditLimit: r.credit_limit, due: r.due }));
}

export function customerStatement(ctx: Ctx, customerId: string) {
  let bal = 0;
  return all<{ kind: string; amount: number; ref_id: string | null; mode: string | null; note: string | null; created_at: number; invoice_no: string | null }>(ctx.db,
    `SELECT l.kind, l.amount, l.ref_id, l.mode, l.note, l.created_at, i.invoice_no FROM customer_ledger l LEFT JOIN invoice i ON i.id = l.ref_id
      WHERE l.customer_id = ? ORDER BY l.seq`, customerId)
    .map((r) => ({ kind: r.kind, amount: r.amount, refId: r.ref_id, invoiceNo: r.invoice_no, mode: r.mode, note: r.note, at: r.created_at, balance: (bal += r.amount) }));
}

/**
 * Money a customer pays against their dues (cash, UPI, card). Cash taken this way is part of the shift's cash
 * (shift report). Paying more than the due is refused: an advance is a separate decision.
 */
export function collectDue(ctx: Ctx, actor: Actor, requestId: string, input: { customerId: string; amount: number; mode: 'CASH' | 'UPI' | 'CARD' | 'OTHER'; reference?: string | null }) {
  return retailCommand(ctx, requestId, 'customer.receipt', actor, () => {
    assertPerm(actor, 'invoice.finalize');
    const due = customerDue(ctx, input.customerId);
    if (!get(ctx.db, 'SELECT 1 FROM customer WHERE id = ?', input.customerId)) throw new AppError('NOT_FOUND', 'Customer not found.', 404);
    if (!Number.isInteger(input.amount) || input.amount <= 0) fail('Amount must be more than zero.');
    if (!['CASH', 'UPI', 'CARD', 'OTHER'].includes(input.mode)) fail('Mode must be CASH, UPI, CARD or OTHER.');
    if (input.amount > due) throw new AppError('MORE_THAN_DUE', `The customer owes Rs ${(due / 100).toFixed(2)}; this is more than that.`, 422, { due });
    if (input.mode === 'CASH' && !openShiftRow(ctx)) throw new AppError('NO_OPEN_SHIFT', 'Open a shift to take cash.', 409);
    postCustomerLedger(ctx, actor, input.customerId, 'RECEIPT', -input.amount, null, input.mode, opt(input.reference, 'Reference', 60));
    audit(ctx, actor.userId, 'customer.receipt', 'customer', input.customerId, { amount: input.amount, mode: input.mode });
    return { customerId: input.customerId, paid: input.amount, due: due - input.amount };
  });
}

/** A credit sale must fit the customer's limit (0 = no limit set); a manager can approve going over it. */
export function checkCreditLimit(ctx: Ctx, actor: Actor, customerId: string, adding: number, override?: Override | null): void {
  const c = get<{ credit_limit: number; name: string | null; mobile: string }>(ctx.db, 'SELECT credit_limit, name, mobile FROM customer WHERE id = ?', customerId)!;
  if (c.credit_limit === 0) return;
  const after = customerDue(ctx, customerId) + adding;
  if (after <= c.credit_limit) return;
  if (!override) {
    throw new AppError('CREDIT_LIMIT', `${c.name ?? c.mobile} would owe Rs ${(after / 100).toFixed(2)}, over the credit limit of Rs ${(c.credit_limit / 100).toFixed(2)}. A manager can approve it.`, 403,
      { needsApproval: true, permission: 'discount.over_limit', due: after - adding, limit: c.credit_limit });
  }
  requireApproval(ctx, actor, 'discount.over_limit', override);
}

/** Puts the customer on a bill (by id) or takes them off (null); a B2B customer sets the buyer GSTIN and place of supply. */
export function setOrderCustomer(ctx: Ctx, actor: Actor, requestId: string, input: { orderId: string; customerId: string | null }) {
  return runCommand(ctx, requestId, 'order.customer', actor, () => {
    assertPerm(actor, 'order.write');
    const o = get<{ status: string }>(ctx.db, 'SELECT status FROM sale_order WHERE id = ?', input.orderId);
    if (!o) throw new AppError('NOT_FOUND', 'Order not found.', 404);
    if (o.status !== 'DRAFT' && o.status !== 'HELD') throw new AppError('ORDER_NOT_OPEN', 'This bill can no longer be changed.', 409);
    if (input.customerId === null) {
      run(ctx.db, 'UPDATE sale_order SET customer_id = NULL, buyer_gstin = NULL, place_of_supply = NULL, updated_at = ? WHERE id = ?', ctx.clock.now(), input.orderId);
      return { orderId: input.orderId, customer: null };
    }
    const c = customerView(ctx, input.customerId);
    run(ctx.db, 'UPDATE sale_order SET customer_id = ?, customer_phone = ?, customer_name = ?, buyer_gstin = ?, place_of_supply = coalesce(?, place_of_supply), updated_at = ? WHERE id = ?',
      c.id, c.mobile, c.name, c.gstin, c.stateCode, ctx.clock.now(), input.orderId);
    return { orderId: input.orderId, customer: c };
  });
}
