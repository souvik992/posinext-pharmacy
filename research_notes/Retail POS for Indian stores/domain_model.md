# Retail POS + Inventory Domain Model (Indian general retail)

**Summary.** The most useful reference designs are ERPNext and Odoo. ERPNext supplies the Pricing Rule, Batch, Loyalty Program and Stock Settings models. Odoo supplies variant templates and loyalty or promotion program types. Indian vendors (GoFrugal, Logic ERP, Zoho Inventory) supply the patterns for multiple MRPs per batch.

These rules should drive the schema:
1. Store MRP on the batch or lot, not only on the item. The same item can be on the shelf at several MRPs at once. When there is more than one MRP, the cashier picks a lot; when there is only one lot or one MRP, the system picks it automatically.
2. Never sell a packaged item above its MRP. Legal Metrology Rule 18(2) prohibits it, and MRP includes all taxes. Selling prices are therefore tax-inclusive and capped at the batch MRP.
3. Treat buy-one-get-one as one supply of two goods for one price. GST is charged on the price paid, and no ITC reversal is needed for the "free" unit (CBIC Circular 92/11/2019).
4. Model promotions as rules with eligibility filters, a priority value and a stacking flag, following ERPNext Pricing Rule. Model loyalty as tiers with an earn factor, a redemption value per point and an expiry in days, with points posted only from submitted invoices.
5. Set the costing method (FIFO or moving average) per item; it cannot change after the item is saved. Batch items must never go negative.

Budget note: about 15 web calls were used. Several areas were not researched from sources: shifts and denominations, khata, GRN and landed cost, transfers, stock take and multi-store sync. Those sections are mostly marked as Inferences or Gaps.

## Item master, variants, units and barcodes

### Takeaway
The item master should be a template with variants (size × colour), each variant with its own SKU or barcode and its own stock. Store several barcodes per item. Store HSN, GST rate and cess per item. Keep MRP and selling price at the batch level when batch tracking is on, and use a stock UOM with conversion factors.

### Cited Findings
- **Odoo variants.** Odoo separates the product template (for example, a T-shirt) from variants, where each variant is one combination of attribute values (Blue, S). Each variant has its own inventory count and sales records; 4 colours × 5 sizes gives 20 variants. — [Odoo Variants](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/products/variants.html)
- **Odoo variant creation modes.** "Instantly" creates every combination. "Dynamically" creates a variant only when an order uses it. "Never" creates none. The mode cannot be changed after the attribute is added to a product. — [Odoo Variants](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/products/variants.html)
- **Odoo price extra.** Each attribute value can carry a "price extra", which is added to the sales price when that value is selected. A value also has an "Exclude for" field for invalid combinations. — [Odoo Variants](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/products/variants.html)
- **GoFrugal supermarket features.** GoFrugal advertises multiple EAN codes for the same item. It also advertises selling several batches of an item at different MRPs, with unique barcodes for packed items. — [GoFrugal supermarket ERP](https://www.gofrugal.com/retail/erp/supermarket/)
- **ERPNext item naming and stock UOM.** Items are named by Item Code or a Naming Series. The default stock UOM is "Nos". — [ERPNext Stock Settings](https://docs.frappe.io/erpnext/user/manual/en/stock-settings)
- **ERPNext UOM settings.** "Allow UOM with Conversion Rate Defined in Item" restricts transaction UOMs to those with a conversion defined on the item. "Allow to Edit Qty as per Stock UOM" handles cases where a whole-number stock UOM cannot hold an exact conversion factor. — [ERPNext Stock Settings](https://docs.frappe.io/erpnext/user/manual/en/stock-settings)
- **ERPNext pricing-rule quantities.** Pricing-rule Min and Max Qty are expressed in the stock UOM. — [ERPNext Pricing Rule](https://docs.frappe.io/erpnext/user/manual/en/pricing-rule)

### Inferences
- **Suggested tables.** `item_template`, `item` (variant/SKU), `item_barcode` (many per item, with optional `uom` and `pack_qty` so that a box barcode adds 12 pieces), `item_uom_conversion`, `category` (self-referencing parent for a hierarchy such as Department > Category > Sub-category), `brand`, `hsn` and `tax_rate`.
- **Suggested item fields.** hsn_code, gst_rate (0, 5, 12, 18 or 28), cess_rate or cess_amount_per_unit, mrp, selling_price, purchase_price, `price_includes_tax` (true by default for B2C), `is_weighed` or `is_loose` (fractional qty allowed, decimals = 3 for kg), `allow_decimal_qty`, `batch_tracked`, `expiry_tracked`, `shelf_life_days`, `costing_method`, reorder_level and reorder_qty per store, `is_active`.
- **Weighing-scale barcodes.** Scale-printed barcodes, such as a prefix plus PLU plus weight or price plus checksum, need a configurable parser. That parser is a common requirement but is not documented in the sources above.
- **Apparel.** Ginesys-style apparel usually adds season, style and design number. Treat these as variant attributes or free-form classification fields.

### Gaps
- Ginesys and GoFrugal item-master field lists were not fetched because of the call budget.
- The GST rate structure was reportedly rationalised in 2025. Verify the current slabs and the status of compensation cess before hard-coding any enum.
- Scale-barcode formats were not sourced.

## Batches, expiry and MRP per batch

### Takeaway
Use a batch entity with batch_no, item, mfg_date, expiry_date and MRP, and optionally a selling price and cost. If only one lot exists, or every lot has the same MRP, pick it automatically; otherwise make the cashier choose. Filter out expired batches by posting date. Batch items must not go negative.

### Cited Findings
- **ERPNext batch creation.** Batch IDs can be entered manually or created automatically. With "Automatically Create New Batch" set on the Item, batches are created at Purchase Receipt (GRN). — [ERPNext Batch](https://docs.frappe.io/erpnext/user/manual/en/batch)
- **ERPNext batch selection.** When picking a batch on a transaction, the list is filtered by item, warehouse, batch expiry date compared with the posting date, and the actual quantity in the warehouse. A batch shows its status as Expired, Not Expired or Not Set. — [ERPNext Batch](https://docs.frappe.io/erpnext/user/manual/en/batch)
- **ERPNext batch rules.** A batch's Item and Batch ID cannot change once a transaction has used it. Batches can be split or moved. From v15, Allow Negative Stock does not apply to batch or serial items. — [ERPNext Batch](https://docs.frappe.io/erpnext/user/manual/en/batch)
- **ERPNext batch naming.** A global batch Naming Series can be overridden per item. — [ERPNext Stock Settings](https://docs.frappe.io/erpnext/user/manual/en/stock-settings)
- **Logic ERP lot picking.** The lot number is picked automatically if the item has a single lot, or if all its lots have the same MRP. Otherwise the lot picker opens. — [Logic ERP release note](https://kb.logicerp.com/logic-erp-version-release-notes/november-2019/billing/auto-pick-lot-number-if-single-lot-or-have-same-mrp)
- **GoFrugal batch LOV.** In bill entry, the "Take Latest selling" setting hides the batch list-of-values, so the latest selling price is used instead of a cashier choice. — [GoFrugal RPOS release notes](https://cdn-download.gofrugal.com/GoFrugal_RPOS6/6.5.8.8/SP22/ReleaseNotes.html)
- **Zoho Inventory batch pricing.** The setting "Allow different MRP/SellingPrice for each Batch Tracked Items" enables per-batch prices. A new batch's selling price is cost plus margin %. For existing batches, the pricing method is Default, Latest, Highest or Price From Inward Transaction (that batch's own price). Selling price cannot be edited for existing batches during a purchase receive. — [Zoho Inventory batch price management](https://www.zoho.com/en-ng/inventory/help/advanced-inventory-tracking/batch-price-management/batch-price-management.html)

### Inferences
- **Batch table.** `batch(id, item_id, batch_no, mfg_date, expiry_date, mrp, selling_price, cost, supplier_id, grn_line_id, status)`. Store stock as `stock_balance(store_id, item_id, batch_id, qty)`.
- **Batch picking order.**
  1. Exclude expired batches (expiry_date < bill date). Block the sale or require a manager override, configurable per store.
  2. Group the remaining batches by MRP. If there is only one group, pick FEFO (earliest expiry) within it automatically.
  3. If there are several MRP groups, show the picker sorted by expiry.
- **Barcode shortcut.** If a barcode is batch-specific (GoFrugal-style unique barcodes on packed items), resolve the batch directly from the scan.
- **Near-expiry report.** Show items with expiry_date within N days (configurable, for example 30, 60 or 90) by store and supplier, to drive returns to the supplier.

### Gaps
- None of the fetched pages documented an explicit FEFO setting. ERPNext's batch and stock-settings pages are silent on FEFO.

## Price levels and pricing rules

### Takeaway
Keep MRP as a hard ceiling. Keep several price lists (retail, wholesale, member) assigned by customer group. Model quantity slabs and discounts as rule rows rather than item columns.

### Cited Findings
- **ERPNext Pricing Rule scope and conditions.**
  - Applies to an Item Code, Item Group, Brand or the whole Transaction (Grand or Net Total).
  - "Applicable For" can be a Customer, Customer Group, Territory, Sales Partner, Campaign, Supplier or Supplier Group.
  - Conditions: Min/Max Qty (Max 0 means unlimited), Min/Max Amount, Valid From/Upto, Company, Currency, For Price List and Warehouse.
  - Source: [ERPNext Pricing Rule](https://docs.frappe.io/erpnext/user/manual/en/pricing-rule)
- **ERPNext Pricing Rule results.** A Price result is a Rate, Discount %, Discount Amount or Margin. A rule's Rate replaces the normal Item Price. — [ERPNext Pricing Rule](https://docs.frappe.io/erpnext/user/manual/en/pricing-rule)
- **Odoo programs and pricelists.** Odoo programs can be restricted to pricelists. In POS, the customer's default pricelist is applied automatically, and the cashier can change it. — [Odoo Loyalty/Discount](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/loyalty_discount.html); [Odoo POS Loyalty](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/pricing/loyalty.html)
- **MRP ceiling (Legal Metrology).** Rule 18(2) of the Legal Metrology (Packaged Commodities) Rules, 2011 prohibits selling packaged commodities above MRP. The penalty provision is Section 36 of the Legal Metrology Act, 2009. Consumer forums have held that MRP is inclusive of all taxes. — [Govt Lok Sabha reply 2025](https://fcainfoweb.nic.in/PMS/writereaddata/2025_LS_B_4362.pdf); [IndiaLaw summary](https://www.indialaw.in/blog/criminal/overpricing-beyond-mrp-violates-consumer-law/)
- **MRP exemptions.** One FAQ source says drugs, fast food and packs up to 10 g or 10 ml are exempt. This is an unofficial source, so verify it. — summarised via search; see [Legal Metrology PC Rules study](https://www.casemine.com/in/column/the-legal-metrology-(packaged-commodities)-rules,-2011:-an-analytical-study/view)

### Inferences
- **Price lookup order.** Evaluate prices in this order:
  1. Batch selling price, or the item selling price.
  2. Price-list override for the customer's group (member or wholesale).
  3. Quantity-slab rule.
  4. Promotions.
  5. Manual line discount, within the cashier's role limit.
  6. Bill-level discount.
- **MRP validation.** Validate that the final unit price including tax is no higher than the batch MRP for packaged goods. Loose or unpackaged goods without an MRP skip this check.
- **Discount off MRP.** Store "X% off MRP" as a rule type that computes the price from the batch MRP rather than from the selling price.

### Gaps
- No source documented per-customer price lists in Indian vendors (GoFrugal or Marg) because of the call budget.

## Promotions, stacking and GST on free items

### Takeaway
ERPNext and Odoo give a complete rule vocabulary. For BOGO, charge GST on the price actually paid and spread it across the lines. Free items appear as zero-value or discounted lines with no ITC reversal.

### Cited Findings
- **ERPNext free-item rules.** A Product result gives a free item: the same item or another one, with qty, UOM and rate. Options include Round Free Qty and "Don't Enforce Free Item Qty". — [ERPNext Pricing Rule](https://docs.frappe.io/erpnext/user/manual/en/pricing-rule)
- **ERPNext rule flags.** Rules can be marked Mixed Conditions (qty or value summed across several items), Is Cumulative (counts across transactions in the period) or Coupon Code Based. — [ERPNext Pricing Rule](https://docs.frappe.io/erpnext/user/manual/en/pricing-rule)
- **ERPNext conflict resolution.** "Has Priority" plus a Priority value makes one rule win. "Apply Multiple Pricing Rules" lets eligible rules stack. "Apply Discount on Discounted Rate" compounds percentages instead of adding them. A Promotional Scheme with several slabs generates one Pricing Rule per slab. The page does not document a tie-break beyond priority. — [ERPNext Pricing Rule](https://docs.frappe.io/erpnext/user/manual/en/pricing-rule)
- **Odoo program types.** Coupons, Loyalty Cards, Promotions, Discount Code, Buy X Get Y (each X bought earns a credit, and credits are traded for Y) and Next Order Coupons. — [Odoo Loyalty/Discount](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/loyalty_discount.html)
- **Odoo program conditions.** Start and end dates (blank means no expiry), Limit Usage, and restrictions by pricelist or POS. Rules use Min Qty and Min Purchase (tax incl or excl), and both must be met if both are set; they can target products, categories or tags. — [Odoo Loyalty/Discount](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/loyalty_discount.html)
- **Odoo rewards.** A reward is a Free Product, or a Discount (% / per point / fixed per order) on the whole order, the cheapest item or specific products. Max Discount 0 means no cap. — [Odoo Loyalty/Discount](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/loyalty_discount.html)
- **GST on BOGO (CBIC Circular 92/11/2019, 7 March 2019).** BOGO is not a free supply: "a single price is being charged for the entire supply", so it is treated as two goods for the price of one. ITC is not reversed under s.17(5)(h) for BOGO. Mixed supplies take the highest rate. Genuinely free samples and gifts, by contrast, need ITC reversal. — [GST Council circular PDF](https://gstcouncil.gov.in/sites/default/files/2024-06/circular-cgst-92.pdf); [VJM Global summary](https://www.vjmglobal.com/blog/gst-impact-on-discount-scheme); [PwC news flash](https://www.pwc.in/assets/pdfs/services/tax/indirect_news_alert/2019/pwc_news_flash_8_march_2019_cbic_clarifies_treatment_of_sales_promotion_schemes.pdf)
- **Post-sale discounts.** A newer Circular 251/08/2025 addresses post-sale discounts. It was not read. — [Taxguru](https://taxguru.in/goods-and-service-tax/gst-treatment-post-sale-discounts-circular-no-251-08-2025-gst.html)

### Inferences
- **Promotion tables.** `promotion(id, type [item_discount|bogo|combo|qty_slab|bill_slab|coupon], priority, stackable, apply_on_discounted, valid_from, valid_to, stores[], customer_groups[], usage_limit)`, with `promotion_condition` and `promotion_reward` child tables.
- **Engine behaviour.**
  1. Collect the eligible promotions.
  2. Sort them by priority.
  3. Apply the non-stackable promotion with the highest priority per line.
  4. Then apply the stackable ones.
  5. Recompute on every cart change.
- **GST on free lines.** Show the free line at its price with a 100% discount. Allocate the bundle price across lines so that each line's taxable value is calculated at its own HSN rate. When the free item carries a different rate, check this approach with a CA.
- **Discounts on the invoice.** A discount shown on the invoice reduces the taxable value, which is consistent with CGST s.15(3). The statute was not fetched.

### Gaps
- The exact circular text was not machine-readable. The quotes come from secondary summaries.
- Odoo's stacking rules for several programs on one order were not documented on the fetched page.

## Customers, loyalty and credit (khata)

### Takeaway
Key the customer on mobile number. Loyalty needs tiers by cumulative spend, an earn factor (amount per point), a redeem value per point and an expiry in days, with a points ledger. Khata needs a separate receivable ledger.

### Cited Findings
- **ERPNext Loyalty Program setup.** A program is Single or Multiple Tier, optionally restricted by Customer Group, Territory and dates. Auto Opt In enrols matching customers automatically. — [ERPNext Loyalty Program](https://docs.frappe.io/erpnext/user/manual/en/loyalty-program)
- **ERPNext tiers and points.**
  - Tiers have a Minimum Amount measured on cumulative eligible spend, not just the current invoice.
  - The Collection Factor is the eligible amount per point: at a factor of 100, ₹1,000 earns 10 points.
  - The Conversion Factor is the value of one redeemed point.
  - Points expire after an Expiry Duration in days.
  - Source: [ERPNext Loyalty Program](https://docs.frappe.io/erpnext/user/manual/en/loyalty-program)
- **ERPNext points ledger.** Points come only from submitted invoices, as Loyalty Point Entries. Redemption ("Redeem Loyalty Points") happens on the invoice. Returns and cancellations affect the balance, but the mechanics are not documented. — [ERPNext Loyalty Program](https://docs.frappe.io/erpnext/user/manual/en/loyalty-program)
- **Odoo POS loyalty.** Odoo POS shows the points earned once a customer is set on the order. Points are spent with the "Rewards" button. — [Odoo POS Loyalty](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/pricing/loyalty.html)

### Inferences
- **Points ledger.** Use `loyalty_ledger(customer_id, invoice_id, points (+/-), type [earn|redeem|expire|reverse], expires_on)`.
  - Expire points FIFO by earn date.
  - On a return, reverse the earned points pro rata. If those points were already redeemed, allow a negative balance or deduct from the refund.
- **Khata.** Use `customer(credit_limit, credit_days)` and a `customer_ledger` with invoice debit and receipt credit entries.
  - A collection receipt can settle several invoices, oldest first or by explicit allocation.
  - Block a credit sale above the limit unless a manager overrides.
  - Expose dues ageing and a WhatsApp/SMS reminder hook.
- **Customer key.** The mobile number should be unique per tenant. Hold GSTIN optionally for B2B invoices.

### Gaps
- No khata-specific documentation from Indian vendors was fetched.

## Purchases (PO, GRN, invoice, returns, landed cost)

### Takeaway
The GRN (purchase receipt) is where batches are created, with batch_no, expiry, MRP and selling price captured. A selling-price margin rule can preset the new batch price.

### Cited Findings
- **ERPNext GRN batches.** ERPNext creates batches automatically at Purchase Receipt. — [ERPNext Batch](https://docs.frappe.io/erpnext/user/manual/en/batch)
- **Zoho new-batch pricing.** On receive, a new batch's selling price is cost × (1 + margin%). — [Zoho batch pricing](https://www.zoho.com/en-ng/inventory/help/advanced-inventory-tracking/batch-price-management/batch-price-management.html)
- **ERPNext over-receipt.** An over-receipt or over-delivery allowance % is configurable, together with a role that may exceed it. — [ERPNext Stock Settings](https://docs.frappe.io/erpnext/user/manual/en/stock-settings)
- **ERPNext reorder.** A Material Request can be raised automatically when stock reaches the item's reorder level. — [ERPNext Stock Settings](https://docs.frappe.io/erpnext/user/manual/en/stock-settings)

### Inferences
- **GRN line fields.** item, batch_no, mfg/expiry, mrp, qty, free_qty, uom, rate, discount, gst, landed_cost_share, new_selling_price.
- **Free quantity.** Free qty enters stock at zero cost, which lowers the average cost.
- **Purchase return.** A purchase return creates a debit note and must refer to the original batch.
- **Supplier ledger.** The supplier ledger mirrors the customer ledger.
- **PO suggestion.** Suggest PO quantities from (reorder_level − on_hand − on_order), or from sales velocity × lead time.

### Gaps
- Landed cost and purchase returns were not fetched. ERPNext has a "Landed Cost Voucher" doctype that was not researched here.

## Stock: costing, adjustments, transfers, stock take, negative stock

### Takeaway
Use per-item costing (FIFO or moving average) that is immutable after the item is saved. Allow negative stock only as a per-store or per-item policy, and never for batch items. A stock freeze date protects closed periods.

### Cited Findings
- **ERPNext valuation method.** The valuation method is FIFO (default), LIFO or Moving Average, overridable per item, and it cannot be changed once the item is saved. — [ERPNext Stock Settings](https://docs.frappe.io/erpnext/user/manual/en/stock-settings)
- **ERPNext negative stock and freezing.** Allow Negative Stock can be set globally or per item, but not for batch or serial items from v15. "Stock Frozen Upto" and "Freeze Stocks Older Than N days" block back-dated postings, with a role that may edit frozen stock. — [ERPNext Stock Settings](https://docs.frappe.io/erpnext/user/manual/en/stock-settings)
- **ERPNext Stock Closing Entry (v16).** This entry snapshots quantity and value by item, batch and warehouse for a period, so that reports run faster. — [ERPNext Stock Closing Entry](https://docs.frappe.io/erpnext/user/manual/en/pos-closing-entry) (this URL served the Stock Closing Entry page)

### Inferences
- **Stock ledger.** Use an append-only `stock_ledger(store, item, batch, qty_change, valuation_rate, voucher_type, voucher_id, posted_at)`.
- **Adjustments.** Adjustments need a reason code: damage, expiry, theft, sample, found or counting error.
- **Transfers.** A transfer is two-step: dispatch moves stock into an "in-transit" virtual location, and receipt moves it into the destination. Any shortfall becomes a variance adjustment.
- **Stock take.** Scanner sessions per zone, then a freeze snapshot, then counted versus system quantities, then approval, then posting of the variance as an adjustment.

### Gaps
- Odoo's and ERPNext's stock reconciliation and transfer docs were not fetched.

## Sales ops: counters, shifts, returns, tenders

### Takeaway
None of these areas was sourced within the budget. The design below is an inference from standard POS patterns.

### Cited Findings
- **ERPNext POS Opening/Closing Entry.** These doctypes exist, but the doc URL tried returned 404 (pos-opening-entry), and the pos-closing-entry URL served a different page. No details were captured.

### Inferences
- **Counters and series.**
  - Each counter or terminal has its own invoice series, such as `STORE-CTR-FY-####`. GST requires invoice numbers unique per financial year, at most 16 characters (not verified here).
  - Offline terminals pre-allocate a series so that numbering never collides.
- **Shifts.**
  - Opening: an opening float with denomination counts.
  - During the shift: cash-in and cash-out entries with reasons.
  - Closing: denomination-wise count, then expected versus counted per tender, then the difference.
  - An X report is a mid-shift read; a Z report is the end-of-day close and resets the counters.
- **Held bills.** A held bill is a draft stored per counter.
- **Returns.** A return against a bill references the original line and batch and is capped at the remaining returnable qty. A return without a bill needs a manager role and uses the current price, or the lowest price.
- **Refunds.** The refund can go back to the original tender, or to store credit as a credit-note wallet.
- **Split tender.** Use `payment(invoice_id, mode [cash|upi|card|credit|store_credit|loyalty|wallet], amount, ref)`.

### Gaps
- Sources for Odoo or ERPNext POS sessions, cash control and returns policies were not fetched.
- GST invoice-number rules were not cited.

## Reports and multi-store sync

### Takeaway
None of this was sourced. The points below are inferences.

### Cited Findings
- **GoFrugal multi-store.** GoFrugal advertises batch-wise inventory and expiry tracking across branches with centralised multi-outlet management. — [GoFrugal multi-store](https://www.gofrugal.com/multi-store-pos/billing-software.html) (from a search snippet; not fetched)

### Inferences
- **Owner reports.**
  - Daily sales by tender and counter.
  - Sales by item, category, brand and HSN.
  - GSTR-1 HSN summary and B2B/B2C splits.
  - Gross margin by item.
  - Stock valuation.
  - Dead stock and slow movers.
  - Near-expiry list.
  - Reorder suggestions.
  - Customer dues ageing.
  - Supplier payables.
  - Shift variance.
  - Promotion effectiveness.
- **Multi-store sync.**
  - HQ owns the masters (items, prices, promotions) and pushes versioned deltas.
  - Stores own transactions and push them upward.
  - Use UUID primary keys and per-terminal invoice series to avoid conflicts.
  - Transfers reconcile through the in-transit state.

### Gaps
- No vendor documentation on offline sync conflict handling was fetched.
