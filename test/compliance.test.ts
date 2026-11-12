import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../src/store/db.ts';
import type { Env } from './helpers.ts';
import { makeEnv, rid, startShift } from './helpers.ts';
import { createItem } from '../src/services/catalog.ts';
import { addLine, createOrder, updateOrder } from '../src/services/orders.ts';
import { finalizeInvoice, createCreditNote } from '../src/services/invoices.ts';
import { setSetting } from '../src/services/settings.ts';
import { compositionSummary } from '../src/services/gstr1.ts';
import { docTitle } from '../src/services/printing/receiptTemplate.ts';
import type { ReceiptData } from '../src/services/printing/receipt.ts';

const tax = (env: Env, bp: number) => get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = ? AND price_includes_tax = 1', bp)!.id;
const bill = (lines: number[], o: { buyerGstin?: string | null; scheme?: 'regular' | 'composition' } = {}) => ({
  invoice: { gstScheme: o.scheme ?? 'regular', buyerGstin: o.buyerGstin ?? null },
  lines: lines.map((rateBp) => ({ rateBp })),
}) as unknown as ReceiptData;

test('document title: Tax Invoice, Bill of Supply (exempt goods only; composition), Invoice-cum-Bill of Supply (Rule 46A, B2C only)', () => {
  assert.equal(docTitle(bill([500, 1800])), 'TAX INVOICE');
  assert.equal(docTitle(bill([0, 0])), 'BILL OF SUPPLY', 'loose rice and dal only (Rule 49)');
  assert.equal(docTitle(bill([0, 500])), 'INVOICE-CUM-BILL OF SUPPLY', 'taxed and exempt goods to an unregistered buyer (Rule 46A)');
  assert.equal(docTitle(bill([0, 500], { buyerGstin: '29AABCH1234M1Z5' })), 'TAX INVOICE', 'Rule 46A is not for registered buyers');
  assert.equal(docTitle(bill([500], { scheme: 'composition' })), 'BILL OF SUPPLY');
});

test('composition dealer: no inter-state bills; the quarter summary splits taxable and exempt turnover with 1% tax, credit notes netted', () => {
  const env = makeEnv();
  try {
    startShift(env);
    setSetting(env.ctx, 'gst_scheme', 'composition');
    const oil = createItem(env.ctx, env.manager, rid(), { name: 'Oil 1L', taxGroupId: tax(env, 500), price: 15000 }).id; // taxable goods
    const dal = createItem(env.ctx, env.manager, rid(), { name: 'Dal Loose', taxGroupId: tax(env, 0), price: 12000 }).id; // exempt goods
    const sell = (itemId: string, qtyMilli: number, pos?: string) => {
      const o = createOrder(env.ctx, env.cashier, rid()).order.id;
      if (pos) updateOrder(env.ctx, env.manager, rid(), { orderId: o, placeOfSupply: pos });
      const c = addLine(env.ctx, env.cashier, rid(), { orderId: o, itemId, qtyMilli });
      return finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: o, payments: [{ mode: 'CASH', amount: c.totals.grandTotal }] });
    };
    assert.throws(() => sell(oil, 1000, '33'), /cannot bill a sale to another state/);
    const b = sell(oil, 10000); // Rs 1500 taxable
    sell(dal, 5000); // Rs 600 exempt
    const line = get<{ id: string }>(env.ctx.db, 'SELECT id FROM invoice_line WHERE invoice_id = ?', b.invoice.id)!.id;
    createCreditNote(env.ctx, env.manager, rid(), { invoiceId: b.invoice.id, lines: [{ invoiceLineId: line, qtyMilli: 2000 }], reason: 'returned', refunds: [{ mode: 'CASH', amount: 30000 }] });
    const q = compositionSummary(env.ctx, '2026-27-Q3'); // Oct-Dec 2026 (the test clock is 12 Oct 2026)
    assert.deepEqual(q, { quarter: '2026-27-Q3', from: '2026-10', to: '2026-12', taxableTurnover: 120000, exemptTurnover: 60000, totalTurnover: 180000, rateBp: 100, cgst: 600, sgst: 600, tax: 1200 });
    assert.equal(compositionSummary(env.ctx, '2026-27-Q2').totalTurnover, 0);
    assert.throws(() => compositionSummary(env.ctx, '2026-28-Q1'), /Quarter must be like/);
  } finally { env.cleanup(); }
});
