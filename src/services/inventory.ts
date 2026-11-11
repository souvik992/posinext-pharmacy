// Retail stock (V16): on-hand per item and batch, every change an immutable ledger row (GST Rule 56 stock account:
// opening, receipts, supplies, lost/stolen/destroyed, closing). Sales, purchases, returns and counts all post here.
import { all, get, run, AppError } from '../store/db.ts';
import type { Actor, Ctx } from './ctx.ts';
import { runCommand } from './commands.ts';
import { audit } from './audit.ts';
import { assertPerm } from './permissions.ts';
import { getSetting, setSetting } from './settings.ts';
import { findOrCreateBatch, type BatchInput } from './products.ts';

export type MoveKind = 'OPENING' | 'PURCHASE' | 'PURCHASE_RETURN' | 'PURCHASE_VOID' | 'SALE' | 'SALE_RETURN' | 'SALE_CANCEL' | 'ADJUST' | 'COUNT' | 'TRANSFER_OUT' | 'TRANSFER_IN';

/** Why stock was adjusted by hand (Rule 56 asks for lost, stolen, destroyed, written off, free samples). */
export const ADJUST_REASONS = { DAMAGED: 'Damaged', EXPIRED: 'Expired', LOST: 'Lost or stolen', SAMPLE: 'Free sample / own use', FOUND: 'Found extra', CORRECTION: 'Entry correction' } as const;
export type AdjustReason = keyof typeof ADJUST_REASONS;

function fail(msg: string): never { throw new AppError('VALIDATION', msg); }

/** Items without batches may go below zero (shops bill before entering stock) unless the owner turns that off. */
export const negativeStockAllowed = (ctx: Ctx) => getSetting(ctx, 'negative_stock') !== 'block';

export function setNegativeStock(ctx: Ctx, actor: Actor, requestId: string, allow: boolean) {
  return runCommand(ctx, requestId, 'stock.negative_policy', actor, () => {
    assertPerm(actor, 'settings.write');
    setSetting(ctx, 'negative_stock', allow ? 'allow' : 'block');
    audit(ctx, actor.userId, 'stock.negative_policy', 'settings', 'negative_stock', { allow });
    return { allow };
  });
}

interface ItemFacts { id: string; name: string; batch_tracked: number; track_stock: number }
const itemFacts = (ctx: Ctx, itemId: string) => get<ItemFacts>(ctx.db, 'SELECT id, name, batch_tracked, track_stock FROM item WHERE id = ?', itemId);

export interface MoveInput { itemId: string; batchId?: string | null; deltaMilli: number; kind: MoveKind; reason?: string | null; refType?: string | null; refId?: string | null; unitCost?: number | null }

/**
 * One stock change, inside the caller's transaction. Batch-tracked items must name the batch and can never go below
 * zero (ERPNext v15 rule); other items follow the shop's negative-stock setting. Items with stock tracking off are
 * skipped (services, gift wrapping, carry bags sold by count without stock).
 */
export function postMove(ctx: Ctx, actor: Actor | null, m: MoveInput): { moved: boolean; onHandMilli: number } {
  if (!Number.isInteger(m.deltaMilli) || m.deltaMilli === 0) fail('Stock change must be a whole, non-zero number of thousandths.');
  const it = itemFacts(ctx, m.itemId);
  if (!it) throw new AppError('NOT_FOUND', 'Item not found.', 404);
  if (it.track_stock !== 1) return { moved: false, onHandMilli: 0 };
  let key = '';
  if (it.batch_tracked === 1) {
    if (!m.batchId) fail(`${it.name} is tracked by batch: choose the batch.`);
    if (!get(ctx.db, 'SELECT 1 FROM batch WHERE id = ? AND item_id = ?', m.batchId, m.itemId)) fail(`That batch is not a batch of ${it.name}.`);
    key = m.batchId!;
  } else if (m.batchId) fail(`${it.name} is not tracked by batch.`);
  const cur = get<{ qty_milli: number }>(ctx.db, 'SELECT qty_milli FROM item_stock WHERE item_id = ? AND batch_key = ?', m.itemId, key)?.qty_milli ?? 0;
  const next = cur + m.deltaMilli;
  if (next < 0 && m.deltaMilli < 0 && (it.batch_tracked === 1 || !negativeStockAllowed(ctx))) {
    throw new AppError('NOT_ENOUGH_STOCK', `Only ${(cur / 1000).toString()} of ${it.name}${key ? ' in this batch' : ''} in stock.`, 409, { itemId: m.itemId, batchId: m.batchId ?? null, onHandMilli: cur });
  }
  run(ctx.db, 'INSERT INTO item_stock (item_id, batch_key, qty_milli) VALUES (?,?,?) ON CONFLICT(item_id, batch_key) DO UPDATE SET qty_milli = excluded.qty_milli', m.itemId, key, next);
  run(ctx.db, `INSERT INTO item_stock_move (id, item_id, batch_id, delta_milli, kind, reason, ref_type, ref_id, unit_cost, created_by, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`, ctx.ids.next(), m.itemId, m.batchId ?? null, m.deltaMilli, m.kind, m.reason ?? null, m.refType ?? null, m.refId ?? null, m.unitCost ?? null, actor?.userId ?? null, ctx.clock.now());
  return { moved: true, onHandMilli: next };
}

export interface StockLineInput { itemId: string; qtyMilli: number; unitCost?: number | null; batch?: BatchInput | null }

/** Opening stock when the shop starts with Retail POS (or a newly added item): batches are created as given. */
export function addOpeningStock(ctx: Ctx, actor: Actor, requestId: string, lines: StockLineInput[]) {
  return runCommand(ctx, requestId, 'stock.opening', actor, () => {
    assertPerm(actor, 'stock.write');
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 5000) fail('Give 1 to 5000 lines of opening stock.');
    const ref = ctx.ids.next();
    for (const l of lines) {
      if (!Number.isInteger(l.qtyMilli) || l.qtyMilli <= 0) fail('Opening quantities must be more than zero.');
      const it = itemFacts(ctx, l.itemId);
      if (!it) throw new AppError('NOT_FOUND', 'Item not found.', 404);
      const batchId = it.batch_tracked === 1 ? (l.batch ? findOrCreateBatch(ctx, l.itemId, { ...l.batch, cost: l.batch.cost ?? l.unitCost ?? null }) : fail(`${it.name} is tracked by batch: give the batch number.`)) : null;
      postMove(ctx, actor, { itemId: l.itemId, batchId, deltaMilli: l.qtyMilli, kind: 'OPENING', refType: 'opening', refId: ref, unitCost: l.unitCost ?? null });
    }
    audit(ctx, actor.userId, 'stock.opening', 'stock', ref, { lines: lines.length });
    return { ref, lines: lines.length };
  });
}

/** A manual change with its reason (damaged, expired, lost, ...): negative removes stock, positive adds it. */
export function adjustStock(ctx: Ctx, actor: Actor, requestId: string, input: { itemId: string; batchId?: string | null; deltaMilli: number; reason: AdjustReason; note?: string | null }) {
  return runCommand(ctx, requestId, 'stock.adjust', actor, () => {
    assertPerm(actor, 'stock.write');
    if (!(input.reason in ADJUST_REASONS)) fail(`Reason must be one of ${Object.keys(ADJUST_REASONS).join(', ')}.`);
    if (input.reason === 'FOUND' && input.deltaMilli < 0) fail('"Found extra" adds stock.');
    if (['DAMAGED', 'EXPIRED', 'LOST', 'SAMPLE'].includes(input.reason) && input.deltaMilli > 0) fail(`"${ADJUST_REASONS[input.reason]}" removes stock.`);
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
    const r = postMove(ctx, actor, { itemId: input.itemId, batchId: input.batchId ?? null, deltaMilli: input.deltaMilli, kind: 'ADJUST', reason: note ? `${input.reason}: ${note}` : input.reason, refType: 'adjust' });
    audit(ctx, actor.userId, 'stock.adjust', 'item', input.itemId, { deltaMilli: input.deltaMilli, reason: input.reason, batchId: input.batchId ?? null });
    return r;
  });
}

export function onHand(ctx: Ctx, itemId: string): number {
  return get<{ q: number | null }>(ctx.db, 'SELECT sum(qty_milli) q FROM item_stock WHERE item_id = ?', itemId)?.q ?? 0;
}

/** Stock list for the Stock screen: on hand, reorder level, value at the last cost. lowOnly: at or below the reorder level. */
export function stockList(ctx: Ctx, o: { lowOnly?: boolean; q?: string } = {}) {
  const rows = all<{ id: string; name: string; sku: string | null; uqc: string; batch_tracked: number; reorder_level_milli: number; on_hand: number; mrp: number | null; purchase_price: number | null }>(ctx.db,
    `SELECT i.id, i.name, i.sku, i.uqc, i.batch_tracked, i.reorder_level_milli, ifnull(sum(s.qty_milli), 0) AS on_hand, i.mrp, i.purchase_price
       FROM item i LEFT JOIN item_stock s ON s.item_id = i.id
      WHERE i.deleted_at IS NULL AND i.track_stock = 1 ${o.q ? 'AND (i.name LIKE ? OR i.sku LIKE ?)' : ''}
      GROUP BY i.id ${o.lowOnly ? 'HAVING on_hand <= i.reorder_level_milli AND i.reorder_level_milli > 0' : ''}
      ORDER BY i.name COLLATE NOCASE`, ...(o.q ? [`%${o.q}%`, `%${o.q}%`] : []));
  return rows.map((r) => ({ id: r.id, name: r.name, sku: r.sku, uqc: r.uqc, batchTracked: r.batch_tracked === 1, reorderLevelMilli: r.reorder_level_milli, onHandMilli: r.on_hand, low: r.reorder_level_milli > 0 && r.on_hand <= r.reorder_level_milli, mrp: r.mrp, purchasePrice: r.purchase_price }));
}

/** The item's ledger, newest first (the stock card). */
export function stockCard(ctx: Ctx, itemId: string, limit = 200) {
  return all<{ seq: number; batch_id: string | null; batch_no: string | null; delta_milli: number; kind: MoveKind; reason: string | null; ref_type: string | null; ref_id: string | null; created_at: number }>(ctx.db,
    `SELECT m.seq, m.batch_id, b.batch_no, m.delta_milli, m.kind, m.reason, m.ref_type, m.ref_id, m.created_at
       FROM item_stock_move m LEFT JOIN batch b ON b.id = m.batch_id WHERE m.item_id = ? ORDER BY m.seq DESC LIMIT ?`, itemId, Math.min(Math.max(limit, 1), 1000))
    .map((r) => ({ seq: r.seq, batchId: r.batch_id, batchNo: r.batch_no, deltaMilli: r.delta_milli, kind: r.kind, reason: r.reason, refType: r.ref_type, refId: r.ref_id, at: r.created_at }));
}

/** Ledger and balances agree (a self-check for tests and the Data Manager). */
export function checkStockIntegrity(ctx: Ctx): string[] {
  return all<{ item_id: string; batch_key: string; qty_milli: number; ledger: number | null }>(ctx.db,
    `SELECT s.item_id, s.batch_key, s.qty_milli,
            (SELECT sum(delta_milli) FROM item_stock_move m WHERE m.item_id = s.item_id AND ifnull(m.batch_id, '') = s.batch_key) AS ledger
       FROM item_stock s`).filter((r) => (r.ledger ?? 0) !== r.qty_milli).map((r) => `${r.item_id}/${r.batch_key || '-'}: on hand ${r.qty_milli}, ledger ${r.ledger ?? 0}`);
}
