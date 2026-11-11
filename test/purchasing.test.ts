import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, rid } from './helpers.ts';
import type { Env } from './helpers.ts';
import { get, all } from '../src/store/db.ts';
import { createItem } from '../src/services/catalog.ts';
import { batchesWithStock } from '../src/services/products.ts';
import { checkStockIntegrity, onHand } from '../src/services/inventory.ts';
import { gstinCheckChar } from '../src/core/gstin.ts';
import { createSupplier, getGrn, listSuppliers, paySupplier, postGrn, postPurchaseReturn, supplierStatement, voidGrn } from '../src/services/purchasing.ts';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const taxId = (env: Env, bp: number) => get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = ? AND price_includes_tax = 1', bp)!.id;

function setup() {
  const env = makeEnv();
  const oil = createItem(env.ctx, env.manager, rid(), { name: 'Sunflower Oil 1L', taxGroupId: taxId(env, 500), price: 15500, mrp: 16000, uqc: 'LTR' }).id;
  const tea = createItem(env.ctx, env.manager, rid(), { name: 'Tea 250g', taxGroupId: taxId(env, 500), price: 14000, mrp: 15000, batchTracked: true }).id;
  const local = createSupplier(env.ctx, env.manager, rid(), { name: 'Sri Ganesh Traders', gstin: gstin('29ABCDE1234F1Z'), mobile: '9845012345' }).id; // same state (29)
  const outOfState = createSupplier(env.ctx, env.manager, rid(), { name: 'Chennai Distributors', stateCode: '33' }).id;
  return { env, oil, tea, local, outOfState };
}

test('GRN: stock in at landed cost (free quantity), batches with expiry and MRP, totals, supplier owed the bill', () => {
  const { env, oil, tea, local } = setup();
  try {
    const g = postGrn(env.ctx, env.manager, rid(), {
      supplierId: local, billNo: 'SGT/1182', billDate: '2026-10-10',
      lines: [
        { itemId: oil, qtyMilli: 10000, freeQtyMilli: 2000, unitCost: 13000, discount: 1000 }, // 10 x 130 - 10 = 1290 taxable, 12 in stock
        { itemId: tea, qtyMilli: 20000, unitCost: 11000, batch: { batchNo: 'T2610', expiryDate: '2027-04-30' }, mrp: 15000, salePrice: 14500 },
      ],
    });
    assert.equal(g.grnNo, 'GRN/26-27/000001');
    assert.equal(g.interState, false);
    // 129000 + 6450 (5%) + 220000 + 11000 = 366450 -> rounded to the rupee 366500
    assert.deepEqual([g.taxableTotal, g.taxTotal, g.total], [349000, 17450, 366500]);
    assert.equal(onHand(env.ctx, oil), 12000);
    assert.equal(get<{ purchase_price: number }>(env.ctx.db, 'SELECT purchase_price FROM item WHERE id = ?', oil)!.purchase_price, 10750, 'landed cost 1290 / 12');
    const b = batchesWithStock(env.ctx, tea)[0]!;
    assert.deepEqual([b.batchNo, b.expiryDate, b.mrp, b.salePrice, b.qtyMilli], ['T2610', '2027-04-30', 15000, 14500, 20000]);
    assert.equal(listSuppliers(env.ctx).find((s) => s.id === local)!.balance, 366500);
    assert.equal(getGrn(env.ctx, g.id).lines.length, 2);
    // the same supplier bill cannot be entered twice
    assert.throws(() => postGrn(env.ctx, env.manager, rid(), { supplierId: local, billNo: 'sgt/1182', lines: [{ itemId: oil, qtyMilli: 1000, unitCost: 13000 }] }), /already entered/);
    assert.throws(() => postGrn(env.ctx, env.manager, rid(), { supplierId: local, lines: [{ itemId: tea, qtyMilli: 1000, unitCost: 1 }] }), /give the batch number/);
    assert.throws(() => postGrn(env.ctx, env.cashier, rid(), { supplierId: local, lines: [{ itemId: oil, qtyMilli: 1000, unitCost: 1 }] }), /permission|not allowed/i);
    assert.deepEqual(checkStockIntegrity(env.ctx), []);
  } finally { env.cleanup(); }
});

test('GRN updates the item price and MRP (no batches); a new price above the new MRP is refused', () => {
  const { env, oil, local } = setup();
  try {
    postGrn(env.ctx, env.manager, rid(), { supplierId: local, lines: [{ itemId: oil, qtyMilli: 5000, unitCost: 14000, mrp: 17000, salePrice: 16500 }] });
    assert.deepEqual({ ...get<{ price: number; mrp: number }>(env.ctx.db, 'SELECT price, mrp FROM item WHERE id = ?', oil) }, { price: 16500, mrp: 17000 });
    assert.throws(() => postGrn(env.ctx, env.manager, rid(), { supplierId: local, lines: [{ itemId: oil, qtyMilli: 1000, unitCost: 14000, mrp: 16000 }] }), /above the new MRP/);
    assert.throws(() => postGrn(env.ctx, env.manager, rid(), { supplierId: local, lines: [{ itemId: oil, qtyMilli: 1000, unitCost: 14000, mrp: 16000, salePrice: 16200 }] }), /above the MRP/);
  } finally { env.cleanup(); }
});

test('out-of-state supplier is an inter-state purchase (IGST); void takes the stock back out and the bill off the ledger', () => {
  const { env, oil, outOfState } = setup();
  try {
    const g = postGrn(env.ctx, env.manager, rid(), { supplierId: outOfState, billNo: 'CD-77', lines: [{ itemId: oil, qtyMilli: 4000, unitCost: 12000 }] });
    assert.equal(g.interState, true);
    voidGrn(env.ctx, env.manager, rid(), g.id, 'entered for the wrong shop');
    assert.equal(onHand(env.ctx, oil), 0);
    assert.equal(listSuppliers(env.ctx).find((s) => s.id === outOfState)!.balance, 0);
    assert.throws(() => voidGrn(env.ctx, env.manager, rid(), g.id, 'again'), /already voided/);
    // the bill number is free again after a void
    assert.ok(postGrn(env.ctx, env.manager, rid(), { supplierId: outOfState, billNo: 'CD-77', lines: [{ itemId: oil, qtyMilli: 4000, unitCost: 12000 }] }).id);
    assert.throws(() => env.ctx.db.exec(`UPDATE grn SET total = 1 WHERE id = '${g.id}'`), /fixed/);
  } finally { env.cleanup(); }
});

test('purchase return (debit note) at the batch cost, supplier payment, statement with running balance', () => {
  const { env, tea, local } = setup();
  try {
    const g = postGrn(env.ctx, env.manager, rid(), { supplierId: local, roundToRupee: false, lines: [{ itemId: tea, qtyMilli: 10000, unitCost: 11000, discount: 10000, batch: { batchNo: 'T1', expiryDate: '2027-01-31' } }] });
    const batch = batchesWithStock(env.ctx, tea)[0]!.id;
    // net cost per unit = 110 - (100 discount / 10 units) = 100; 2 units back: 200 + 5% = 210.00
    const dn = postPurchaseReturn(env.ctx, env.manager, rid(), { supplierId: local, grnId: g.id, reason: 'Damaged packs', lines: [{ itemId: tea, batchId: batch, qtyMilli: 2000 }] });
    assert.equal(dn.docNo, 'DN/26-27/000001');
    assert.equal(dn.total, 21000);
    assert.equal(onHand(env.ctx, tea), 8000);
    assert.throws(() => postPurchaseReturn(env.ctx, env.manager, rid(), { supplierId: local, reason: 'too many', lines: [{ itemId: tea, batchId: batch, qtyMilli: 9000 }] }), /Only 8 of Tea 250g in this batch/);
    paySupplier(env.ctx, env.manager, rid(), { supplierId: local, amount: 50000, mode: 'UPI', reference: 'UTR 4411' });
    const st = supplierStatement(env.ctx, local);
    assert.deepEqual(st.map((r) => [r.kind, r.amount, r.balance]), [['BILL', 105000, 105000], ['RETURN', -21000, 84000], ['PAYMENT', -50000, 34000]]);
    assert.deepEqual(all(env.ctx.db, 'SELECT kind FROM item_stock_move WHERE item_id = ? ORDER BY seq', tea).map((r) => (r as { kind: string }).kind), ['PURCHASE', 'PURCHASE_RETURN']);
    assert.deepEqual(checkStockIntegrity(env.ctx), []);
  } finally { env.cleanup(); }
});

test('suppliers: GSTIN checked, state from GSTIN, names unique', () => {
  const { env } = setup();
  try {
    assert.throws(() => createSupplier(env.ctx, env.manager, rid(), { name: 'Bad', gstin: '29ABCDE1234F1Z' + (gstinCheckChar('29ABCDE1234F1Z') === 'A' ? 'B' : 'A') }), /check|GSTIN/i);
    assert.throws(() => createSupplier(env.ctx, env.manager, rid(), { name: 'sri ganesh traders' }), /already exists/);
    const id = createSupplier(env.ctx, env.manager, rid(), { name: 'Mumbai Wholesale', gstin: gstin('27AAPFU0939F1Z'), openingBalance: 120000 }).id;
    const s = listSuppliers(env.ctx).find((x) => x.id === id)!;
    assert.deepEqual([s.stateCode, s.balance], ['27', 120000]);
  } finally { env.cleanup(); }
});
