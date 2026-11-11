import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../src/store/db.ts';
import { makeEnv, rid, startShift } from './helpers.ts';
import { createItem } from '../src/services/catalog.ts';
import { addLine, createOrder } from '../src/services/orders.ts';
import { finalizeInvoice } from '../src/services/invoices.ts';
import { setSetting } from '../src/services/settings.ts';
import { loadInvoiceFull } from '../src/services/invoiceView.ts';
import { receiptDataFrom } from '../src/services/printing/jobs.ts';
import { buildReceipt } from '../src/services/printing/receipt.ts';
import { parseEscPos } from '../src/services/printing/virtual.ts';

function billText(scheme: 'regular' | 'composition') {
  const env = makeEnv();
  try {
    startShift(env);
    if (scheme === 'composition') setSetting(env.ctx, 'gst_scheme', 'composition');
    const tax = get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = 500')!.id;
    const oil = createItem(env.ctx, env.manager, rid(), { name: 'Mustard Oil 1L', taxGroupId: tax, price: 17500, mrp: 19000 }).id;
    const o = createOrder(env.ctx, env.cashier, rid()).order.id;
    const c = addLine(env.ctx, env.cashier, rid(), { orderId: o, itemId: oil, qtyMilli: 2000 });
    const bill = finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: o, payments: [{ mode: 'CASH', amount: c.totals.grandTotal }] });
    const data = receiptDataFrom(loadInvoiceFull(env.ctx, bill.invoice.id));
    return parseEscPos(buildReceipt(data, { cols: 48, copyNo: 1, footer: '', drawer: false })).text;
  } finally { env.cleanup(); }
}

test('retail receipt: "You saved" from the MRP; a composition dealer prints BILL OF SUPPLY with the required statement and no GST', () => {
  const regular = billText('regular');
  assert.match(regular, /TAX INVOICE/);
  assert.match(regular, /You saved\s+30\.00/, '2 x (190 - 175)');
  const comp = billText('composition');
  assert.match(comp, /BILL OF SUPPLY/);
  assert.doesNotMatch(comp, /TAX INVOICE/);
  assert.match(comp.replace(/\s+/g, ' '), /Composition taxable person, not eligible to collect tax on supplies/);
  assert.doesNotMatch(comp, /CGST|SGST/);
});
