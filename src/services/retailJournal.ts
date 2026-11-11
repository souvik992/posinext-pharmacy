// The bill journal for retail records (outside the database, like Tiffin's invoices): every retail command writes the
// rows it inserted (stock moves, batches, goods receipts, supplier and customer ledgers, ...) to the journal after it
// commits, so restoring an older backup and replaying the journal brings them back. Rows are found by rowid: a command
// notes each table's max(rowid) first, and afterwards everything above it is what it inserted.
import { all, get, run } from '../store/db.ts';
import type { Actor, Ctx } from './ctx.ts';
import { runCommand, type CommandOptions, type Helpers } from './commands.ts';
import { appendJournal } from './journal.ts';

/** Retail tables in the order rows must go back (parents before children). Only these can be replayed. */
export const RETAIL_TABLES = [
  'supplier', 'supplier_ledger', 'batch', 'grn', 'grn_line', 'purchase_return', 'purchase_return_line', 'item_stock_move',
  'customer', 'customer_ledger', 'shift_cash_count', 'stock_count', 'stock_count_line',
] as const;
export type RetailTable = (typeof RETAIL_TABLES)[number];

/** Updates a command may journal (a status change); replayed only when the row is still in its earlier state. */
const UPDATABLE: Partial<Record<RetailTable, { key: string; cols: string[] }>> = {
  grn: { key: 'id', cols: ['status', 'voided_at', 'voided_by', 'void_reason'] },
  stock_count: { key: 'id', cols: ['status', 'posted_at', 'posted_by'] },
};

export interface RowsEntry {
  v: 1; type: 'rows'; at: number; op: string;
  rows: Array<{ table: RetailTable; row: Record<string, unknown> }>;
  updates?: Array<{ table: RetailTable; key: string; set: Record<string, unknown> }>;
  counters?: Array<{ kind: string; fy: string; last: number }>;
}

const existing = (ctx: Ctx): Set<string> => new Set(all<{ name: string }>(ctx.db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name));

/** Marks where each retail table ends now; `collect` returns the rows inserted since. */
export function trackInserts(ctx: Ctx) {
  const have = existing(ctx);
  const marks = new Map<RetailTable, number>();
  for (const t of RETAIL_TABLES) if (have.has(t)) marks.set(t, get<{ m: number | null }>(ctx.db, `SELECT max(rowid) m FROM ${t}`)?.m ?? 0);
  return {
    collect(): RowsEntry['rows'] {
      const out: RowsEntry['rows'] = [];
      for (const [t, m] of marks) for (const row of all<Record<string, unknown>>(ctx.db, `SELECT * FROM ${t} WHERE rowid > ? ORDER BY rowid`, m)) out.push({ table: t, row });
      return out;
    },
  };
}

export interface RetailHelpers extends Helpers {
  /** A status change to replay too (e.g. a goods receipt voided). */
  update(table: RetailTable, key: string, set: Record<string, unknown>): void;
}

/** runCommand that also journals the retail rows it inserted (and declared updates and document counters) after commit. */
export function retailCommand<T>(ctx: Ctx, requestId: string, name: string, actor: Actor | null, fn: (h: RetailHelpers) => T, opts: CommandOptions<T> = {}): T {
  return runCommand(ctx, requestId, name, actor, (h) => {
    const track = trackInserts(ctx);
    const updates: NonNullable<RowsEntry['updates']> = [];
    const out = fn({ after: h.after, update: (table, key, set) => updates.push({ table, key, set }) });
    const rows = track.collect();
    if (rows.length || updates.length) {
      // document counters change in place (last + 1); the table is tiny, so carry all of it
      const counters = all<{ kind: string; fy: string; last: number }>(ctx.db, 'SELECT kind, fy, last FROM doc_counter');
      const entry: RowsEntry = { v: 1, type: 'rows', at: ctx.clock.now(), op: name, rows, ...(updates.length ? { updates } : {}), counters };
      h.after(() => appendJournal(ctx, entry));
    }
    return out;
  }, opts);
}

/** Replays one rows entry: inserts what is missing (by primary key), applies updates, moves counters forward. */
export function applyRowsEntry(ctx: Ctx, e: RowsEntry): boolean {
  const have = existing(ctx);
  let changed = false;
  const order = new Map(RETAIL_TABLES.map((t, i) => [t, i]));
  for (const { table, row } of [...e.rows].sort((a, b) => order.get(a.table)! - order.get(b.table)!)) {
    if (!order.has(table) || !have.has(table)) throw new Error(`journal names an unknown table "${table}"`);
    const cols = new Set(all<{ name: string }>(ctx.db, `SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name));
    const keys = Object.keys(row).filter((k) => cols.has(k) && k !== 'seq');
    const r = run(ctx.db, `INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => row[k] as never));
    if (Number(r.changes) > 0) changed = true;
  }
  for (const u of e.updates ?? []) {
    const spec = UPDATABLE[u.table];
    if (!spec) throw new Error(`journal update on "${u.table}" is not allowed`);
    const set = Object.keys(u.set).filter((c) => spec.cols.includes(c));
    if (!set.length) continue;
    const r = run(ctx.db, `UPDATE ${u.table} SET ${set.map((c) => `${c} = ?`).join(', ')} WHERE ${spec.key} = ? AND (${set.map((c) => `${c} IS NOT ?`).join(' OR ')})`,
      ...set.map((c) => u.set[c] as never), u.key, ...set.map((c) => u.set[c] as never));
    if (Number(r.changes) > 0) changed = true;
  }
  for (const c of e.counters ?? []) {
    run(ctx.db, 'INSERT INTO doc_counter (kind, fy, last) VALUES (?,?,?) ON CONFLICT(kind, fy) DO UPDATE SET last = max(last, excluded.last)', c.kind, c.fy, c.last);
  }
  return changed;
}

/** Stock on hand rebuilt from the ledger (after a replay). */
export function recomputeItemStock(ctx: Ctx): void {
  run(ctx.db, 'DELETE FROM item_stock');
  run(ctx.db, `INSERT INTO item_stock (item_id, batch_key, qty_milli)
               SELECT item_id, ifnull(batch_id, ''), sum(delta_milli) FROM item_stock_move GROUP BY item_id, ifnull(batch_id, '')`);
}
