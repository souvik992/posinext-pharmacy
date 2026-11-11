import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../src/store/db.ts';
import type { Env } from './helpers.ts';
import { makeEnv, rid } from './helpers.ts';
import { createItem } from '../src/services/catalog.ts';
import { addOpeningStock, checkStockIntegrity, countView, onHand, postCount, recordCount, startCount, stockCard } from '../src/services/inventory.ts';
import { batchesWithStock } from '../src/services/products.ts';
import { addLine, createOrder } from '../src/services/orders.ts';
import { finalizeInvoice } from '../src/services/invoices.ts';
import { closeShift, openShift, zReport } from '../src/services/shifts.ts';
import { collectDue, saveCustomer, setOrderCustomer } from '../src/services/customers.ts';

const tax = (env: Env, bp: number) => get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = ? AND price_includes_tax = 1', bp)!.id;

test('shift: cash counted note by note at open and close; cash collected against khata is in the expected cash', () => {
  const env = makeEnv();
  try {
    assert.throws(() => openShift(env.ctx, env.cashier, rid(), { openingCash: 100000, denominations: { 50000: 1, 10000: 4 } }), /do not add up/);
    assert.throws(() => openShift(env.ctx, env.cashier, rid(), { openingCash: 100000, denominations: { 30000: 1 } }), /not an Indian note/);
    const s = openShift(env.ctx, env.cashier, rid(), { openingCash: 100000, denominations: { 50000: 1, 10000: 5 } });
    const item = createItem(env.ctx, env.manager, rid(), { name: 'Atta 5kg', taxGroupId: tax(env, 500), price: 25000 }).id;
    const cust = saveCustomer(env.ctx, env.manager, rid(), { mobile: '9000011111', name: 'Asha' });
    // a cash sale (Rs 250) and a credit sale (Rs 250), then Rs 100 of the due collected in cash
    for (const mode of ['CASH', 'CREDIT']) {
      const o = createOrder(env.ctx, env.cashier, rid()).order.id;
      const c = addLine(env.ctx, env.cashier, rid(), { orderId: o, itemId: item });
      if (mode === 'CREDIT') setOrderCustomer(env.ctx, env.cashier, rid(), { orderId: o, customerId: cust.id });
      finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: o, payments: [{ mode, amount: c.totals.grandTotal }] });
    }
    collectDue(env.ctx, env.cashier, rid(), { customerId: cust.id, amount: 10000, mode: 'CASH' });
    const z = zReport(env.ctx, s.id);
    assert.deepEqual([z.byMode.CASH, z.byMode.CREDIT, z.duesCollected.CASH, z.cash.expected], [25000, 25000, 10000, 100000 + 25000 + 10000]);
    const closed = closeShift(env.ctx, env.cashier, rid(), { countedCash: 135000, denominations: { 50000: 2, 20000: 1, 10000: 1, 5000: 1 } });
    assert.equal(closed.cash.difference, 0);
    assert.deepEqual(closed.cashCount.open, [{ denom: 50000, count: 1 }, { denom: 10000, count: 5 }]);
    assert.deepEqual(closed.cashCount.close.map((c) => c.denom), [50000, 20000, 10000, 5000]);
  } finally { env.cleanup(); }
});

test('stock take: scan to add, set a total, per batch; posting moves stock to what was counted and records the difference', () => {
  const env = makeEnv();
  try {
    const salt = createItem(env.ctx, env.manager, rid(), { name: 'Salt 1kg', taxGroupId: tax(env, 0), price: 2800 }).id;
    const jam = createItem(env.ctx, env.manager, rid(), { name: 'Jam 500g', taxGroupId: tax(env, 500), price: 16000, batchTracked: true }).id;
    addOpeningStock(env.ctx, env.manager, rid(), [{ itemId: salt, qtyMilli: 40000 }, { itemId: jam, qtyMilli: 10000, batch: { batchNo: 'J1', expiryDate: '2027-01-31' } }]);
    const j1 = batchesWithStock(env.ctx, jam)[0]!.id;
    const c = startCount(env.ctx, env.manager, rid(), { name: 'Aisle 2' });
    for (let i = 0; i < 3; i++) recordCount(env.ctx, env.manager, rid(), { countId: c.id, itemId: salt, qtyMilli: 1000 }); // three scans
    recordCount(env.ctx, env.manager, rid(), { countId: c.id, itemId: salt, qtyMilli: 35000, mode: 'set' }); // then counted the rest: 35 in all
    assert.throws(() => recordCount(env.ctx, env.manager, rid(), { countId: c.id, itemId: jam, qtyMilli: 1000 }), /count each batch/);
    recordCount(env.ctx, env.manager, rid(), { countId: c.id, itemId: jam, batchId: j1, qtyMilli: 12000, mode: 'set' });
    assert.deepEqual(countView(env.ctx, c.id).lines.map((l) => [l.name, l.systemMilli, l.countedMilli, l.varianceMilli]), [['Jam 500g', 10000, 12000, 2000], ['Salt 1kg', 40000, 35000, -5000]]);
    assert.equal(postCount(env.ctx, env.manager, rid(), c.id).changed, 2);
    assert.deepEqual([onHand(env.ctx, salt), onHand(env.ctx, jam)], [35000, 12000]);
    assert.deepEqual(stockCard(env.ctx, salt)[0]!.kind, 'COUNT');
    assert.throws(() => recordCount(env.ctx, env.manager, rid(), { countId: c.id, itemId: salt, qtyMilli: 1000 }), /already posted/);
    assert.equal(countView(env.ctx, c.id).status, 'POSTED');
    assert.deepEqual(checkStockIntegrity(env.ctx), []);
  } finally { env.cleanup(); }
});
