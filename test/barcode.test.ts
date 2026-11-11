import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCALE_PROFILES, barcodeKey, classifyScan, expandUpcE, gs1CheckDigit, gtin14, isValidGtin, makeEan13,
  readScaleBarcode, validateScaleProfile,
} from '../src/core/barcode.ts';
import type { ScaleProfile } from '../src/core/barcode.ts';

test('GS1 check digits: EAN-13, UPC-A, EAN-8 (published examples)', () => {
  assert.equal(gs1CheckDigit('890123456789'), 0); // Indian prefix 890
  assert.equal(gs1CheckDigit('400638133393'), 1); // GS1's own example 4006381333931
  assert.equal(gs1CheckDigit('03600029145'), 2); // UPC-A 036000291452
  assert.equal(gs1CheckDigit('9638507'), 4); // EAN-8 96385074
  assert.ok(isValidGtin('8901234567890'));
  assert.ok(isValidGtin('4006381333931'));
  assert.ok(isValidGtin('036000291452'));
  assert.ok(isValidGtin('96385074'));
  assert.ok(!isValidGtin('4006381333932'));
  assert.ok(!isValidGtin('12345'));
  assert.equal(makeEan13('290000001234'), '2900000012349');
});

test('UPC-E expands to UPC-A; every GTIN is looked up as 14 digits', () => {
  assert.equal(expandUpcE('04252614'), '042100005264');
  assert.equal(gtin14('04252614'), '00042100005264');
  assert.equal(gtin14('042100005264'), '00042100005264');
  assert.equal(gtin14('8901234567890'), '08901234567890');
  assert.equal(gtin14('96385074'), '00000096385074'); // EAN-8 stays EAN-8
  assert.equal(gtin14('8901234567891'), null); // wrong check digit
  // stored and scanned forms meet on the same key
  assert.equal(barcodeKey('042100005264'), barcodeKey('04252614'));
  assert.equal(barcodeKey(' tsh-blu-m '), 'TSH-BLU-M');
});

test('scale barcodes: default weight and price layouts', () => {
  assert.deepEqual(readScaleBarcode('2100123012503', DEFAULT_SCALE_PROFILES), { profileId: 'gs1-21-weight', itemCode: '00123', valueKind: 'weight', value: 1250 });
  const price = makeEan13('220012304550'); // item 00123, Rs 45.50
  assert.deepEqual(readScaleBarcode(price, DEFAULT_SCALE_PROFILES), { profileId: 'gs1-22-price', itemCode: '00123', valueKind: 'price', value: 4550 });
  assert.equal(readScaleBarcode('2100123012504', DEFAULT_SCALE_PROFILES), null, 'a misread label is refused, never billed');
  assert.equal(readScaleBarcode('8901234567890', DEFAULT_SCALE_PROFILES), null);
});

test('scale barcodes: a GoFrugal-style Code 128 layout (letter prefix, no check digit) and Zoho-style 2-decimal weight', () => {
  const gofrugal: ScaleProfile = { id: 'w', name: 'W + item 6 + grams 5', prefixes: ['W'], length: 12, itemStart: 1, itemLen: 6, valueKind: 'weight', valueStart: 7, valueLen: 5, valueDecimals: 3, checkDigit: false };
  assert.deepEqual(validateScaleProfile(gofrugal), []);
  assert.deepEqual(readScaleBarcode('W00319801500', [gofrugal]), { profileId: 'w', itemCode: '003198', valueKind: 'weight', value: 1500 });
  const zoho: ScaleProfile = { id: 'z', name: 'W12 + SKU 5 + kg 4 (2 decimals)', prefixes: ['W12'], length: 12, itemStart: 3, itemLen: 5, valueKind: 'weight', valueStart: 8, valueLen: 4, valueDecimals: 2, checkDigit: false };
  assert.deepEqual(readScaleBarcode('W12123450200', [zoho])?.value, 2000); // 2.00 kg
});

test('scale profile checks: overlap, out of range, decimals', () => {
  const ok = DEFAULT_SCALE_PROFILES[0]!;
  assert.deepEqual(validateScaleProfile(ok), []);
  assert.match(validateScaleProfile({ ...ok, valueStart: 5 }).join(' '), /overlap/);
  assert.match(validateScaleProfile({ ...ok, valueLen: 7 }).join(' '), /does not fit/);
  assert.match(validateScaleProfile({ ...ok, valueKind: 'price', valueDecimals: 3 }).join(' '), /Decimals must be 0 to 2/);
  assert.match(validateScaleProfile({ ...ok, prefixes: [] }).join(' '), /prefix/);
});

test('a scan is a scale label, a GTIN or a plain code, in that order', () => {
  assert.equal(classifyScan('2100123012503', DEFAULT_SCALE_PROFILES).kind, 'scale');
  assert.deepEqual(classifyScan('8901234567890', DEFAULT_SCALE_PROFILES), { kind: 'gtin', key: '08901234567890' });
  assert.deepEqual(classifyScan('tsh-blu-m', DEFAULT_SCALE_PROFILES), { kind: 'code', key: 'TSH-BLU-M' });
  assert.deepEqual(classifyScan('8901234567891', DEFAULT_SCALE_PROFILES), { kind: 'code', key: '8901234567891' }); // bad check: looked up as typed
  // a 2x code with no profile for its prefix is an in-store GTIN
  assert.deepEqual(classifyScan('2900000012349', DEFAULT_SCALE_PROFILES), { kind: 'gtin', key: '02900000012349' });
});
