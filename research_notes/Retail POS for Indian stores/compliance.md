# Indian legal and tax compliance for a retail POS (kirana, supermarket, general store, apparel)

Researched 12 Nov 2026. Official CBIC/GST pages often failed to load (TLS errors), so many citations are reputable secondary sources (TaxGuru, ClearTax, GSTZen, Taxmann, SS Rana, Mondaq) that quote the notifications. Each such case is marked. Effective dates are given where found.

## Summary checklist (developer view)

| # | Rule | What the POS must do | Basis / effective date |
|---|------|----------------------|------------------------|
| 1 | Document heading | "Tax Invoice" for a regular GST dealer; "Bill of Supply" for a composition dealer or exempt goods | s.31 CGST Act; Rule 46 / Rule 49 |
| 2 | Invoice number | Consecutive, max 16 chars, only A-Z, 0-9, "-" and "/"; unique per FY (Apr-Mar); one or more series (e.g. per counter/branch) | Rule 46(b) |
| 3 | Mandatory fields | Supplier name, address, GSTIN; number; date; HSN; description; qty + UQC; taxable value after discount; rate and amount per head (CGST/SGST/IGST/cess); total; reverse-charge flag; signature (not needed if electronic); recipient GSTIN if B2B; place of supply + state for inter-state | Rule 46(a)-(q) |
| 4 | Unregistered buyer >= Rs 50,000 | Capture name, address, delivery address, state name + code (below that, only if the buyer asks) | Rule 46(e)/(f) |
| 5 | Sales < Rs 200 to unregistered buyer | Optional: skip the individual invoice and issue one consolidated invoice at close of day (POS should still print a receipt) | s.31(3)(b) + Rule 46 4th proviso; Rule 49 for bill of supply |
| 6 | IGST vs CGST+SGST | Inter-state (supplier state != place of supply) -> IGST; else CGST+SGST/UTGST at half rate each. For over-the-counter retail, place of supply = the store | Place-of-supply rules (IGST Act s.10, not checked) |
| 7 | HSN digits | AATO <= Rs 5 cr: 4 digits (mandatory on B2B, optional on B2C); AATO > Rs 5 cr: 6 digits on all invoices | Notf 78/2020-CT, 15 Oct 2020, w.e.f. 1 Apr 2021 |
| 8 | GSTR-1 export | B2B (4A), B2CL (5: inter-state B2C invoice > Rs 1 lakh), B2CS (7: rate- and state-wise), CDNR/CDNUR, HSN Table 12 split into B2B and B2C tabs, Table 13 documents issued (mandatory) | Notf 12/2024-CT (B2CL Rs 1 lakh w.e.f. 1 Aug 2024); GSTN Phase-3 from May 2025 return period |
| 9 | Composition dealer | Bill of Supply with no tax charged; print "composition taxable person, not eligible to collect tax on supplies"; no ITC; also display it on the signboard | s.31(3)(c), s.10; Rule 5(1)(g)/(h) |
| 10 | E-invoice (IRN/QR) | Only B2B (and exports, B2B CN/DN) when aggregate turnover > Rs 5 cr in any FY since 2017-18. B2C is exempt from IRN | Notf 10/2023-CT, w.e.f. 1 Aug 2023 |
| 11 | 30-day IRP limit | AATO >= Rs 10 cr: the IRP rejects documents older than 30 days | GSTN advisory 5 Nov 2024, w.e.f. 1 Apr 2025 (Rs 100 cr from 1 Nov 2023) |
| 12 | B2C dynamic QR | Required only if AATO > Rs 500 cr | Notf 14/2020-CT |
| 13 | IRN cancellation | Within 24 h, only if no active e-way bill; the cancelled number cannot be reused for an IRN | IRP rules |
| 14 | E-way bill | Consignment > Rs 50,000 (incl. tax, excl. exempt goods) moved by motor vehicle, incl. branch/stock transfers, home deliveries and returns. Intra-state limits vary by state | Rule 138 |
| 15 | Returns | Credit note referencing the original invoice; issue/declare by 30 Nov after the FY end, or annual-return date if earlier | s.34; Finance Act 2022, w.e.f. 1 Oct 2022 |
| 16 | GST 2.0 rates | Rate master must be date-effective: 5%/18%/40% (plus nil, and special rates such as 0.25%/3% not checked) from 22 Sep 2025; compensation cess removed except on tobacco (temporarily) | Notf 9/2025-CT(Rate), 17 Sep 2025 |
| 17 | MRP | Selling price <= MRP; MRP includes all taxes; back-calculate tax from inclusive price; keep old and revised MRP on stock affected by the rate change | LMPC Rules 2011 r.6(1)(e); DoCA 9 Sep 2025 relaxation (till 31 Dec 2025) |
| 18 | Unit sale price | Pre-packaged goods label carries a unit sale price (per kg/g, per l/ml, per unit); POS shelf labels can mirror it | LMPC (Amendment) Rules 2021, G.S.R. 779(E); in force after deferrals (1 Jan 2023 per Mondaq, conflict noted) |
| 19 | Weighing scales | Scales used in trade must be verified and stamped (POS scale integration should store the verification certificate and due date) | LM Act 2009 s.24, penalty s.33 |
| 20 | FSSAI | 14-digit FSSAI licence/registration number on every bill/cash memo for food sales | FSSAI order 8 Jun 2021, w.e.f. 1 Oct 2021 |
| 21 | Retention | Keep invoices, stock and accounts for 72 months from the annual-return due date (longer if a dispute is pending); item-wise stock register | s.36; Rule 56 |

## 1. GST tax invoice fields, numbering, B2B vs B2C, Rs 200 consolidated invoice

### Takeaway
Rule 46 lists the mandatory invoice fields. The number may have at most 16 characters (A-Z, 0-9, "-" and "/") and must be unique per financial year. B2B invoices need the buyer's GSTIN. Buyer details are mandatory for unregistered buyers only at Rs 50,000 or more. For supplies under Rs 200 to unregistered buyers who don't want an invoice, the seller may issue one consolidated invoice at the end of the day.

### Cited Findings
- Rule 46 particulars: (a) supplier name, address, GSTIN; (b) consecutive serial number "not exceeding sixteen characters", in one or multiple series, unique for a financial year; (c) date; (d) recipient name, address, GSTIN/UIN if registered; (e) unregistered recipient with taxable supply >= Rs 50,000: name, address, delivery address, state name and code; (f) same on request below Rs 50,000; (g) HSN/SAC; (h) description; (i) quantity and unit/UQC; (j) total value; (k) taxable value after discount/abatement; (l) rate (central, state, integrated, UT tax, cess); (m) tax amount; (n) place of supply with state name for inter-State supplies; (o) delivery address if different from place of supply; (p) whether tax payable on reverse charge; (q) signature or digital signature; (r) QR code embedding IRN where the invoice is issued under rule 48(4); (s) declaration where e-invoicing applies but this invoice is outside rule 48(4). — [GSTZen, Rule 46 text](https://gstzen.in/a/tax-invoice-cgst-rule-46.html)
- Signature is not required on an electronic invoice issued under the IT Act 2000. — [GSTZen](https://gstzen.in/a/tax-invoice-cgst-rule-46.html)
- The only allowed special characters in the serial number are the hyphen "-" and slash "/" (no *, #, @). Serial numbers issued are reported in GSTR-1. — [CBIC Rule 46 (search extract; page failed TLS on fetch)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html); [TaxGuru commentary](https://taxguru.in/goods-and-service-tax/commentary-tax-invoice-number-gst.html)
- Amendment history of Rule 46: Notf 31/2019-CT (QR-code proviso, w.e.f. 1 Apr 2020), Notf 79/2020-CT (15 Oct 2020, HSN proviso substituted), Notf 26/2022-CT (online gaming/e-commerce proviso), Notf 38/2023-CT (state-name wording). — [GSTZen](https://gstzen.in/a/tax-invoice-cgst-rule-46.html)
- Section 31(3)(b): a registered person may choose not to issue a tax invoice where the value is below Rs 200, subject to conditions. The 4th proviso to Rule 46 then allows a consolidated tax invoice at the close of each day where the recipient is unregistered and does not require an invoice. This is optional; the supplier may still issue an invoice. — [ICMAI slides](https://icmai.in/upload/Taxation/Courses/PPT/ACCGST12_0609_2024.pdf); [GSTGyaan s.31](https://gstgyaan.com/section-31-of-the-cgst-act-tax-invoice); [ClearTax](https://cleartax.in/s/gst-invoice)
- Copies: goods invoices in triplicate (original for recipient, duplicate for transporter, triplicate for supplier); services in duplicate. — [ClearTax](https://cleartax.in/s/gst-invoice) (the copy markings come from Rule 48(1), which wasn't fetched)
- Goods invoice timing: issued at or before removal/delivery. — [ClearTax](https://cleartax.in/s/gst-invoice)

### Inferences
- Validate the number format with `^[A-Za-z0-9/-]{1,16}$`. Generate it as a prefix (counter/branch) plus FY plus a running counter that resets on 1 April, for example `S1/2627/000123` (14 characters).
- B2B mode: capture and validate the GSTIN (15 characters; the first 2 digits are the state code). Derive the place of supply. Choose IGST when the supplier's state code differs from the place of supply; otherwise split the tax into CGST and SGST at half the rate each.
- For counter sales, the place of supply is the store location, so tax is always CGST+SGST. IGST mainly arises for B2B buyers from other states taking delivery outside the state, and for home deliveries across state borders.
- Even when using the Rs 200 consolidation, print a non-tax receipt for each sale. Generate one consolidated tax invoice per day per rate/HSN, numbered in the same series.

### Gaps
- Official CBIC Rule 46 and Rule 48 pages couldn't be fetched (TLS error), so the clause text is from the GSTZen reproduction.
- IGST Act s.10 place-of-supply text wasn't checked directly.

## 2. HSN digits and GSTR-1 tables

### Takeaway
Notf 78/2020-CT sets the HSN digits by AATO: 4 digits at Rs 5 crore or less, 6 digits above. From the May 2025 return period, GSTR-1 Table 12 is split into B2B and B2C tabs, HSN codes must be picked from a validated list, and Table 13 (documents issued) is mandatory. B2CL now means an inter-state B2C invoice above Rs 1 lakh.

### Cited Findings
- Notification 78/2020-Central Tax (15 Oct 2020): taxpayers must report at least 4 or 6 HSN digits based on the preceding FY's AATO. AATO up to Rs 5 cr: 4 digits; above Rs 5 cr: 6 digits. — [TaxGuru](https://taxguru.in/goods-and-service-tax/implementation-mandatory-mentioning-hsn-codes-gstr-1.html); [Studycafe on GSTN advisory](https://studycafe.in/gstn-advisory-on-implementation-of-mandatory-mentioning-of-hsn-codes-in-gstr-1-and-gstr-1a-362932.html)
- Phase-3 (from the May 2025 return period): Table 12 is split into "B2B Supplies" and "B2C Supplies" tabs. HSN codes are selected from a dropdown, with no manual entry. Table 13 is mandatory. 6-digit codes made by truncating an 8-digit HSN are invalid if the 6-digit code is not in the tariff. Phase 4 is "to be communicated". — [GSTN advisory copy, MahaGST](https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760596735_345%20Reporting%20of%20HSN%20codes%20in%20Table%2012%20and%20list%20of%20documents%20in%20table%2013%20of%20GSTR%201%201A.pdf); [Studycafe](https://studycafe.in/gstn-advisory-on-implementation-of-mandatory-mentioning-of-hsn-codes-in-gstr-1-and-gstr-1a-362932.html); [GSTN HSN validation advisory 8 Jan 2025](https://gstgyaan.com/pdf/advisory-on-hsn-validation-dated-08-01-2025.pdf)
- B2CL threshold: Notf 12/2024-CT (10 Jul 2024) amended rule 59(4), reducing the limit from Rs 2.5 lakh to Rs 1 lakh, w.e.f. 1 Aug 2024. Some news reports say Sep 2024, but the notification text supports 1 Aug 2024. Inter-state B2C invoices of Rs 1 lakh or less stay in B2CS. — [Tally help](https://help.tallysolutions.com/gstr-1/b2c-large-invoices-5a-5b); [TaxTMI](https://www.taxtmi.com/article/detailed?id=14949)

### Inferences
- The POS export should provide: B2B (invoice-wise, by buyer GSTIN), B2CL (invoice-wise, inter-state, unregistered, value > Rs 1 lakh), B2CS (aggregated by place of supply and rate, split into intra/inter-state), CDNR/CDNUR (credit/debit notes), HSN summary (Table 12, B2B and B2C tabs: HSN, UQC, qty, taxable value, tax heads), and Docs issued (Table 13: series from/to, total, cancelled).
- The item master should hold a validated 8-digit HSN and derive the 4 or 6 digits needed for reporting. Validate against the official GST HSN list rather than truncating.
- Each item needs a UQC (KGS, NOS, PCS, LTR, MTR, etc.) for the HSN summary.

### Gaps
- The official Notf 78/2020 text wasn't fetched. That the 4-digit HSN applies only to B2B for AATO up to Rs 5 cr (optional on B2C) is widely reported but I didn't verify it in this session.

## 3. Composition dealers: Bill of Supply

### Takeaway
Composition dealers cannot collect tax. They issue a Bill of Supply (s.31(3)(c), Rule 49) with the mandatory statement "composition taxable person, not eligible to collect tax on supplies" (Rule 5(1)(g)).

### Cited Findings
- Composition taxpayers issue a Bill of Supply under Section 31(3)(c) instead of a tax invoice. — [TaxGuru](https://taxguru.in/goods-and-service-tax/composition-supplier-issue-bill-supply-instead-tax-invoice.html)
- The bill must show "composition taxable person, not eligible to collect tax on supplies" at the top. Rule 49 has a similar Rs 200 relaxation for bills of supply. — [TaxManagementIndia](https://www.taxmanagementindia.com/visitor/detail_manual.asp?ID=1963); [ICMAI](https://icmai.in/upload/Taxation/Courses/27th-September-Invoicing.pdf)
- Rule 56(2) item-wise stock records apply to regular taxpayers; composition dealers are reportedly exempt from that sub-rule. — [Petpooja glossary](https://blog.petpooja.com/glossary/stock-register/)

### Inferences
- POS "composition mode": change the heading to "Bill of Supply", print the composition statement, and show no tax lines or rates. The total equals the price with no tax split (tax is paid from the dealer's own pocket on turnover). Keep the HSN optional per Rule 49. Disable B2B ITC wording. Turnover still needs to be exported for CMP-08/GSTR-4.
- The same Bill of Supply format applies when a regular dealer sells only exempt goods (for example fresh vegetables or loose unbranded food grains). A mixed basket may use a single "Invoice-cum-bill of supply" (Rule 46A, not verified here).

### Gaps
- Rule 5 and Rule 49 official texts weren't fetched. The composition rate for traders (1%) and turnover limit (Rs 1.5 cr) weren't verified in this session.

## 4. E-invoicing (IRN/QR), B2C QR, 30-day limit

### Takeaway
E-invoicing applies to B2B documents when aggregate turnover exceeds Rs 5 crore in any FY since 2017-18 (from 1 Aug 2023). B2C sales are exempt from IRN. A B2C dynamic QR is required only above Rs 500 crore AATO. From 1 Apr 2025, taxpayers with AATO of Rs 10 crore or more must report each document to the IRP within 30 days.

### Cited Findings
- Notf 10/2023-Central Tax (10 May 2023): threshold reduced to Rs 5 crore aggregate turnover in any preceding FY from 2017-18, w.e.f. 1 Aug 2023. — [ClearTax](https://cleartax.in/s/e-invoicing-businesses-above-rs-5-crore-turnover); [TaxGuru](https://taxguru.in/goods-and-service-tax/e-invoicing-compliance-note.html)
- Notf 13/2020-CT (as amended) defines the class of persons under Rule 48(4). Notf 14/2020-CT requires a dynamic QR on B2C invoices for taxpayers with turnover above Rs 500 cr. Sources disagree on which notification governs what; one low-quality blog wrongly says B2C QR applies above Rs 5 cr. — [TaxGuru quick-start](https://taxguru.in/goods-and-service-tax/quick-start-guide-e-invoicing-gst.html); [Zoho FAQ](https://zstatic.zohostatic.com/in/books/gst/faq/e-invoicing.html)
- 30-day reporting: from 1 Nov 2023 for AATO >= Rs 100 cr (advisory 13 Sep 2023). GSTN advisory of 5 Nov 2024 extended it to AATO >= Rs 10 cr from 1 Apr 2025. The IRP blocks late reporting. It covers invoices, credit notes and debit notes. — [Taxmann](https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/); [Taxscan](https://www.taxscan.in/new-30-day-e-invoice-rule-from-april-1-2025-what-businesses-need-to-know/502806); [GSTN advisory copy](https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760531580_293%20Advisory%20Time%20Limit%20for%20Reporting%20e%20Invoice%20on%20the%20IRP%20Portal%20%20Lowering%20of%20Threshold%20to%20AATO%2010%20Crores%20and%20Above.pdf)
- IRN cancellation: only within 24 hours of generation, and not where an active e-way bill is linked. A cancelled document number cannot be reported again. — [Zoho FAQ](https://zstatic.zohostatic.com/in/books/gst/faq/e-invoicing.html); [TaxGuru](https://taxguru.in/goods-and-service-tax/e-invoicing-compliance-note.html)

### Inferences
- Implement an "e-invoice applicable" flag on the GSTIN profile. When it is set and the buyer has a GSTIN, call the IRP (directly or via a GSP), get the IRN, Ack No. and signed QR, and print the QR. Block printing until the IRN is received, or queue it within the 30-day window if AATO >= Rs 10 cr.
- If e-invoicing applies but the invoice is B2C, print the Rule 46(s) declaration only where relevant (exempt categories). Plain B2C invoices need nothing extra below Rs 500 cr AATO.
- The 24-hour cancellation window means the POS must switch to credit notes for B2B corrections after 24 h.

### Gaps
- The Notf 14/2020 effective date (1 Dec 2020 per memory, with later penalty waivers) wasn't verified in this session.

## 5. E-way bill

### Takeaway
An e-way bill is needed when a consignment worth more than Rs 50,000 (including tax, excluding exempt goods) moves by motor vehicle. This covers branch and stock transfers, home deliveries and sales returns. Intra-state limits vary by state.

### Cited Findings
- Rule 138: required where consignment value exceeds Rs 50,000, for supplies and for movements "for reasons other than supply" (branch/stock transfers). Value = invoice value including taxes, excluding exempt goods. Sales returns are covered (sub-type "Sales Return"). — [ClearTax](https://cleartax.in/s//eway-bill-gst-rules-compliance)
- Validity: 1 day per 200 km (regular cargo). Part B (vehicle) isn't needed for movement under 50 km within the state between the consignor/consignee and the transporter. Goods moved by non-motorised conveyance (hand cart) are exempt. Goods in the Annexure to Rule 138(14) are exempt. — [ClearTax](https://cleartax.in/s//eway-bill-gst-rules-compliance)
- Intra-state thresholds are set by states (for example, West Bengal cut its limit from Rs 1 lakh to Rs 50,000 from 1 Dec 2023). Sources conflict on current figures for Bihar and Jharkhand. — [ClearTax state-wise](https://cleartax.in/s/state-wise-threshold-limits-e-way-bills); [Taxo state list PDF](https://taxo.online/wp-content/uploads/2025/02/Statewise-Threshold-e-way-bill.pdf)

### Inferences
- POS triggers: (a) a delivery challan or stock transfer between branches/godowns over the threshold; (b) a home-delivery invoice over the threshold sent by motor vehicle; (c) a bulk B2B sale dispatched by the store. Counter sales carried away by the customer usually don't need one from the seller. Keep a configurable per-state intra-state threshold table.
- Stock transfers to a branch under the same GSTIN need a delivery challan (Rule 55, not verified) plus an e-way bill. Transfers to a different GSTIN (another state) are taxable supplies needing a tax invoice.

### Gaps
- No official confirmation of current state-wise intra-state limits. Rule 55 delivery challan text wasn't checked.

## 6. Credit/debit notes, returns, cancellation

### Takeaway
Handle returns and post-sale price reductions with a Section 34 credit note linked to the original invoice. It must be issued and declared by 30 November after the FY of supply, or by the annual-return filing date if earlier.

### Cited Findings
- Credit note deadline: 30 Nov following the end of the FY of supply, or the date of furnishing the annual return, whichever is earlier. Inserted by Finance Act 2022, in force from 1 Oct 2022 (Notf 18/2022-CT, 28 Sep 2022). The same cutoff applies to declaring it in the return under s.34(2). — [VJM Global](https://www.vjmglobal.com/blog/9-gst-amendment-effective-from-1st-october-2022-finance-act-2022); [TaxGuru](https://taxguru.in/goods-and-service-tax/latest-gst-amendments-september-2022.html)
- Commentators debate whether the tax adjustment cutoff differs from the issue cutoff (Nasscom view). — [Nasscom](https://community.nasscom.in/communities/policy-advocacy/gst-representation-notification-sections-finance-act-2022)
- E-invoiced documents: cancel the IRN within 24 h; after that, issue a credit note (also reported to the IRP). — [Zoho FAQ](https://zstatic.zohostatic.com/in/books/gst/faq/e-invoicing.html)

### Inferences
- A credit note needs its own number series (16-character rule, unique per FY), the original invoice number and date, the reason, and the tax reversed at the original rate. Even after a rate change, use the rate on the original invoice.
- B2C returns: issue a credit note against the original bill (or the daily consolidated invoice). Restore the item to stock.
- "Cancelled" invoices: GST has no provision to delete an issued invoice. Mark it cancelled before the return is filed, keep it in the series, and report it in Table 13 "cancelled". After filing, use a credit note.

### Gaps
- Rule 53 (credit/debit note particulars) wasn't fetched. There's no official guidance on POS "void" before goods leave.

## 7. Rounding, tax-inclusive MRP, back-calculation

### Takeaway
MRP must include all taxes, and the store cannot charge more than MRP. The POS therefore back-calculates taxable value from the inclusive price. I found no single GST rule fixing invoice rounding.

### Cited Findings
- LMPC Rule 6(1)(e), as amended by G.S.R. 779(E) (2 Nov 2021): "The retail sale price of the package shall clearly indicate that it is maximum retail price inclusive of all taxes in Indian currency". The earlier rounding-to-nearest-rupee/50-paise illustration was removed. — [TaxGuru](https://taxguru.in/corporate-law/key-highlights-legal-metrology-packaged-commodities-amendment-rules-2021.html); [SS Rana](https://ssrana.in/articles/centre-amends-legal-metrology-rules/)

### Inferences
- Back-calculation: taxable value = inclusive price x 100 / (100 + rate). Tax = inclusive price - taxable value. CGST = SGST = tax / 2, with a residual-paisa adjustment so CGST + SGST + taxable value equals the line total exactly. Compute per line to 2 decimals, then sum.
- Round-off: show "Round off" as a separate line to the nearest rupee on the bill total. Keep invoice values in paise in the data model. Guard against discounts that push the post-discount price above MRP. Block the sale if the price is above MRP (except pricing below MRP).
- Discounts shown on the invoice reduce the taxable value (Rule 46(k)), so apply the discount before tax.

### Gaps
- No primary source found for invoice-level rounding rules (CBIC has no specific rule; s.170 rounds only tax/interest payable to the government). Treat round-off as practice, not law.

## 8. GST 2.0 rate rationalisation (22 Sep 2025), cess, rate changes on existing stock

### Takeaway
From 22 Sep 2025 (Notf 9/2025-CT(Rate), 17 Sep 2025), goods rates moved to 5%/18%/40%, and compensation cess fell to nil on most goods but continued on tobacco. Stock already in hand had to be billed at the new rate with revised MRPs. The Legal Metrology relaxation for revised-MRP stickers ran to 31 Dec 2025.

### Cited Findings
- Notf 9/2025-Central Tax (Rate), dated 17 Sep 2025, effective 22 Sep 2025, replaces 1/2017-CT(Rate) as the complete goods rate schedule. The slabs are 5%, 18% and 40% (40% is a de-merit rate). — [EY alert](https://www.ey.com/en_in/technical/alerts-hub/2025/09/cbic-issues-notifications-giving-effect-to-the-recommendations-made); [TaxHeal on IGST 9/2025](https://www.taxheal.com/?p=104994)
- Compensation cess was reduced to nil on goods such as motor vehicles and caffeinated beverages. On tobacco products it continued until the cess loans are repaid, with new rates "at a later date to be notified". — [GST Council FAQ](https://gstcouncil.gov.in/sites/default/files/2025-09/faq.pdf); [EY](https://www.ey.com/en_in/technical/alerts-hub/2025/09/cbic-issues-notifications-giving-effect-to-the-recommendations-made)
- Notf 9/2025-CT(Rate) was later amended to align tariff entries with Finance Act 2026, w.e.f. 1 May (2026). — [TaxGuru rate notifications list](https://taxguru.in/type/central-tax-rate-notifications/)
- DoCA (Legal Metrology), 9 Sep 2025: manufacturers, packers and importers could declare revised MRP on unsold stock made before 22 Sep 2025 by stamping, sticker or online printing until 31 Dec 2025 or stock exhaustion. The original MRP had to remain visible. On a rate cut, the revised MRP could not exceed the tax-reduced price. An 18 Sep 2025 advisory made re-stickering optional. Sources conflict on whether the two-newspaper-ad requirement was waived. The relaxation was challenged in the Karnataka HC (WP 27926/2025). — [SS Rana](https://ssrana.in/articles/government-relaxes-lmpc-compliance-after-gst-rate-revisions/); [TaxGuru](https://taxguru.in/goods-and-service-tax/govt-mrp-revision-unsold-gst-affected-stock.html); [Business Today](https://www.businesstoday.in/latest/economy/story/govt-allows-use-of-old-mrps-till-dec-but-firms-must-pass-on-gst-cuts-493267-2025-09-09)

### Inferences
- The rate master must be date-effective (HSN -> rate, with valid_from and valid_to). The tax rate follows the time of supply (the invoice date), not the purchase date. Stock bought at 12% and sold after 22 Sep 2025 is billed at the new rate.
- Keep per-batch MRP. Support "old MRP / revised MRP" on a batch, and bill at the lower of the revised MRP and the selling price.
- Retailers on a rate cut must pass the cut on (anti-profiteering expectations). The price-revision tool should recompute the inclusive price at the new rate.
- Cess: remove the cess column from most items after 22 Sep 2025. Keep cess support for tobacco and related items.

### Gaps
- No official extension of the 31 Dec 2025 sticker relaxation found. The exact Finance Act 2026 tariff changes (1 May 2026) weren't checked. The current status of tobacco compensation cess in 2026 wasn't verified in this session.

## 9. Legal Metrology: MRP, unit sale price, loose goods, weighing scales

### Takeaway
Packaged goods must carry an all-inclusive MRP and a unit sale price, and nothing may be sold above MRP. Weighing instruments used in trade must be verified and stamped (LM Act 2009 s.24); using an unverified one is an offence under s.33.

### Cited Findings
- LMPC (Amendment) Rules 2021, G.S.R. 779(E), 2 Nov 2021: MRP inclusive of all taxes in Indian currency (r.6(1)(e)); new mandatory unit sale price (for example, per gram for quantities under 1 kg and per kg at 1 kg or more; per ml/per litre likewise); Rule 5 standard package sizes omitted. — [TaxGuru](https://taxguru.in/corporate-law/key-highlights-legal-metrology-packaged-commodities-amendment-rules-2021.html); [Taxmann](https://www.taxmann.com/post/blog/lmpc-amendment-rules-2021-towards-a-business-friendly-environment/)
- Commencement was deferred: 1 Apr 2022 -> 1 Oct 2022 -> 1 Dec 2022 -> 1 Jan 2023. Separately, SS Rana reports a 2022 amendment effective 1 Apr 2023 (likely a different amendment; conflict unresolved). — [Mondaq](https://www.mondaq.com/india/food-and-drugs-law/1258964/legal-metrology-amendment-rules-to-come-into-force-on-january-01-2023); [SS Rana](https://ssrana.in/?p=30667)
- LM Act 2009: "weight or measure" includes a weighing or measuring instrument. Section 24 governs verification and stamping. Section 33 penalises use of an unverified weight or measure (one commentary: Rs 2,000-10,000 for a first offence; possibly revised by the Jan Vishwas Act 2023). Covered instruments include non-automatic weighing instruments of class III/IIII up to 150 kg. — [India Code LM Act](https://www.indiacode.nic.in/bitstream/123456789/6927/1/legal_metrology_act_2009.pdf); [SS Rana](https://ssrana.in/articles/verification-of-weights-measures-legal-metrology-act/); [Corpbiz](https://corpbiz.io/learning/stamping-verification-of-measures-and-weights-under-legal-metrology/)

### Inferences
- POS: hold MRP per batch. Block or warn when the selling price exceeds MRP. Print MRP and the "you saved" amount on the bill (customary, not mandatory).
- Loose goods (rice, dal, vegetables) are sold by weight from a verified scale. Integrate scale weights or barcode weights (embedded-price EAN-13 labels). Record qty to 3 decimals in kg. Store the scale's verification certificate number and next-due date, with an expiry alert.
- Apparel: MRP labels must show the inclusive MRP. Pieces are "NOS/PCS" with no unit price per gram (unit sale price per unit for items sold by number).

### Gaps
- The re-verification interval (commonly annual, set in the LM (General) Rules 2011/state rules) wasn't confirmed. No source was found on loose-commodity display rules (LMPC rules mainly cover pre-packaged goods; e-commerce/retail display of loose goods isn't covered here).

## 10. FSSAI number on bills

### Takeaway
Since 1 Oct 2021, every food business (including kiranas and supermarkets selling food) must print its 14-digit FSSAI licence or registration number on cash receipts and bills.

### Cited Findings
- FSSAI order dated 8 Jun 2021, enforced w.e.f. 1 Oct 2021: mandatory 14-digit FSSAI licence/registration number on cash receipts, purchase invoices, cash memos and bills; GST e-way bills excluded. No new document is required; existing GST invoices can carry it. — [FSSAI order PDF](https://mail.fssai.gov.in/upload/advisories/2021/10/6156936ac80bbOrder_License_Number_Print_01_10_2021.pdf); [TaxGuru](https://taxguru.in/?p=789268); [Mondaq](https://www.mondaq.com/india/food-and-drugs-law/1085480/mandating-the-declaration-of-fssai-license-number-on-tax-invoices)
- One news report cites 2 Oct 2021; the official PDF says 1 Oct 2021. — [DTNext](https://www.dtnext.in/news/business/fssai-makes-mandatory-for-food-businesses-to-mention-fssai-licence-no-on-invoicebills-from-oct-1)

### Inferences
- Add an FSSAI number field to the store/branch profile (14 digits, validated). Print it in the bill header when the store sells food. Each branch has its own licence.

### Gaps
- None material.

## 11. Record retention, headings, GSTR-1 export, stock register

### Takeaway
Keep records for 72 months from the annual-return due date, or longer while a dispute is pending. Keep an item-wise stock account (Rule 56). Use the correct document heading. Build the GSTR-1 export with the tables listed in section 2.

### Cited Findings
- Section 36: books and records retained for 72 months from the due date of the annual return for that year. Example: FY 2020-21 with a due date of 31.12.2021 means retention to 31.12.2027. Extended if an appeal, revision or investigation is pending, and extended if the annual return due date is extended. — [TaxGuru](https://taxguru.in/?p=844337); [TaxGuru books & records](https://taxguru.in/goods-and-service-tax/books-accounts-records-gst.html); [TaxGuru](https://taxguru.in/?p=728663)
- Rule 56: stock account with opening balance, receipts, supplies, goods lost, stolen, destroyed, written off or gifted, and closing balance, item by item. — [Accountune](https://accountune.com/stock-reconciliation); [GSTZen Rule 56](https://gstzen.in/a/maintenance-of-accounts-by-registered-persons-cgst-rule-56.html)

### Inferences
- Make invoice/credit-note records immutable (append-only, audit trail; amendments as new documents). Retain them for at least 8 years from the FY end (the annual return falls due 31 Dec after FY end, plus 72 months), and support export or backup.
- Stock ledger: record write-offs, theft and damages as separate movement types. ITC reversal under s.17(5) applies to lost, stolen or destroyed goods (not verified here).
- Headings: "Tax Invoice" (regular), "Bill of Supply" (composition/exempt), "Credit Note"/"Debit Note", "Delivery Challan" (stock transfer).

### Gaps
- Rule 56 official text wasn't fetched. Electronic-record backup requirements (Rule 57) weren't checked.
