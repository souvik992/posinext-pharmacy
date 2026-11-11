import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, rid } from './helpers.ts';
import type { Env } from './helpers.ts';
import { get, all } from '../src/store/db.ts';
import { createItem, createTaxGroup, itemByBarcode, updateItem } from '../src/services/catalog.ts';
import { addScanCode, batchesWithStock, createBrand, createVariants, lookupScan, pickBatch, removeScanCode, saveScaleProfiles, scaleProfiles } from '../src/services/products.ts';
import { addOpeningStock, adjustStock, checkStockIntegrity, onHand, postMove, setNegativeStock, stockCard, stockList } from '../src/services/inventory.ts';
import { makeEan13 } from '../src/core/barcode.ts';

const taxId = (env: Env, bp: number) => get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = ? AND price_includes_tax = 1', bp)!.id;
const item = (env: Env, name: string, extra: Record<string, unknown> = {}) =>
  createItem(env.ctx, env.manager, rid(), { name, taxGroupId: taxId(env, 500), price: 5000, uqc: 'PCS', ...extra }).id;

test('items carry MRP and are never priced above it (tax-inclusive and tax-exclusive prices)', () => {
  const env = makeEnv();
  try {
    const id = item(env, 'Basmati Rice 1kg', { price: 12000, mrp: 12500, hsnCode: '10063020', uqc: 'PCS', purchasePrice: 9800, reorderLevelMilli: 10000 });
    const row = get<Record<string, unknown>>(env.ctx.db, 'SELECT mrp, uqc, purchase_price, reorder_level_milli FROM item WHERE id = ?', id);
    assert.deepEqual({ ...row }, { mrp: 12500, uqc: 'PCS', purchase_price: 9800, reorder_level_milli: 10000 });
    assert.throws(() => updateItem(env.ctx, env.manager, rid(), id, { price: 13000 }), /above the MRP/);
    // a tax-exclusive price is checked with its tax added: 11000 + 18% = 12980 > 12500
    const excl = createTaxGroup(env.ctx, env.owner, rid(), { name: 'GST 18% excl', rateBp: 1800, priceIncludesTax: false }).id;
    assert.throws(() => createItem(env.ctx, env.manager, rid(), { name: 'Shampoo 200ml', taxGroupId: excl, price: 11000, mrp: 12500 }), /Rs 129\.80.*above the MRP/);
    assert.ok(createItem(env.ctx, env.manager, rid(), { name: 'Shampoo 200ml', taxGroupId: excl, price: 10500, mrp: 12500 }).id); // 12390
    assert.throws(() => item(env, 'Bad unit', { uqc: 'XYZ' }), /UQC/);
  } finally { env.cleanup(); }
});

test('several barcodes per item: EAN, UPC forms of the same GTIN, and a case barcode that adds 12', () => {
  const env = makeEnv();
  try {
    const ean = makeEan13('890765432101'), eanKey = '0' + ean, caseCode = makeEan13('890765432199');
    const id = item(env, 'Cola 300ml Can', { barcode: ean, mrp: 4000, price: 4000 });
    addScanCode(env.ctx, env.manager, rid(), id, { code: '04252614' }); // UPC-E
    addScanCode(env.ctx, env.manager, rid(), id, { code: caseCode, packQtyMilli: 12000 }); // GTIN-14 case
    assert.deepEqual(lookupScan(env.ctx, ean), { found: true, itemId: id, name: 'Cola 300ml Can', qtyMilli: 1000, unitPrice: 4000, mrp: 4000, batchTracked: false, source: 'barcode' });
    assert.equal((lookupScan(env.ctx, '042100005264') as { itemId: string }).itemId, id, 'UPC-A finds the UPC-E code');
    assert.equal((lookupScan(env.ctx, caseCode) as { qtyMilli: number }).qtyMilli, 12000);
    assert.equal(itemByBarcode(env.ctx, eanKey)?.id, id);
    const other = item(env, 'Other');
    assert.throws(() => addScanCode(env.ctx, env.manager, rid(), other, { code: ean }), /Another item already uses/);
    assert.throws(() => createItem(env.ctx, env.manager, rid(), { name: 'Dup', taxGroupId: taxId(env, 500), price: 100, barcode: '042100005264' }), /Another item already uses/);
    removeScanCode(env.ctx, env.manager, rid(), id, ean);
    assert.equal(lookupScan(env.ctx, ean).found, false);
    assert.equal(get<{ barcode: string | null }>(env.ctx.db, 'SELECT barcode FROM item WHERE id = ?', id)!.barcode, null, 'the main barcode goes too');
    assert.deepEqual(lookupScan(env.ctx, 'nope'), { found: false, code: 'nope', reason: 'No item has this barcode.' });
  } finally { env.cleanup(); }
});

test('weighing-scale labels: weight label, price label, misread label, item not set up as weighed', () => {
  const env = makeEnv();
  try {
    const rice = item(env, 'Sona Masoori Loose', { plu: '123', isWeighed: true, price: 6400, uqc: 'KGS' }); // Rs 64/kg
    const w = lookupScan(env.ctx, '2100123012503'); // 1.250 kg
    assert.deepEqual(w, { found: true, itemId: rice, name: 'Sona Masoori Loose', qtyMilli: 1250, unitPrice: 6400, mrp: null, batchTracked: false, source: 'scale', scale: { valueKind: 'weight', value: 1250, amount: null } });
    const p = lookupScan(env.ctx, makeEan13('220012308000')); // Rs 80.00 at Rs 64/kg = 1.250 kg
    assert.equal((p as { qtyMilli: number }).qtyMilli, 1250);
    assert.equal((p as { scale: { amount: number } }).scale.amount, 8000);
    assert.equal(lookupScan(env.ctx, '2100123012504').found, false, 'wrong check digit');
    item(env, 'Packed Sugar', { plu: '124' });
    assert.match((lookupScan(env.ctx, makeEan13('210012401000')) as { reason: string }).reason, /not set up as a weighed item/);
    assert.match((lookupScan(env.ctx, makeEan13('210099901000')) as { reason: string }).reason, /PLU\) 00999/);
    assert.equal((lookupScan(env.ctx, '123') as { source: string }).source, 'plu', 'the PLU typed by hand');
    assert.throws(() => item(env, 'Dup PLU', { plu: '0123' }).length === 0 || item(env, 'Dup PLU 2', { plu: '123' }), /Another item already uses this PLU/);
    // a shop's own layout replaces the defaults
    saveScaleProfiles(env.ctx, env.owner, rid(), [{ id: 'w', name: 'W + item 6 + grams 5', prefixes: ['W'], length: 12, itemStart: 1, itemLen: 6, valueKind: 'weight', valueStart: 7, valueLen: 5, valueDecimals: 3, checkDigit: false }]);
    assert.equal(scaleProfiles(env.ctx).length, 1);
    assert.equal((lookupScan(env.ctx, 'W00012300500') as { qtyMilli: number }).qtyMilli, 500);
    assert.equal(lookupScan(env.ctx, '2100123012503').found, false, 'the default 21 layout is gone');
    assert.throws(() => saveScaleProfiles(env.ctx, env.owner, rid(), [{ id: 'x', name: 'bad', prefixes: ['21'], length: 13, itemStart: 2, itemLen: 5, valueKind: 'weight', valueStart: 5, valueLen: 5, valueDecimals: 3, checkDigit: true }]), /overlap/);
  } finally { env.cleanup(); }
});

test('variants: a size x colour template makes one stocked item each, with SKU, price extra and MRP extra', () => {
  const env = makeEnv();
  try {
    const brand = createBrand(env.ctx, env.manager, rid(), { name: 'Urban Basics' }).id;
    const r = createVariants(env.ctx, env.manager, rid(), {
      name: 'Polo T-shirt', skuPrefix: 'polo',
      attributes: [{ name: 'Colour', values: ['Blue', 'Black'] }, { name: 'Size', values: ['M', 'L', 'XL'] }],
      base: { taxGroupId: taxId(env, 500), price: 49900, mrp: 59900, hsnCode: '61091000', uqc: 'PCS', brandId: brand },
      priceExtra: { Size: { XL: 5000 } },
    });
    assert.equal(r.items.length, 6);
    const xl = all<{ name: string; sku: string; price: number; mrp: number; variant_json: string; template_id: string }>(env.ctx.db, "SELECT name, sku, price, mrp, variant_json, template_id FROM item WHERE name = 'Polo T-shirt Black XL'")[0]!;
    assert.deepEqual({ ...xl, variant_json: JSON.parse(xl.variant_json) }, { name: 'Polo T-shirt Black XL', sku: 'POLO-BLA-XL', price: 54900, mrp: 64900, variant_json: { Colour: 'Black', Size: 'XL' }, template_id: r.templateId });
    assert.throws(() => createVariants(env.ctx, env.manager, rid(), { name: 'X', attributes: [{ name: 'Size', values: [] }], base: { taxGroupId: taxId(env, 500), price: 100 } }), /at least one Size/);
  } finally { env.cleanup(); }
});

test('stock ledger: opening stock, adjustments with reasons, negative stock policy, ledger = balance', () => {
  const env = makeEnv();
  try {
    const soap = item(env, 'Bath Soap 100g', { reorderLevelMilli: 5000 });
    addOpeningStock(env.ctx, env.manager, rid(), [{ itemId: soap, qtyMilli: 6000, unitCost: 3200 }]);
    adjustStock(env.ctx, env.manager, rid(), { itemId: soap, deltaMilli: -2000, reason: 'DAMAGED', note: 'wet cartons' });
    assert.equal(onHand(env.ctx, soap), 4000);
    assert.equal(stockList(env.ctx, { lowOnly: true }).map((s) => s.name).includes('Bath Soap 100g'), true, 'at or below the reorder level');
    assert.throws(() => adjustStock(env.ctx, env.manager, rid(), { itemId: soap, deltaMilli: 1000, reason: 'DAMAGED' }), /removes stock/);
    assert.throws(() => adjustStock(env.ctx, env.cashier, rid(), { itemId: soap, deltaMilli: -1000, reason: 'LOST' }), /permission|not allowed/i);
    // items without batches may go below zero unless the owner blocks it
    adjustStock(env.ctx, env.manager, rid(), { itemId: soap, deltaMilli: -5000, reason: 'CORRECTION' });
    assert.equal(onHand(env.ctx, soap), -1000);
    setNegativeStock(env.ctx, env.owner, rid(), false);
    assert.throws(() => adjustStock(env.ctx, env.manager, rid(), { itemId: soap, deltaMilli: -1000, reason: 'LOST' }), /Only -1 of Bath Soap/);
    assert.deepEqual(stockCard(env.ctx, soap).map((m) => [m.kind, m.deltaMilli]), [['ADJUST', -5000], ['ADJUST', -2000], ['OPENING', 6000]]);
    assert.deepEqual(checkStockIntegrity(env.ctx), []);
    assert.throws(() => env.ctx.db.exec('DELETE FROM item_stock_move'), /immutable/);
  } finally { env.cleanup(); }
});

test('batches: MRP per batch, FEFO when MRPs agree, the cashier chooses when they differ, expired never sold, never negative', () => {
  const env = makeEnv();
  try {
    const biscuit = item(env, 'Marie Biscuit 250g', { batchTracked: true, mrp: 4000, price: 4000 });
    assert.throws(() => addOpeningStock(env.ctx, env.manager, rid(), [{ itemId: biscuit, qtyMilli: 1000 }]), /give the batch number/);
    addOpeningStock(env.ctx, env.manager, rid(), [
      { itemId: biscuit, qtyMilli: 10000, batch: { batchNo: 'b-late', expiryDate: '2027-03-31', mrp: 4000 } },
      { itemId: biscuit, qtyMilli: 5000, batch: { batchNo: 'b-early', expiryDate: '2026-12-31', mrp: 4000 } },
      { itemId: biscuit, qtyMilli: 3000, batch: { batchNo: 'b-old', expiryDate: '2026-10-01', mrp: 4000 } }, // expired (today is 12 Oct 2026)
    ]);
    assert.deepEqual(batchesWithStock(env.ctx, biscuit).map((b) => [b.batchNo, b.expired]), [['B-OLD', true], ['B-EARLY', false], ['B-LATE', false]]);
    const early = batchesWithStock(env.ctx, biscuit).find((b) => b.batchNo === 'B-EARLY')!.id;
    assert.deepEqual(pickBatch(env.ctx, biscuit, 2000), { batchId: early }, 'earliest unexpired expiry first');
    // a new batch at a revised MRP: the cashier picks by the MRP on the pack
    addOpeningStock(env.ctx, env.manager, rid(), [{ itemId: biscuit, qtyMilli: 4000, batch: { batchNo: 'B-NEW', expiryDate: '2027-06-30', mrp: 4500 } }]);
    const pick = pickBatch(env.ctx, biscuit, 1000) as { choose: Array<{ batchNo: string; mrp: number }> };
    assert.deepEqual(pick.choose.map((b) => [b.batchNo, b.mrp]), [['B-EARLY', 4000], ['B-LATE', 4000], ['B-NEW', 4500]]);
    // batch items never go negative, and a move must name its batch
    assert.throws(() => postMove(env.ctx, env.manager, { itemId: biscuit, batchId: early, deltaMilli: -6000, kind: 'SALE' }), /Only 5 of Marie Biscuit 250g in this batch/);
    assert.throws(() => postMove(env.ctx, env.manager, { itemId: biscuit, deltaMilli: -1, kind: 'SALE' }), /choose the batch/);
    // a batch keeps its number, item and MRP
    assert.throws(() => env.ctx.db.exec(`UPDATE batch SET mrp = 1 WHERE id = '${early}'`), /keeps its item, number and MRP/);
    assert.throws(() => addOpeningStock(env.ctx, env.manager, rid(), [{ itemId: biscuit, qtyMilli: 1000, batch: { batchNo: 'B-EARLY', expiryDate: '2027-01-31', mrp: 4000 } }]), /already in stock with expiry 2026-12-31/);
    assert.throws(() => updateItem(env.ctx, env.manager, rid(), biscuit, { batchTracked: false }), /still has stock in batches/);
    assert.deepEqual(checkStockIntegrity(env.ctx), []);
  } finally { env.cleanup(); }
});
