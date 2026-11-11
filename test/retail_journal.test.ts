import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, all } from '../src/store/db.ts';
import { createCtx, silentLogger } from '../src/services/ctx.ts';
import { runBackup } from '../src/services/backup.ts';
import { performRestore } from '../src/services/restore.ts';
import { createItem } from '../src/services/catalog.ts';
import { addOpeningStock, adjustStock, checkStockIntegrity, onHand } from '../src/services/inventory.ts';
import { createSupplier, listSuppliers, postGrn, postPurchaseReturn, voidGrn } from '../src/services/purchasing.ts';
import { batchesWithStock } from '../src/services/products.ts';
import { makeEnv, rid } from './helpers.ts';

test('restore + journal replay brings back retail work done after the backup: GRNs (and a void), batches, returns, adjustments, ledgers, document numbers', async () => {
  const env = makeEnv();
  try {
    const tax = get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = 500')!.id;
    const rice = createItem(env.ctx, env.manager, rid(), { name: 'Rice 5kg', taxGroupId: tax, price: 40000, mrp: 42000 }).id;
    const tea = createItem(env.ctx, env.manager, rid(), { name: 'Tea 500g', taxGroupId: tax, price: 25000, mrp: 26000, batchTracked: true }).id;
    const sup = createSupplier(env.ctx, env.manager, rid(), { name: 'Local Traders', stateCode: '29' }).id;
    addOpeningStock(env.ctx, env.manager, rid(), [{ itemId: rice, qtyMilli: 5000, unitCost: 35000 }]);
    const b = await runBackup(env.ctx, 'manual'); // items, supplier and opening stock are in the backup

    // after the backup: only in the journal
    const g1 = postGrn(env.ctx, env.manager, rid(), { supplierId: sup, billNo: 'LT-1', lines: [{ itemId: rice, qtyMilli: 10000, unitCost: 35000 }, { itemId: tea, qtyMilli: 6000, unitCost: 20000, batch: { batchNo: 'TX1', expiryDate: '2027-02-28' } }] });
    const g2 = postGrn(env.ctx, env.manager, rid(), { supplierId: sup, billNo: 'LT-2', lines: [{ itemId: rice, qtyMilli: 2000, unitCost: 35000 }] });
    voidGrn(env.ctx, env.manager, rid(), g2.id, 'duplicate entry');
    const batch = batchesWithStock(env.ctx, tea)[0]!.id;
    postPurchaseReturn(env.ctx, env.manager, rid(), { supplierId: sup, reason: 'Torn packs', lines: [{ itemId: tea, batchId: batch, qtyMilli: 1000 }] });
    adjustStock(env.ctx, env.manager, rid(), { itemId: rice, deltaMilli: -1000, reason: 'DAMAGED' });
    const before = { rice: onHand(env.ctx, rice), tea: onHand(env.ctx, tea), owed: listSuppliers(env.ctx).find((s) => s.id === sup)!.balance };
    assert.deepEqual(before, { rice: 14000, tea: 5000, owed: listSuppliers(env.ctx).find((s) => s.id === sup)!.balance });

    env.ctx.db.close();
    const r = performRestore(env.dir, b.file);
    assert.ok(r.journal.replayed > 0);
    const ctx = createCtx({ dataDir: env.dir, logger: silentLogger, scryptCost: 1024 });
    try {
      assert.deepEqual({ rice: onHand(ctx, rice), tea: onHand(ctx, tea), owed: listSuppliers(ctx).find((s) => s.id === sup)!.balance }, before, 'stock and what is owed are back');
      assert.equal(get<{ status: string }>(ctx.db, 'SELECT status FROM grn WHERE id = ?', g2.id)!.status, 'VOIDED');
      assert.equal(get<{ grn_no: string }>(ctx.db, 'SELECT grn_no FROM grn WHERE id = ?', g1.id)!.grn_no, 'GRN/26-27/000001');
      assert.equal(batchesWithStock(ctx, tea)[0]!.batchNo, 'TX1');
      assert.deepEqual(checkStockIntegrity(ctx), []);
      // the next numbers continue after the replayed ones (never reused)
      assert.deepEqual(all(ctx.db, 'SELECT kind, last FROM doc_counter ORDER BY kind').map((x) => ({ ...(x as object) })), [{ kind: 'DN', last: 1 }, { kind: 'GRN', last: 2 }]);
    } finally { ctx.db.close(); }
  } finally { env.cleanup(); }
});

test('a sale after the backup comes back whole on restore: the bill, its batch stock movement and the khata due', async () => {
  const env = makeEnv();
  try {
    const { openShift } = await import('../src/services/shifts.ts');
    const { createOrder, addLine } = await import('../src/services/orders.ts');
    const { finalizeInvoice } = await import('../src/services/invoices.ts');
    const { saveCustomer, setOrderCustomer, customerDue } = await import('../src/services/customers.ts');
    openShift(env.ctx, env.cashier, rid(), { openingCash: 0 });
    const tax = get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = 500')!.id;
    const ghee = createItem(env.ctx, env.manager, rid(), { name: 'Ghee 500ml', taxGroupId: tax, price: 30000, mrp: 32000, batchTracked: true }).id;
    addOpeningStock(env.ctx, env.manager, rid(), [{ itemId: ghee, qtyMilli: 10000, batch: { batchNo: 'G1', expiryDate: '2027-06-30', mrp: 32000 } }]);
    const cust = saveCustomer(env.ctx, env.manager, rid(), { mobile: '9876500001', name: 'Ravi' });
    const b = await runBackup(env.ctx, 'manual');

    const o = createOrder(env.ctx, env.cashier, rid()).order.id;
    const c = addLine(env.ctx, env.cashier, rid(), { orderId: o, itemId: ghee, qtyMilli: 2000 });
    setOrderCustomer(env.ctx, env.cashier, rid(), { orderId: o, customerId: cust.id });
    finalizeInvoice(env.ctx, env.cashier, rid(), { orderId: o, payments: [{ mode: 'CREDIT', amount: c.totals.grandTotal }] });
    const due = customerDue(env.ctx, cust.id);
    assert.equal(due, 60000);

    env.ctx.db.close();
    performRestore(env.dir, b.file);
    const ctx = createCtx({ dataDir: env.dir, logger: silentLogger, scryptCost: 1024 });
    try {
      assert.equal(onHand(ctx, ghee), 8000, 'the batch stock sold is out again');
      assert.equal(customerDue(ctx, cust.id), 60000, 'the khata due is back');
      assert.equal(get<{ batch_id: string | null }>(ctx.db, 'SELECT batch_id FROM invoice_line WHERE item_id = ?', ghee)!.batch_id !== null, true, 'the bill line keeps its batch');
      assert.deepEqual(checkStockIntegrity(ctx), []);
    } finally { ctx.db.close(); }
  } finally { env.cleanup(); }
});
