# GST and Legal Metrology: what the POS does and why

Research done on 2026-11-12 from public sources (listed below). Most are secondary summaries of the notifications;
**have a chartered accountant confirm before relying on any of this**, especially rates. Rates, HSN lists and
thresholds change at the government's pace, so they are data (tax groups, settings), never hard-coded.
The full research report is in `reports/Retail POS for Indian stores.md`.

## Documents and their titles

| Situation | Title printed | Basis |
|---|---|---|
| Regular dealer, taxed goods | TAX INVOICE | CGST Rule 46 |
| Regular dealer, only nil-rated or exempt goods (loose rice, dal, fresh milk) | BILL OF SUPPLY | Rule 49 |
| Regular dealer, taxed + exempt goods to an **unregistered** buyer | INVOICE-CUM-BILL OF SUPPLY | Rule 46A (B2C only; must carry Rule 46 and Rule 49 particulars) |
| Same mix to a **registered** buyer (GSTIN on the bill) | TAX INVOICE | Rule 46A does not apply to B2B |
| Composition dealer, any sale | BILL OF SUPPLY + "Composition taxable person, not eligible to collect tax on supplies" | s.31(3)(c), Rule 5(1)(g) |
| Return | CREDIT NOTE, against the original bill, at the original rate | s.34; by 30 Nov after the FY |

Code: `docTitle` in `src/services/printing/receiptTemplate.ts`; tests in `test/compliance.test.ts`.

## Composition scheme (Settings > GST scheme = composition)

- Eligible with previous-year turnover up to **Rs 1.5 crore** (Rs 75 lakh in special category states); traders pay
  **1% of turnover of taxable goods** (0.5% CGST + 0.5% SGST); exempt goods are counted for the limit but not taxed.
- No tax is collected on the bill and no input tax credit is claimed.
- **No inter-state outward supply**: the POS refuses a bill whose place of supply is another state
  (`COMPOSITION_INTERSTATE`).
- Quarterly CMP-08: `GET /api/composition-summary?quarter=2026-27-Q3` gives taxable and exempt turnover and the
  1% tax, credit notes netted. Taxable or exempt is read from the item's current GST rate (a rate change inside the
  quarter is not reflected).
- GSTR-1 is not filed by composition dealers, so their bills are left out of the GSTR-1 export.

## Cess (tobacco, pan masala)

GST compensation cess **ended on 1 February 2026**. Tobacco, cigarettes (other than biris) and pan masala moved to
**40% GST** (retail sale price based), with additional central excise on tobacco and the Health Security se National
Security Cess on pan masala, both at the manufacturer, not on the retailer's bill. So shops need no cess tax groups
any more; cess support stays so older bills, reports and returns still add up.

## GST rates (GST 2.0, from 22 September 2025)

Slabs 0 / 5 / 18 / 40%. New shops start with those four tax groups (`setupFirstRun`). Rates seen in the research
for common grocery goods (used in the demo shop): nil for fresh milk, UHT milk, pre-packaged paneer, Indian breads;
5% for ghee, butter, cheese, biscuits, namkeen, chocolate, soap, shampoo, toothpaste, hair oil; 40% for aerated and
caffeinated drinks; detergent powder appears to stay at 18% (laundry and dishwash bars depend on classification:
check). Sources disagree on several *old* rates; the new rates above were consistent across sources.

## Other rules built in

- Invoice numbers up to 16 characters, consecutive per series and financial year, one series per counter.
- HSN: 4 digits up to Rs 5 crore turnover, 6 above (Settings `hsn_digits` = 6 makes HSN required with 6 digits).
- B2CL in GSTR-1: inter-state B2C bill above **Rs 1 lakh** (from 1 Aug 2024).
- E-invoice only for B2B above Rs 5 crore turnover; not built yet (v2).
- MRP: never sell above MRP (Legal Metrology Rule 18(2)); MRP kept per batch; labels print
  "MRP Rs x (Incl. of all taxes)" uncut and the unit sale price.
- FSSAI number on bills for food sellers (Store settings); records kept 72 months (backups, journal).

## Sources

- Tobacco and cess from 1 Feb 2026: [Business Today](https://www.businesstoday.in/amp/latest/corporate/story/centre-revamps-tobacco-taxation-brings-back-excise-and-resets-gst-rates-from-feb-1-2026-509010-2026-01-01), [Business Standard](https://www.business-standard.com/industry/news/gst-tobacco-cess-excise-revenue-sin-products-126010100596_1.html), [Tally](https://tallysolutions.com/smart-moves/expert-insights/paandemic-of-taxes-getting-ready-for-feb-1st-gst-shake-up/), [Free Press Journal](https://www.freepressjournal.in/business/tobacco-products-face-additional-excise-duty-pan-masala-health-cess-from-february-1)
- Composition scheme: [Busy](https://busy.in/gst/composition-scheme-under-gst-explained/), [Tax2win](https://tax2win.in/guide/gst-composition-scheme), [TaxGuru](https://taxguru.in/?p=1050980)
- Rule 46A: [GSTZen](https://www.gstzen.in/a/invoice-cum-bill-of-supply-cgst-rule-46a.html), [GST Council flyer](https://www.gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/Tax_Invoice_and_other_new.pdf), [ICMAI](https://icmai.in/upload/Taxation/Courses/PPT/ACCGST12_0609_2024.pdf)
- GST 2.0 rates: [Tally](https://tallysolutions.com/gst/new-gst-rates-september-2025-business-impact/), [ClearTax](https://cleartax.in/s/gst-rates), [Moneylife](https://www.moneylife.in/article/from-groceries-medicines-insurance-to-small-cars-what-gets-cheaper-and-costlier-under-gst-20-rollout-from-22nd-sept/78173.html), [Busy: soap](https://busy.in/gst-rates/soap/), [Upstox: detergents not cut](https://upstox.com/news/market-news/stocks/gst-2-0-gst-cuts-elude-these-key-items-analysts-and-fmcg-players-say-it-is-surprising/article-180835)
