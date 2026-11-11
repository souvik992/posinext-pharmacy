import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../src/store/db.ts';
import { makeEnv, rid } from './helpers.ts';
import { importItemsCsv, previewItemsCsv } from '../src/services/catalog.ts';
import { onHand, checkStockIntegrity } from '../src/services/inventory.ts';
import { batchesWithStock, lookupScan } from '../src/services/products.ts';
import { setSetting } from '../src/services/settings.ts';
import { makeEan13 } from '../src/core/barcode.ts';

const head = 'name,category,price,tax_percent,hsn,barcode,unit,mrp,uqc,plu,weighed,batch,purchase_price,opening_stock,reorder_level,batch_no,expiry\n';

test('retail import: MRP, UQC, PLU, weighed and batch items, opening stock with its batch; price above MRP refused; HSN warnings', () => {
  const env = makeEnv();
  try {
    const csv = head +
      'Sugar 1kg,Staples,48,5,17011490,8907654321014,pcs,50,,,,,42,40,10,,\n' +
      'Toor Dal Loose,Staples,140,0,07136000,,kg,,KGS,301,yes,,120,25.5,,,\n' +
      'Cheese Slices 200g,Dairy,135,5,04069000,,pcs,140,PCS,,,yes,118,12,,CS71,31-12-2026\n' +
      'Masala Mix,Spices,60,5,,,,,,,,,,,,,\n' +
      'Sugar Free,Staples,90,18,17011490,,,,,,,,,,,,\n';
    const p = previewItemsCsv(env.ctx, csv);
    assert.deepEqual(p.errors, []);
    assert.deepEqual(p.warnings!.map((w) => w.row), [5, 6], 'no HSN on a registered shop; HSN 17011490 with 18% here but 5% on row 2');
    assert.deepEqual(p.items.map((i) => i.uqc), ['PCS', 'KGS', 'PCS', 'PCS', 'PCS']);
    const r = importItemsCsv(env.ctx, env.manager, rid(), csv);
    assert.equal(r.imported, 5);
    const sugar = get<{ id: string; mrp: number; reorder_level_milli: number }>(env.ctx.db, "SELECT id, mrp, reorder_level_milli FROM item WHERE name = 'Sugar 1kg'")!;
    assert.deepEqual([sugar.mrp, sugar.reorder_level_milli, onHand(env.ctx, sugar.id)], [5000, 10000, 40000]);
    assert.equal((lookupScan(env.ctx, '8907654321014') as { itemId: string }).itemId, sugar.id, 'the barcode is scannable');
    const dal = get<{ id: string }>(env.ctx.db, "SELECT id FROM item WHERE name = 'Toor Dal Loose'")!.id;
    assert.equal(onHand(env.ctx, dal), 25500);
    assert.equal((lookupScan(env.ctx, makeEan13('210030101250')) as { qtyMilli: number }).qtyMilli, 1250, 'weighed item reads scale labels by PLU');
    const cheese = get<{ id: string }>(env.ctx.db, "SELECT id FROM item WHERE name = 'Cheese Slices 200g'")!.id;
    assert.deepEqual(batchesWithStock(env.ctx, cheese).map((b) => [b.batchNo, b.expiryDate, b.mrp, b.qtyMilli]), [['CS71', '2026-12-31', 14000, 12000]]);
    assert.deepEqual(checkStockIntegrity(env.ctx), []);

    const bad = previewItemsCsv(env.ctx, head + 'Overpriced,X,60,5,1234,,,50,,,,,,,,,\nBatchless,X,10,5,1234,,,,,,,yes,,5,,,\nBad Unit,X,10,5,1234,,,,XYZ,,,,,,,,\n');
    assert.deepEqual(bad.errors.map((e) => e.message.replace(/ \(.*/, '')), ['price 60 is above the MRP 50', 'opening_stock for a batch item needs batch_no', 'uqc "XYZ" is not a GST unit code']);
    setSetting(env.ctx, 'hsn_digits', '6');
    assert.match(previewItemsCsv(env.ctx, head + 'Six,X,10,5,1234,,,,,,,,,,,,\n').errors[0]!.message, /at least 6 digits/);
  } finally { env.cleanup(); }
});
