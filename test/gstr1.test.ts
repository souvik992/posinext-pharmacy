import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../src/store/db.ts';
import type { Env } from './helpers.ts';
import { makeEnv, rid, startShift } from './helpers.ts';
import { createItem } from '../src/services/catalog.ts';
import { addLine, createOrder, updateOrder } from '../src/services/orders.ts';
import { cancelInvoice, createCreditNote, finalizeInvoice } from '../src/services/invoices.ts';
import { saveCustomer, setOrderCustomer } from '../src/services/customers.ts';
import { gstr1, gstr1Csv } from '../src/services/gstr1.ts';
import { gstinCheckChar } from '../src/core/gstin.ts';

const tax = (env: Env, bp: number) => get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = ? AND price_includes_tax = 1', bp)!.id;
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const lineOf = (env: Env, invoiceId: string) => get<{ id: string }>(env.ctx.db, 'SELECT id FROM invoice_line WHERE invoice_id = ?', invoiceId)!.id;

test('GSTR-1: B2B, B2CL (inter-state B2C above Rs 1 lakh), B2CS netted with returns, CDNR, HSN B2B/B2C, documents with cancellations', () => {
  const env = makeEnv();
  try {
    startShift(env);
    const tv = createItem(env.ctx, env.manager, rid(), { name: 'LED TV 43in', taxGroupId: tax(env, 1800), price: 11800000, hsnCode: '85287217', uqc: 'NOS' }).id; // Rs 1,18,000 with GST
    const soap = createItem(env.ctx, env.manager, rid(), { name: 'Soap', taxGroupId: tax(env, 1800), price: 11800, hsnCode: '34011190', uqc: 'PCS' }).id; // Rs 118 with GST
    const bill = (itemId: string, qtyMilli: number, before?: (orderId: string) => void) => {
      const o = createOrder(env.ctx, env.cashier, rid()).order.id;
      before?.(o);
      const c = addLine(env.ctx, env.cashier, rid(), { orderId: o, itemId, qtyMilli });
      return finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: o, payments: [{ mode: 'CASH', amount: c.totals.grandTotal }] });
    };
    const shop = gstin('29AABCH1234M1Z');
    const b2bCust = saveCustomer(env.ctx, env.manager, rid(), { mobile: '9000022222', name: 'Hotel Annapurna', gstin: shop });
    const b2b = bill(soap, 10000, (o) => setOrderCustomer(env.ctx, env.cashier, rid(), { orderId: o, customerId: b2bCust.id })); // 10 soaps to a registered hotel
    const tvBill = bill(tv, 1000, (o) => updateOrder(env.ctx, env.manager, rid(), { orderId: o, placeOfSupply: '33' })); // delivered to a consumer in Tamil Nadu
    const s1 = bill(soap, 2000); // counter sale: 2 soaps, 1 comes back
    createCreditNote(env.ctx, env.manager, rid(), { invoiceId: s1.invoice.id, lines: [{ invoiceLineId: lineOf(env, s1.invoice.id), qtyMilli: 1000 }], reason: 'damaged', refunds: [{ mode: 'CASH', amount: 11800 }] });
    const s2 = bill(soap, 3000); // cancelled the same day
    cancelInvoice(env.ctx, env.manager, rid(), { invoiceId: s2.invoice.id, reason: 'wrong bill', override: { userId: env.manager.userId, pin: '2345' } });
    createCreditNote(env.ctx, env.manager, rid(), { invoiceId: b2b.invoice.id, lines: [{ invoiceLineId: lineOf(env, b2b.invoice.id), qtyMilli: 2000 }], reason: 'excess', refunds: [{ mode: 'CASH', amount: 23600 }] });

    const g = gstr1(env.ctx, '2026-10');
    assert.deepEqual(g.b2b.map((i) => [i.gstin, i.value, i.rates.map((r) => [r.rateBp, r.taxable])]), [[shop, 118000, [[1800, 100000]]]]);
    assert.deepEqual(g.b2cl.map((i) => [i.invoiceNo, i.pos, i.value]), [[tvBill.invoice.invoiceNo, '33', 11800000]]);
    assert.deepEqual(g.b2cs.map((e) => [e.pos, e.rateBp, e.taxable]), [['29', 1800, 10000]], 'B2C soaps: 2 sold - 1 returned (the cancelled bill is not a supply); the TV is in B2CL');
    assert.deepEqual(g.cdnr.map((n) => [n.gstin, n.value]), [[shop, 23600]]);
    assert.deepEqual(g.hsnB2b.map((h) => [h.hsn, h.uqc, h.qtyMilli, h.taxable]), [['34011190', 'PCS', 8000, 80000]], '10 sold - 2 returned');
    assert.deepEqual(g.hsnB2c.map((h) => [h.hsn, h.qtyMilli]), [['34011190', 1000], ['85287217', 1000]]);
    assert.deepEqual(g.docs.map((d) => [d.nature, d.total, d.cancelled]), [['Invoices for outward supply', 4, 1], ['Credit Note', 2, 0]]);
    assert.deepEqual(g.missingHsn, []);
    const files = gstr1Csv(env.ctx, '2026-10');
    assert.match(files['b2b.csv']!, /^GSTIN\/UIN of Recipient,Receiver Name,Invoice Number,Invoice date,Invoice Value,/);
    assert.ok(files['b2b.csv']!.includes(`${shop},Hotel Annapurna,${b2b.invoice.invoiceNo},12-Oct-2026,1180.00,29-Karnataka,N,,Regular B2B,,18,1000.00,0.00`));
    assert.match(files['b2cl.csv']!, /33-Tamil Nadu,,18,100000\.00/);
    assert.match(files['b2cs.csv']!, /OE,29-Karnataka,,18,100\.00,0\.00/);
    assert.deepEqual(gstr1(env.ctx, '2026-11').b2cs, [], 'another month is empty');
  } finally { env.cleanup(); }
});
