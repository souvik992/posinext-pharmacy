import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../src/store/db.ts';
import { makeEnv, rid } from './helpers.ts';
import { createItem } from '../src/services/catalog.ts';
import { addOpeningStock } from '../src/services/inventory.ts';
import { batchesWithStock } from '../src/services/products.ts';
import { printLabels, renderLabel, unitPriceText } from '../src/services/printing/labels.ts';
import { makeEan13 } from '../src/core/barcode.ts';

const rice = { name: 'Basmati Rice 1kg', mrp: 12500, price: 11900, barcode: '8901234567890', unitPrice: 'Rs 119.00/kg' };

test('TSPL label, 50x25 mm: name, the full MRP declaration (two lines, never cut), our price, EAN-13 from 12 digits; lower lines give way', () => {
  assert.equal(renderLabel('tspl', { wMm: 50, hMm: 25, gapMm: 2 }, rice), [
    'SIZE 50 mm,25 mm', 'GAP 2 mm,0 mm', 'DIRECTION 1', 'REFERENCE 0,0', 'CODEPAGE 1252', 'CLS',
    'TEXT 16,8,"2",0,1,1,"Basmati Rice 1kg"',
    'TEXT 16,32,"2",0,1,1,"MRP Rs 125.00"',
    'TEXT 16,56,"2",0,1,1,"(Incl. of all taxes)"',
    'TEXT 16,80,"2",0,1,1,"Our price Rs 119.00"',
    'BARCODE 87,108,"EAN13",60,1,0,2,2,"890123456789"',
    'PRINT 1,1', '',
  ].join('\r\n'));
});

test('ZPL label for 38x25 mm with 3 copies; a non-GTIN code prints as Code 128; no rupee sign reaches the printer', () => {
  const z = renderLabel('zpl', { wMm: 38, hMm: 25, gapMm: 2 }, { name: 'Kurta Blue M ₹', mrp: 99900, price: 99900, barcode: 'KUR-BLU-M', batchNo: null, expiry: null }, 3);
  assert.match(z, /^\^XA\n\^PW304\^LL200\^LH0,0\^CI28\n/);
  assert.match(z, /\^FD Kurta Blue M Rs \^FS|\^FDKurta Blue M Rs \^FS/);
  assert.match(z, /\^BCN,\d+,Y,N,N\^FDKUR-BLU-M\^FS/);
  assert.match(z, /\^PQ3\n\^XZ\n$/);
  assert.ok(!/[^\x00-\x7e]/.test(z));
});

test('unit sale price from the pack size in the name (Legal Metrology unit price)', () => {
  assert.equal(unitPriceText('Basmati Rice 5kg', 60000), 'Rs 120.00/kg');
  assert.equal(unitPriceText('Biscuit 250 g', 3000), 'Rs 12.00/100g');
  assert.equal(unitPriceText('Oil 500ml', 9000), 'Rs 18.00/100ml');
  assert.equal(unitPriceText('Soap', 4000), null);
});

test('printing labels: only to a label printer; batch MRP and expiry on the label; one job per item through the print queue', () => {
  const env = makeEnv();
  try {
    const tax = get<{ id: string }>(env.ctx.db, 'SELECT id FROM tax_group WHERE rate_bp = 500')!.id;
    const jam = createItem(env.ctx, env.manager, rid(), { name: 'Mixed Fruit Jam 500g', taxGroupId: tax, price: 16000, mrp: 17000, batchTracked: true, barcode: makeEan13('890765432101') }).id;
    addOpeningStock(env.ctx, env.manager, rid(), [{ itemId: jam, qtyMilli: 5000, batch: { batchNo: 'MJ7', expiryDate: '2027-03-31', mrp: 16500 } }]);
    const batch = batchesWithStock(env.ctx, jam)[0]!.id;
    const printer = get<{ id: string }>(env.ctx.db, 'SELECT id FROM printer LIMIT 1')!.id;
    assert.throws(() => printLabels(env.ctx, env.manager, rid(), { printerId: printer, items: [{ itemId: jam, copies: 1 }] }), /not set up as a label printer/);
    env.ctx.db.exec(`UPDATE printer SET label_lang = 'tspl', label_w_mm = 50, label_h_mm = 38 WHERE id = '${printer}'`);
    const r = printLabels(env.ctx, env.manager, rid(), { printerId: printer, items: [{ itemId: jam, batchId: batch, copies: 12 }] });
    assert.equal(r.jobs, 1);
    const job = get<{ kind: string; payload: Uint8Array }>(env.ctx.db, "SELECT kind, payload FROM print_job WHERE kind = 'LABEL'")!;
    const text = new TextDecoder().decode(job.payload);
    assert.match(text, /MRP Rs 165\.00/, 'the batch MRP, not the item MRP');
    assert.match(text, /B:MJ7 EXP:2027-03-31/);
    assert.match(text, /Rs 32\.00\/100g/);
    assert.match(text, /PRINT 1,12/);
    assert.throws(() => printLabels(env.ctx, env.cashier, rid(), { printerId: printer, items: [{ itemId: jam, copies: 1 }] }), /permission|not allowed/i);
  } finally { env.cleanup(); }
});
