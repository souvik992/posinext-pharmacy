// HTTP routes for the retail modules (products, stock, purchasing, customers and khata, scanning, stock take,
// GSTR-1, labels). Same rules as server.ts: every write is a command with a requestId; services check permissions
// for writes, routes check them for reads.
import { AppError } from '../store/db.ts';
import { assertPerm } from '../services/permissions.ts';
import type { RC, Route } from './server.ts';
import type { V } from './validate.ts';
import { arr, bool, int, nullable, obj, oneOf, opt, override, str } from './validate.ts';
import { addScanCode, batchesWithStock, createBrand, createVariants, listBrands, listScanCodes, lookupScan, removeScanCode, saveScaleProfiles, scaleProfiles } from '../services/products.ts';
import type { ScaleProfile } from '../core/barcode.ts';
import { ADJUST_REASONS, addOpeningStock, adjustStock, countView, postCount, recordCount, setNegativeStock, startCount, stockCard, stockList, negativeStockAllowed } from '../services/inventory.ts';
import type { AdjustReason } from '../services/inventory.ts';
import { createSupplier, getGrn, listGrns, listSuppliers, paySupplier, postGrn, postPurchaseReturn, supplierStatement, updateSupplier, voidGrn } from '../services/purchasing.ts';
import { collectDue, customerStatement, customerView, findCustomer, listCustomers, saveCustomer, setOrderCustomer } from '../services/customers.ts';
import { addScan } from '../services/orders.ts';
import { gstr1, gstr1Csv } from '../services/gstr1.ts';
import { printLabels } from '../services/printing/labels.ts';

type Add = (method: string, path: string, o: { auth?: boolean; idem?: boolean; format?: Route['format'] }, handler: (c: RC) => unknown) => void;
type Body = <T>(c: RC, v: V<T>) => T;

/** Shapes the services check field by field themselves (variants' base item, scale layouts, GRN lines). */
const anyObj: V<Record<string, unknown>> = (v, p) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AppError('VALIDATION', `${p || 'body'} must be an object.`);
  return v as Record<string, unknown>;
};
const id = str({ min: 1, max: 64 });
const qty = int({ min: 1, max: 100_000_000 });
const money = int({ min: 0, max: 1_000_000_000 });
const date = opt(nullable(str({ max: 10 })));
const batchIn = obj({ batchNo: str({ min: 1, max: 30 }), mfgDate: date, expiryDate: date, mrp: opt(nullable(money)), salePrice: opt(nullable(money)), cost: opt(nullable(money)) });

export function addRetailRoutes(add: Add, body: Body, rid: (c: RC) => string): void {
  // ---- products
  add('GET', '/api/brands', {}, (c) => { assertPerm(c.actor, 'catalog.read'); return listBrands(c.ctx); });
  add('POST', '/api/brands', {}, (c) => createBrand(c.ctx, c.actor, rid(c), body(c, obj({ name: str({ min: 1, max: 60 }) }))));
  add('GET', '/api/items/:id/codes', {}, (c) => { assertPerm(c.actor, 'catalog.read'); return listScanCodes(c.ctx, c.params.id!); });
  add('POST', '/api/items/:id/codes', {}, (c) => addScanCode(c.ctx, c.actor, rid(c), c.params.id!, body(c, obj({ code: str({ min: 1, max: 40 }), packQtyMilli: opt(qty) }))));
  add('DELETE', '/api/items/:id/codes/:code', {}, (c) => removeScanCode(c.ctx, c.actor, rid(c), c.params.id!, decodeURIComponent(c.params.code!)));
  add('POST', '/api/variants', {}, (c) => {
    const b = body(c, obj({ name: str({ min: 1, max: 80 }), attributes: arr(obj({ name: str({ min: 1, max: 20 }), values: arr(str({ min: 1, max: 20 }), { max: 50 }) }), { max: 3 }), base: anyObj, priceExtra: opt(anyObj), skuPrefix: opt(nullable(str({ max: 12 }))) }));
    return createVariants(c.ctx, c.actor, rid(c), b as unknown as Parameters<typeof createVariants>[3]);
  });
  add('GET', '/api/items/:id/batches', {}, (c) => { assertPerm(c.actor, 'catalog.read'); return batchesWithStock(c.ctx, c.params.id!); });
  add('GET', '/api/scan', {}, (c) => { assertPerm(c.actor, 'catalog.read'); return lookupScan(c.ctx, c.query.get('code') ?? ''); });
  add('GET', '/api/scale-profiles', {}, (c) => { assertPerm(c.actor, 'catalog.read'); return scaleProfiles(c.ctx); });
  add('PUT', '/api/scale-profiles', {}, (c) => saveScaleProfiles(c.ctx, c.actor, rid(c), body(c, obj({ profiles: arr(anyObj, { max: 10 }) })).profiles as unknown as ScaleProfile[]));

  // ---- counter
  add('POST', '/api/orders/:id/scan', {}, (c) => addScan(c.ctx, c.actor, rid(c), { orderId: c.params.id!, ...body(c, obj({ code: str({ min: 1, max: 60 }), multiplier: opt(int({ min: 1, max: 999 })), batchId: opt(nullable(id)) })) }));
  add('PUT', '/api/orders/:id/customer', {}, (c) => setOrderCustomer(c.ctx, c.actor, rid(c), { orderId: c.params.id!, ...body(c, obj({ customerId: nullable(id) })) }));

  // ---- stock
  add('GET', '/api/inventory', {}, (c) => { assertPerm(c.actor, 'stock.read'); return { items: stockList(c.ctx, { lowOnly: c.query.get('low') === '1', q: c.query.get('q') ?? undefined }), negativeAllowed: negativeStockAllowed(c.ctx), reasons: ADJUST_REASONS }; });
  add('GET', '/api/inventory/:id/card', {}, (c) => { assertPerm(c.actor, 'stock.read'); return stockCard(c.ctx, c.params.id!); });
  add('POST', '/api/inventory/opening', {}, (c) => addOpeningStock(c.ctx, c.actor, rid(c), body(c, obj({ lines: arr(obj({ itemId: id, qtyMilli: qty, unitCost: opt(nullable(money)), batch: opt(nullable(batchIn)) }), { max: 5000 }) })).lines));
  add('POST', '/api/inventory/adjust', {}, (c) => adjustStock(c.ctx, c.actor, rid(c), body(c, obj({ itemId: id, batchId: opt(nullable(id)), deltaMilli: int({ min: -100_000_000, max: 100_000_000 }), reason: oneOf(...(Object.keys(ADJUST_REASONS) as AdjustReason[])), note: opt(nullable(str({ max: 200 }))) }))));
  add('PUT', '/api/inventory/negative-policy', {}, (c) => setNegativeStock(c.ctx, c.actor, rid(c), body(c, obj({ allow: bool })).allow));
  add('POST', '/api/counts', {}, (c) => startCount(c.ctx, c.actor, rid(c), body(c, obj({ name: str({ min: 1, max: 60 }) }))));
  add('GET', '/api/counts/:id', {}, (c) => { assertPerm(c.actor, 'stock.read'); return countView(c.ctx, c.params.id!); });
  add('POST', '/api/counts/:id/lines', {}, (c) => recordCount(c.ctx, c.actor, rid(c), { countId: c.params.id!, ...body(c, obj({ itemId: id, batchId: opt(nullable(id)), qtyMilli: int({ min: 0, max: 100_000_000 }), mode: opt(oneOf('add', 'set')) })) }));
  add('POST', '/api/counts/:id/post', {}, (c) => postCount(c.ctx, c.actor, rid(c), c.params.id!));

  // ---- purchasing
  const supplierIn = { name: str({ min: 1, max: 80 }), gstin: opt(nullable(str({ max: 15 }))), mobile: opt(nullable(str({ max: 15 }))), stateCode: opt(nullable(str({ max: 2 }))), address: opt(nullable(str({ max: 300 }))) };
  add('GET', '/api/suppliers', {}, (c) => { assertPerm(c.actor, 'stock.read'); return listSuppliers(c.ctx); });
  add('POST', '/api/suppliers', {}, (c) => createSupplier(c.ctx, c.actor, rid(c), body(c, obj({ ...supplierIn, openingBalance: opt(int({ min: -1_000_000_000, max: 1_000_000_000 })) }))));
  add('PATCH', '/api/suppliers/:id', {}, (c) => updateSupplier(c.ctx, c.actor, rid(c), c.params.id!, body(c, obj(supplierIn))));
  add('GET', '/api/suppliers/:id/statement', {}, (c) => { assertPerm(c.actor, 'stock.read'); return supplierStatement(c.ctx, c.params.id!); });
  add('POST', '/api/suppliers/:id/payments', {}, (c) => paySupplier(c.ctx, c.actor, rid(c), { supplierId: c.params.id!, ...body(c, obj({ amount: int({ min: 1 }), mode: oneOf('CASH', 'UPI', 'BANK', 'CHEQUE', 'CARD'), reference: opt(nullable(str({ max: 60 }))) })) }));
  add('GET', '/api/grns', {}, (c) => { assertPerm(c.actor, 'stock.read'); return listGrns(c.ctx, { supplierId: c.query.get('supplier') ?? undefined }); });
  add('GET', '/api/grns/:id', {}, (c) => { assertPerm(c.actor, 'stock.read'); return getGrn(c.ctx, c.params.id!); });
  add('POST', '/api/grns', {}, (c) => postGrn(c.ctx, c.actor, rid(c), body(c, obj({
    supplierId: id, billNo: opt(nullable(str({ max: 30 }))), billDate: date, otherCharges: opt(money), note: opt(nullable(str({ max: 200 }))), roundToRupee: opt(bool),
    lines: arr(obj({ itemId: id, qtyMilli: qty, freeQtyMilli: opt(int({ min: 0, max: 100_000_000 })), unitCost: money, discount: opt(money), rateBp: opt(int({ min: 0, max: 10000 })),
      batch: opt(nullable(obj({ batchNo: str({ min: 1, max: 30 }), mfgDate: date, expiryDate: date }))), mrp: opt(nullable(money)), salePrice: opt(nullable(money)) }), { max: 500 }),
  }))));
  add('POST', '/api/grns/:id/void', {}, (c) => voidGrn(c.ctx, c.actor, rid(c), c.params.id!, body(c, obj({ reason: str({ min: 1, max: 200 }) })).reason));
  add('POST', '/api/purchase-returns', {}, (c) => postPurchaseReturn(c.ctx, c.actor, rid(c), body(c, obj({
    supplierId: id, grnId: opt(nullable(id)), reason: str({ min: 1, max: 200 }),
    lines: arr(obj({ itemId: id, batchId: opt(nullable(id)), qtyMilli: qty, unitCost: opt(money), rateBp: opt(int({ min: 0, max: 10000 })) }), { max: 500 }),
  }))));

  // ---- customers and khata
  add('GET', '/api/customers', {}, (c) => { assertPerm(c.actor, 'order.write'); return listCustomers(c.ctx, { q: c.query.get('q') ?? undefined, dueOnly: c.query.get('due') === '1' }); });
  add('GET', '/api/customers/by-mobile/:mobile', {}, (c) => { assertPerm(c.actor, 'order.write'); return findCustomer(c.ctx, c.params.mobile!); });
  add('GET', '/api/customers/:id', {}, (c) => { assertPerm(c.actor, 'order.write'); return customerView(c.ctx, c.params.id!); });
  add('GET', '/api/customers/:id/statement', {}, (c) => { assertPerm(c.actor, 'order.write'); return customerStatement(c.ctx, c.params.id!); });
  add('POST', '/api/customers', {}, (c) => saveCustomer(c.ctx, c.actor, rid(c), body(c, obj({
    mobile: str({ min: 10, max: 16 }), name: opt(nullable(str({ max: 60 }))), gstin: opt(nullable(str({ max: 15 }))), address: opt(nullable(str({ max: 300 }))),
    creditLimit: opt(money), creditDays: opt(int({ min: 0, max: 365 })), openingDue: opt(int({ min: -1_000_000_000, max: 1_000_000_000 })),
  }))));
  add('POST', '/api/customers/:id/receipts', {}, (c) => collectDue(c.ctx, c.actor, rid(c), { customerId: c.params.id!, ...body(c, obj({ amount: int({ min: 1 }), mode: oneOf('CASH', 'UPI', 'CARD', 'OTHER'), reference: opt(nullable(str({ max: 60 }))) })) }));

  // ---- GST returns and labels
  add('GET', '/api/gstr1', {}, (c) => { assertPerm(c.actor, 'report.read'); return gstr1(c.ctx, c.query.get('month') ?? ''); });
  add('GET', '/api/gstr1/:file', { format: 'csv' }, (c) => {
    assertPerm(c.actor, 'report.read');
    const files = gstr1Csv(c.ctx, c.query.get('month') ?? '');
    const f = files[c.params.file!];
    if (f === undefined) throw new AppError('NOT_FOUND', `No such GSTR-1 file. Files: ${Object.keys(files).join(', ')}.`, 404);
    return f;
  });
  add('POST', '/api/labels/print', {}, (c) => printLabels(c.ctx, c.actor, rid(c), body(c, obj({ printerId: id, items: arr(obj({ itemId: id, batchId: opt(nullable(id)), copies: int({ min: 1, max: 999 }) }), { max: 500 }) }))));

  // a finalize may need a manager's approval for credit over the limit: the bill route already accepts override
  void override;
}
