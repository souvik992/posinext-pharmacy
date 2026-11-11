# Checkout UX and Complaints: Indian Retail POS

**Summary (read first).** I used 15 searches and fetches. Several review pages (Capterra, SoftwareAdvice) returned 403, so most complaint quotes below come from search-result excerpts of those pages, not from full-page reads. Where a finding comes from a vendor, it is marked as such.
- **Most common user complaints:** data loss or mismatched entries (Vyapar), offline billing that does not work or was withdrawn (myBillBook), slow desktop or workflow at busy counters (Vyapar, GoFrugal when idle, slow backup on exit), and support that is slow or only an AI bot (all vendors). Printer complaints were rare and specific to certain setups.
- **Shortcut patterns in Indian billing software:**
  - F-keys are configurable (GoFrugal RetailEasy7).
  - One key saves, one clears the screen, Ctrl+F3 cancels the bill.
  - Delete removes a line.
  - Hold/Recall is a standard feature.
  - Marg lets the quantity be read from inside the barcode (a separator such as "/" or a prefix), lets you paste several barcodes at once, and uses * to mark returned lines.
- **Weighing-scale barcodes:** there is no single prefix standard (SAP, Odoo and Lithos each use different prefixes). The POS needs per-scale profiles: prefix, SKU length, and weight or price length with its decimal places. A decimal mismatch causes pricing errors (Zoho).
- **Scanners:** a keyboard-wedge scanner types into whichever field has focus, so a cursor in the wrong field silently loses scans. The scanner's own beep cannot reflect what the app did with the scan, so the error sound must come from the software.
- **Not found within budget:** numeric bill-time or items-per-minute benchmarks for India, quick cash denomination designs, a primary source for capturing the customer's mobile number, Reddit threads, Khatabook/Busy complaints, and direct Play Store reviews.

## Checkout UX shortcuts and flows in Indian billing software

### Takeaway
Indian desktop billing software is keyboard-driven: F-keys, often reassignable, for save, clear and cancel; Delete to remove a line; Enter to open a lookup list; and Hold/Recall bills. Marg adds ways to enter quantity through the barcode and supports pasting several barcodes in a row. I found no documented numeric speed targets.

### Cited Findings
- **GoFrugal TruePOS keys:**
  - F6 saves the current function, such as a sales bill.
  - F7 shows existing records.
  - F9 clears all values on the screen.
  - F10 closes the screen.
  - CTRL+F3 cancels receipts, sales orders and bills.
  - DELETE removes an item row.
  - ENTER opens the LOV (list of values) window, which has a "Search By" drop-down.
  - Bill-level discount sits in the right pane.
  - Tender types are cash, card, cheque, sale on credit and gift coupon/voucher, and the owner can choose which ones appear (Tools > Configuration > Business Configuration > Tender).
  - [GoFrugal community: Familiarizing with TruePOS](https://community.gofrugal.com/portal/en/kb/articles/familiarizing-with-truepos-29-1-2025)
- GoFrugal RetailEasy7 lets users reassign function keys for billing actions, including hold. [GoFrugal: Modify Function Keys in RetailEasy7](https://community.gofrugal.com/portal/en/kb/articles/how-to-modify-function-keys-in-retaileasy7)
- In GoBill (Windows), "Hold and Recall" parks the current bill, which can be brought back later through "Recall Bill". [GoFrugal: hold/recall in GoBill](https://community.gofrugal.com/portal/en/kb/articles/what-is-the-hold-recall-and-delivery-bill-in-gobill-windows)
- In Marg, quantity can be loaded from the barcode itself when the item is scanned or searched. The quantity is found by a separator such as "/", a fixed character position, or a prefix such as '12'; this is set in the Control Room. [Marg Care](https://care.margcompusoft.com/margerp/inventory/179436/1/How-to-search-Item-by)
- In Marg, several barcodes can be pasted into a sale bill and the items load one after another (option tied to F2). [Marg Care: multi barcode](https://care.margcompusoft.com/margerp/inventory/2769/1/How-to-enable-multi-bar-code)
- Marg uses the star (*) key during billing to mark items as returned; a report option prints the total of those returned items separately. [Marg Care](https://care.margcompusoft.com/margerp). Note: I found no evidence that * works as a "quantity × scan" multiplier in Marg.
- Marg can ask for a volume discount on the F2 key while billing. [Marg Care](https://care.margcompusoft.com/margerp/inventory/181716/1/how-to-enable-ask-volume-discount-on-f2-key-while-billing-in-marg-software)
- Third-party Marg shortcut list: Ctrl+W saves, Alt+N opens a sales voucher, Alt+C opens a sale challan. This is the blog author's own practice, not official documentation. [sewadiary blog](https://sewadiary.blogspot.com/2020/07/keyboard-shortcuts-in-marg-erp.html)
- Vendor claim (promotional): "slow billing during the busiest hours" is a daily failure for kiranas, and 60–70% of kirana transactions involve udhaar (credit). [commmerce.com blog](https://commmerce.com/blog/top-billing-software-indian-kirana-grocery-stores-2026/)

### Inferences
- Make every billing action reachable from the keyboard, and let users rebind keys, because cashiers who move over from GoFrugal or Marg will expect their old keys.
- Bill-level actions (save, clear, cancel, hold/recall, tender) need dedicated keys.
- Supporting both a "qty * scan" prefix and quantity embedded in the barcode covers the habits of both groups of users.
- Because udhaar (credit) is so common, "sale on credit to a customer" should be a first-class tender type, not a workaround.

### Gaps
- I found no source giving a numeric bill-time or items-per-minute target for Indian stores.
- I found no Indian vendor documentation on quick cash denomination buttons, on approval flows for price overrides, or on capturing the customer's mobile number at the till.
- Shortcut documentation for Vyapar, Busy, myBillBook and Zoho POS was not covered within the budget.

## Weighing-scale, loose and unbarcoded items

### Takeaway
Barcodes from weighing scales follow scale- or vendor-specific formats. A POS must support several configurable profiles (prefix, SKU length, weight or price length and decimal places) and must check that the barcode's decimal precision matches the item's unit decimals.

### Cited Findings
- **Zoho POS (India):**
  - Each embedded-barcode profile defines a prefix (unique across profiles), the SKU length, the weight length plus decimals, and the amount length plus decimals.
  - Example: W12123450200 is prefix W12, SKU 12345 and weight 0200, which is 2 kg at 2 decimals.
  - The weight precision must match the quantity decimal rate set for the item, or prices will be wrong.
  - Setup involves exporting weighable items to the scale's label generator.
  - [Zoho POS help](https://www.zoho.com/en-in/pos/resources/help/embedded-barcode.html)
- **Prefix conventions conflict between vendors:**
  - SAP: prefixes 21/22/23/27 carry a price and 28/29 carry a weight. [SAP Help](https://help.sap.com/doc/saphelp_pos23/2.3/en-US/5e/7ca28d23cc4ddf969366d803e00816/content.htm)
  - Odoo module: 21 + 6-digit product code + weight (2 whole digits, 3 decimals) is weight; 23 + product code + price (3 whole digits, 2 decimals) is price. [Odoo app](https://apps.odoo.com/apps/modules/9.0/pos_barcode_scan)
  - Lithos POS: default scale prefix is 9911 and can be customised. [Lithos help](https://help.lithospos.com/docs/settings/barcode-scale-label-scale)
- Vendor claim: GoFrugal markets combined billing of barcoded and weighed items in one POS. [GoFrugal](https://www.gofrugal.com/billing-software/barcode-weight-based-billing-pos.html)

### Inferences
- Ship ready-made profiles for scale brands common in India, with a test screen that decodes a sample barcode before it goes live.
- Reject a barcode, with an error sound, when its weight decimals and the item's unit do not match, rather than billing a wrong price.
- For loose items without a barcode: use a code or name lookup, then quantity in kg with decimals, or price-to-weight entry.

### Gaps
- I found no India-specific scale barcode standard and no data on which scale brands are most common.
- I found no evidence on how Indian POS products handle unbarcoded loose items, such as quick-key grids or PLU codes.

## Scanner input handling

### Takeaway
A keyboard-wedge scanner behaves like a keyboard: wrong focus, mismatched prefix or suffix, or keyboard-layout differences cause silent scan failures. The hardware beep cannot reflect what the app did, so the app must give its own feedback.

### Cited Findings
- **Silent failures and duplicates:** input focus errors, keyboard language mismatches, hidden prefix or suffix settings, and validation rules can silently reject valid scans. Duplicates come from shared barcodes or from workflows that allow repeat scans without validation. [JLCMC blog](https://jlcmc.com/blog/barcode-scanner-problem)
- The scanner's beep cannot be tied to the POS result, because "the barcode scanner is like a keyboard so it doesn't communicate with application directly." [PHP Point of Sale community](https://support.phppointofsale.com/hc/en-us/community/posts/28329397632788-Barcode-Scanner-Audible-Sound-Doesn-t-Align-with-POS)
- **Terminator characters vary by vendor:** AmigoPOS advises a special character after the scan and no carriage return [AmigoPOS](https://help.amigopos.com/barcode_scanner.htm); EBMS requires an F8 prefix and an F10 suffix [Koble/EBMS](https://koblesystems.com/knowledge/inventory/purchasing_a_barcode_scanner.htm).
- Bepoz SmartPOS added a "keyboard wedge threshold" (based on typing speed), which broke manual barcode entry followed by Enter after an upgrade. This shows the trade-off when telling scanner input apart from human typing. [Oolio/Bepoz KB](https://internal.oolio.com/bepoz/i-can-no-longer-enter-a-barcode-manually-and-press-enter-within-smartpos-after-i-have-upgrade-to-4.6.1.1-and-above-keyboard-wedge-threshold_50)

### Inferences
- **Capture scans globally:** detect a scan by keystroke timing or prefix and send it to the bill no matter which field has focus, but still allow manual code entry.
- **Software feedback:** play a distinct error sound and flash the screen for an unknown barcode.
- **Repeat scans:** treat a second scan of the same code within a short window as a quantity increment, with a visible line flash so the cashier notices, not as a silent duplicate line.

### Gaps
- I found no published debounce timings, and no India-specific accounts from cashiers about scanner problems.

## Real complaints (user evidence)

### Takeaway
The recurring user complaints are:
- data loss or mismatched entries, and weak recovery from it
- offline mode missing or unreliable, and mobile–desktop sync problems
- slowness on busy counters, after long idle periods, and during backup
- support that is unresponsive or bot-only

Printer and GST complaints appeared less often in what I could reach.

### Cited Findings
- **Vyapar:**
  - Five-year user "suddenly lost data, mismatched entries in previous records." [SoftwareAdvice](https://www.softwareadvice.com/accounting/vyapar-profile/reviews/)
  - Reviewer says records were lost after a year and support told them to redo the entry work; the data disappeared during yearly calculations, which then did not match. [GetApp](https://www.getapp.ca/software/2047570/vyapar)
  - App "hangs frequently"; WhatsApp invoices always arrive as blank files; "no proper solution even after long phone calls"; Capterra's own summary notes slow loading, mobile–desktop sync problems and data mismatch. Search excerpts only; the page returned 403. [Capterra](https://www.capterra.com/p/180579/Vyapar/reviews/)
  - "The workflow is terribly slow for fast-paced retail counters." [G2](https://www.g2.com/products/vyapar/reviews_and_filters)
  - "The desktop of this tool is little bit slow," December 2021. [SaaSworthy](https://www.saasworthy.com/product/vyapar/reviews)
  - Could not print a PO quotation because of limited printer compatibility. [SoftwareAdvice](https://www.softwareadvice.com/scm/vyapar-profile/reviews/)
  - Counterpoint: some G2 users say offline billing syncs automatically once the connection returns. [G2](https://www.g2.com/products/vyapar/reviews_and_filters)
- **myBillBook:**
  - "billing crashes, and offline billing is never possible." [Capterra](https://www.capterra.com/p/202732/FloBooks/reviews/)
  - App Store reviewer says the offline app was discontinued, although offline billing and sync were why they chose the product; also reports SMS not sending and the app getting stuck. Via an aggregator. [apptail](https://apptail.io/app/mybillbook-billing-software-xWB/india)
  - "sometimes little slow," which the reviewer blamed on the server. [GetApp](https://www.getapp.com.au/software/2056738/mybillbook)
  - Feature-board post (dated Jun 10, year not shown), no replies: "Every time I contact support, the AI assistant tells me that a human agent will connect with me within a few minutes… I was told that I was not calling from my registered mobile number, which is completely incorrect." [myBillBook featurebase](https://mybillbook.featurebase.app/p/very-disappointed-with-my-billbook)
- **GoFrugal** (search excerpts; page returned 403; many reviews from 2018–2021):
  - Support is slow to respond when a major issue arises and "takes ages to resolve an issue."
  - The software becomes very slow after being idle for a long time.
  - "Backup is very slow at the exit of the software."
  - Slow even on a high-spec machine; reports take a long time.
  - Praised for minimal design and fast billing. Capterra rating 4.4 from 198 reviews.
  - [Capterra](https://www.capterra.com/p/71693/GoFrugal-POS-Software/reviews/)

### Inferences
- **Data integrity is the top trust issue:**
  - Use an append-only local journal with checksums.
  - Run automatic local backups that do not block exit, plus off-device backups.
  - Provide a self-serve "restore to date" option.
- **Offline must be a core promise:** dropping offline mode is a reason customers leave.
- **Keep the app fast:** fast cold and warm starts after idle, with background tasks that never block the billing screen.
- **Support:** guaranteed access to a human, with phone verification that cannot lock out legitimate users.

### Gaps
- I found no Reddit India threads in search results, and did not reach Khatabook or Busy complaints or Play Store reviews directly.
- Specific complaints about wrong GST calculations and stock mismatch were not found apart from Vyapar's "data mismatch."

## Onboarding and owner mobile needs

### Takeaway
Importing item masters fails most often on HSN/GST data: missing or invalid HSN codes, HSN–tax-rate mismatches, and inconsistent item names or units. Evidence on bulk label printing and owner mobile apps was not reached.

### Cited Findings
- Excel import fails when HSN codes are missing or undefined ("Invalid Document" error); the fix is to import the HSN codes first or create them manually. [Logic ERP KB](https://kb.logicerp.com/logic-erp-installation-configuration-and-troubleshooting-solutions/troubleshooting/purchase/hsn-code-error-in-purchase-import)
- Busy: imported items can carry a tax rate that does not match the HSN's defined rate; Busy suggests online HSN validation and notes that columns can map incorrectly. [Busy FAQ](https://busy.in/faqs/data-conversion/voucher-import-export/25/)
- Tally: a non-unique combination of HSN code and description causes errors in the GST offline tool and on the GST portal. [Tally Help](https://help.tallysolutions.com/article/te9rel61/Tax_India/gst/gst_issues_offline_portal.htm)
- Before importing, standardise names, units, HSN codes and GST rates, and keep a mapping sheet. Example: "LED BULB 12W" versus "LED Bulb 12 Watt." Consultant blog with SEO content. [tallyatcloud](https://tallyatcloud.com/article/excel-to-tally-sales-import-complete-step-by-step-guide-for-accurate-data-migration/805/0/1)

### Inferences
- The import wizard should:
  - validate HSN codes and their rates before committing
  - fuzzy-match duplicate item names and units
  - preview errors row by row
  - be able to re-run safely without creating duplicates

### Gaps
- Not covered: bulk label printing complaints, cashier training time, and owner mobile needs (remote sales view, alerts).
