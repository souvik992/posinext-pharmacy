import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../src/store/db.ts';
import type { Env } from './helpers.ts';
import { makeEnv, rid, startShift } from './helpers.ts';
import { createItem } from '../src/services/catalog.ts';
import { addScanCode, batchesWithStock } from '../src/services/products.ts';
import { addOpeningStock, checkStockIntegrity, onHand } from '../src/services/inventory.ts';
import { addLine, addScan, createOrder } from '../src/services/orders.ts';
import { cancelInvoice, createCreditNote, finalizeInvoice } from '../src/services/invoices.ts';
import { collectDue, customerStatement, saveCustomer, setOrderCustomer } from '../src/services/customers.ts';
import { setSetting } from '../src/services/settings.ts';
import { makeEan13 } from '../src/core/barcode.ts';
import { AppError } from '../src/store/db.ts';

const tax = (env: Env, bp: number) => get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = ? AND price_includes_tax = 1', bp)!.id;
const code = (f: () => unknown) => { try { f(); return 'no error'; } catch (e) { return e instanceof AppError ? e.code : String(e); } };
const mgr = (env: Env) => ({ userId: env.manager.userId, pin: '2345' });

function shop() {
  const env = makeEnv();
  startShift(env);
  const soap = createItem(env.ctx, env.manager, rid(), { name: 'Neem Soap 100g', taxGroupId: tax(env, 1800), price: 4500, mrp: 5000, barcode: makeEan13('890100000001'), uqc: 'PCS' }).id;
  addScanCode(env.ctx, env.manager, rid(), soap, { code: makeEan13('890100000099'), packQtyMilli: 6000 }); // a 6-pack
  const dal = createItem(env.ctx, env.manager, rid(), { name: 'Toor Dal Loose', taxGroupId: tax(env, 0), price: 14000, plu: '210', isWeighed: true, uqc: 'KGS' }).id;
  const biscuit = createItem(env.ctx, env.manager, rid(), { name: 'Cream Biscuit', taxGroupId: tax(env, 1800), price: 3000, mrp: 3000, batchTracked: true, barcode: makeEan13('890100000002') }).id;
  addOpeningStock(env.ctx, env.manager, rid(), [
    { itemId: soap, qtyMilli: 50000 },
    { itemId: dal, qtyMilli: 25000 },
    { itemId: biscuit, qtyMilli: 3000, batch: { batchNo: 'OLD', expiryDate: '2026-11-30', mrp: 2500 } }, // older pack, lower MRP
    { itemId: biscuit, qtyMilli: 10000, batch: { batchNo: 'NEW', expiryDate: '2027-05-31', mrp: 3000 } },
  ]);
  return { env, soap, dal, biscuit };
}

test('scanning: barcode, repeat scan adds to the line, quantity multiplier, case barcode, scale label, unknown code', () => {
  const { env, soap, dal } = shop();
  try {
    const order = createOrder(env.ctx, env.cashier, rid()).order.id;
    addScan(env.ctx, env.cashier, rid(), { orderId: order, code: makeEan13('890100000001') });
    addScan(env.ctx, env.cashier, rid(), { orderId: order, code: makeEan13('890100000001') });
    addScan(env.ctx, env.cashier, rid(), { orderId: order, code: makeEan13('890100000001'), multiplier: 3 });
    const pack = addScan(env.ctx, env.cashier, rid(), { orderId: order, code: makeEan13('890100000099') });
    assert.equal(pack.found && pack.cart.lines.find((l) => l.itemId === soap)!.qtyMilli, 11000, '1 + 1 + 3 + 6');
    const w = addScan(env.ctx, env.cashier, rid(), { orderId: order, code: makeEan13('210021001250') }); // 1.250 kg of PLU 210
    const line = w.found && w.cart.lines.find((l) => l.itemId === dal)!;
    assert.deepEqual(line && [line.qtyMilli, line.lineTotal, line.uqc], [1250, 17500, 'KGS']);
    const miss = addScan(env.ctx, env.cashier, rid(), { orderId: order, code: '8909999999999' });
    assert.equal(miss.found, false);
    assert.equal(code(() => addScan(env.ctx, env.cashier, rid(), { orderId: order, code: makeEan13('210021001250'), multiplier: 2 })), 'VALIDATION');
  } finally { env.cleanup(); }
});

test('batches at the counter: MRPs differ so the cashier chooses; old lower-MRP pack sells at its MRP; expired refused', () => {
  const { env, biscuit } = shop();
  try {
    const order = createOrder(env.ctx, env.cashier, rid()).order.id;
    let err: AppError | null = null;
    try { addLine(env.ctx, env.cashier, rid(), { orderId: order, itemId: biscuit }); } catch (e) { err = e as AppError; }
    assert.equal(err?.code, 'CHOOSE_BATCH');
    assert.deepEqual((err!.details as { batches: Array<{ batchNo: string; mrp: number }> }).batches.map((b) => [b.batchNo, b.mrp]), [['OLD', 2500], ['NEW', 3000]]);
    const [old, neu] = batchesWithStock(env.ctx, biscuit);
    const cart = addLine(env.ctx, env.cashier, rid(), { orderId: order, itemId: biscuit, batchId: old!.id, qtyMilli: 2000 });
    const l = cart.lines[0]!;
    assert.deepEqual([l.unitPrice, l.mrp, l.batch?.batchNo], [2500, 2500, 'OLD'], 'the item price (30) is above this pack\'s MRP (25): sold at 25');
    const c2 = addLine(env.ctx, env.cashier, rid(), { orderId: order, itemId: biscuit, batchId: neu!.id });
    assert.equal(c2.lines.length, 2, 'different batches stay on separate lines');
    env.clock.advance(60 * 86_400_000); // 11 Dec 2026: OLD has expired
    assert.equal(code(() => addLine(env.ctx, env.cashier, rid(), { orderId: order, itemId: biscuit, batchId: old!.id })), 'BATCH_EXPIRED');
    // only NEW is sellable now: picked by itself
    const order2 = createOrder(env.ctx, env.cashier, rid()).order.id;
    assert.equal(addLine(env.ctx, env.cashier, rid(), { orderId: order2, itemId: biscuit }).lines[0]!.batch?.batchNo, 'NEW');
  } finally { env.cleanup(); }
});

test('a bill takes stock out of the batch sold, keeps batch/MRP/UQC on the bill; an oversold batch stops the bill; cancel puts stock back', () => {
  const { env, soap, biscuit } = shop();
  try {
    const order = createOrder(env.ctx, env.cashier, rid()).order.id;
    const old = batchesWithStock(env.ctx, biscuit)[0]!;
    addLine(env.ctx, env.cashier, rid(), { orderId: order, itemId: soap, qtyMilli: 2000 });
    const cart = addLine(env.ctx, env.cashier, rid(), { orderId: order, itemId: biscuit, batchId: old.id, qtyMilli: 3000 });
    const bill = finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: order, payments: [{ mode: 'CASH', amount: cart.totals.grandTotal }] });
    assert.equal(onHand(env.ctx, soap), 48000);
    assert.equal(batchesWithStock(env.ctx, biscuit).find((b) => b.id === old.id), undefined, 'OLD batch sold out');
    const bl = get<{ batch_id: string; mrp: number; uqc: string }>(env.ctx.db, 'SELECT batch_id, mrp, uqc FROM invoice_line WHERE invoice_id = ? AND item_id = ?', bill.invoice.id, biscuit)!;
    assert.deepEqual({ ...bl }, { batch_id: old.id, mrp: 2500, uqc: 'NOS' });
    // another counter already sold the last OLD packs: this bill is refused, nothing is written
    const o2 = createOrder(env.ctx, env.cashier, rid()).order.id;
    const neu = batchesWithStock(env.ctx, biscuit)[0]!;
    const c2 = addLine(env.ctx, env.cashier, rid(), { orderId: o2, itemId: biscuit, batchId: neu.id, qtyMilli: 11000 });
    assert.equal(code(() => finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: o2, payments: [{ mode: 'CASH', amount: c2.totals.grandTotal }] })), 'NOT_ENOUGH_STOCK');
    assert.equal(get<{ n: number }>(env.ctx.db, 'SELECT count(*) n FROM invoice')!.n, 1);
    cancelInvoice(env.ctx, env.cashier, rid(), { invoiceId: bill.invoice.id, reason: 'customer left', override: mgr(env) });
    assert.equal(onHand(env.ctx, soap), 50000);
    assert.equal(batchesWithStock(env.ctx, biscuit).find((b) => b.id === old.id)?.qtyMilli, 3000);
    assert.deepEqual(checkStockIntegrity(env.ctx), []);
  } finally { env.cleanup(); }
});

test('khata: a credit sale needs the customer, fits the credit limit (manager can approve more), dues collected; a return to khata lowers the due', () => {
  const { env, soap } = shop();
  try {
    const cust = saveCustomer(env.ctx, env.manager, rid(), { mobile: '+91 98450 11111', name: 'Lakshmi', creditLimit: 50000 });
    assert.equal(cust.mobile, '9845011111');
    const sell = (qty: number) => {
      const o = createOrder(env.ctx, env.cashier, rid()).order.id;
      const c = addLine(env.ctx, env.cashier, rid(), { orderId: o, itemId: soap, qtyMilli: qty });
      return { o, total: c.totals.grandTotal };
    };
    const a = sell(4000); // Rs 180
    assert.equal(code(() => finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: a.o, payments: [{ mode: 'CREDIT', amount: a.total }] })), 'CUSTOMER_REQUIRED');
    setOrderCustomer(env.ctx, env.cashier, rid(), { orderId: a.o, customerId: cust.id });
    const billA = finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: a.o, payments: [{ mode: 'CREDIT', amount: a.total }] });
    const b = sell(8000); // Rs 360: due would be 540 > 500
    setOrderCustomer(env.ctx, env.cashier, rid(), { orderId: b.o, customerId: cust.id });
    assert.equal(code(() => finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: b.o, payments: [{ mode: 'CREDIT', amount: b.total }] })), 'CREDIT_LIMIT');
    finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: b.o, payments: [{ mode: 'CREDIT', amount: b.total }], override: mgr(env) });
    assert.equal(code(() => collectDue(env.ctx, env.cashier, rid(), { customerId: cust.id, amount: 60000, mode: 'CASH' })), 'MORE_THAN_DUE');
    collectDue(env.ctx, env.cashier, rid(), { customerId: cust.id, amount: 20000, mode: 'UPI', reference: 'UPI 81' });
    // return 1 soap from bill A to khata: due goes down by Rs 45
    const line = get<{ id: string }>(env.ctx.db, 'SELECT id FROM invoice_line WHERE invoice_id = ?', billA.invoice.id)!.id;
    createCreditNote(env.ctx, env.manager, rid(), { invoiceId: billA.invoice.id, lines: [{ invoiceLineId: line, qtyMilli: 1000 }], reason: 'damaged', refunds: [{ mode: 'CREDIT', amount: 4500 }] });
    assert.deepEqual(customerStatement(env.ctx, cust.id).map((r) => [r.kind, r.amount, r.balance]), [['SALE', 18000, 18000], ['SALE', 36000, 54000], ['RECEIPT', -20000, 34000], ['RETURN', -4500, 29500]]);
    assert.equal(onHand(env.ctx, soap), 50000 - 4000 - 8000 + 1000, 'returned soap is back in stock');
    assert.equal(get<{ customer_id: string }>(env.ctx.db, 'SELECT customer_id FROM invoice WHERE id = ?', billA.invoice.id)!.customer_id, cust.id);
  } finally { env.cleanup(); }
});

test('composition dealer: no GST on the bill (Bill of Supply), marked on the invoice', () => {
  const { env, soap } = shop();
  try {
    setSetting(env.ctx, 'gst_scheme', 'composition');
    const o = createOrder(env.ctx, env.cashier, rid()).order.id;
    const c = addLine(env.ctx, env.cashier, rid(), { orderId: o, itemId: soap, qtyMilli: 2000 });
    assert.deepEqual([c.totals.taxableTotal, c.totals.cgst + c.totals.sgst + c.totals.igst, c.totals.grandTotal, c.order.gstScheme], [9000, 0, 9000, 'composition']);
    const bill = finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: o, payments: [{ mode: 'CASH', amount: c.totals.grandTotal }] });
    assert.equal(get<{ gst_scheme: string }>(env.ctx.db, 'SELECT gst_scheme FROM invoice WHERE id = ?', bill.invoice.id)!.gst_scheme, 'composition');
  } finally { env.cleanup(); }
});
