// What a bill does to stock and khata (V18), inside the bill's own transaction:
//  - a sale takes each line's quantity out of its batch (batch items can never go below zero, so an oversold batch
//    stops the bill with a clear message); a credit (khata) payment adds to the customer's due, within their limit;
//  - cancelling a same-day bill puts the stock back and takes the due off;
//  - a credit note (return) puts the returned goods back into the batch they were sold from, and a refund "to khata"
//    lowers the customer's due.
import { all, get, AppError } from '../store/db.ts';
import type { Actor, Ctx } from './ctx.ts';
import type { Override } from './auth.ts';
import { postMove } from './inventory.ts';
import { checkCreditLimit, postCustomerLedger } from './customers.ts';

interface SoldLine { item_id: string | null; batch_id: string | null; qty_milli: number; name: string }
const linesOf = (ctx: Ctx, invoiceId: string) => all<SoldLine>(ctx.db, 'SELECT item_id, batch_id, qty_milli, name FROM invoice_line WHERE invoice_id = ? ORDER BY line_no', invoiceId);
const creditPaid = (ctx: Ctx, invoiceId: string) => get<{ s: number | null }>(ctx.db, "SELECT sum(amount) s FROM payment WHERE invoice_id = ? AND mode = 'CREDIT'", invoiceId)?.s ?? 0;

export function afterSale(ctx: Ctx, actor: Actor, invoiceId: string, customerId: string | null, override?: Override | null): void {
  for (const l of linesOf(ctx, invoiceId)) {
    if (!l.item_id) continue; // fee lines (delivery, packaging) are not stock
    postMove(ctx, actor, { itemId: l.item_id, batchId: l.batch_id, deltaMilli: -l.qty_milli, kind: 'SALE', refType: 'invoice', refId: invoiceId });
  }
  const credit = creditPaid(ctx, invoiceId);
  if (credit > 0) {
    if (!customerId) throw new AppError('CUSTOMER_REQUIRED', 'Add the customer (mobile number) to give credit.', 422);
    checkCreditLimit(ctx, actor, customerId, credit, override);
    postCustomerLedger(ctx, actor, customerId, 'SALE', credit, invoiceId, 'CREDIT', null);
  }
}

export function afterCancel(ctx: Ctx, actor: Actor, invoiceId: string): void {
  for (const l of linesOf(ctx, invoiceId)) {
    if (!l.item_id) continue;
    postMove(ctx, actor, { itemId: l.item_id, batchId: l.batch_id, deltaMilli: l.qty_milli, kind: 'SALE_CANCEL', refType: 'invoice', refId: invoiceId });
  }
  const iv = get<{ customer_id: string | null }>(ctx.db, 'SELECT customer_id FROM invoice WHERE id = ?', invoiceId)!;
  const credit = creditPaid(ctx, invoiceId);
  if (credit > 0 && iv.customer_id) postCustomerLedger(ctx, actor, iv.customer_id, 'SALE_CANCEL', -credit, invoiceId, null, 'Bill cancelled');
}

/** Returned goods go back to stock (into the batch sold), unless the shop says returns are written off. */
export function afterCreditNote(ctx: Ctx, actor: Actor, creditNoteId: string, restock: boolean): void {
  const cn = get<{ customer_id: string | null; original_invoice_id: string }>(ctx.db, 'SELECT customer_id, original_invoice_id FROM invoice WHERE id = ?', creditNoteId)!;
  if (restock) {
    for (const l of linesOf(ctx, creditNoteId)) {
      if (!l.item_id) continue;
      postMove(ctx, actor, { itemId: l.item_id, batchId: l.batch_id, deltaMilli: l.qty_milli, kind: 'SALE_RETURN', refType: 'invoice', refId: creditNoteId });
    }
  }
  const toKhata = creditPaid(ctx, creditNoteId);
  if (toKhata > 0) {
    if (!cn.customer_id) throw new AppError('CUSTOMER_REQUIRED', 'This bill has no customer, so the refund cannot go to khata.', 422);
    postCustomerLedger(ctx, actor, cn.customer_id, 'RETURN', -toKhata, creditNoteId, 'CREDIT', null);
  }
}
