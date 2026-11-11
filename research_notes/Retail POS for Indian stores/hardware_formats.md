# Retail POS Hardware & Data Formats (India)

**Summary (read first)**
- **Barcodes:** support EAN-13 (Indian brand items start with GS1 India prefix 890), EAN-8, UPC-A/E and Code 128. Use the standard mod-10 check digit (weights 1 and 3). Treat prefixes 20-29 (and RCN-8 starting with 0 or 2) as restricted-circulation, store-internal codes. Route anything with prefix 2x through the scale-barcode parser before looking it up as a GTIN.
- **Scale barcodes:** there is no single Indian standard. GS1 leaves the layout of prefix-2 numbers to each country's GS1 office, and Indian POS products make it configurable. GoFrugal uses ordered fields: prefix length, item-code length, weight length and precision (for example `W` + 6-digit code + 5-digit grams). Zoho POS India uses prefix/SKU/weight/amount, each with a length and a precision. The POS needs a parser config with these fields: prefix(es), item-code start and length, value type (weight, price or qty), value length, decimals, and whether a check digit is present. Default to EAN-13 `2P IIIII VVVVV C`.
- **Label printers:** TSC TSPL `BARCODE x,y,"EAN13",h,readable,rot,narrow,wide,"12digits"`. At 203 dpi there are 8 dots/mm, so a 50x25 mm label is 400x200 dots and a 38x25 mm label is 304x200 dots. ZPL uses `^BE`. Send RAW bytes with Win32 `WritePrinter` (datatype "RAW") on Windows, and with USB bulk transfer or Bluetooth SPP on Android.
- **Cash drawer:** ESC/POS `ESC p m t1 t2` is `1B 70 00 19 FA` (pin 2) or `1B 70 01 19 FA` (pin 5), sent through the receipt printer.
- **Pole display:** Posiflex PD-2600 ships in **Noritake mode by default**. It supports ADM, Aedex, ESC/POS (Epson), Futaba, Noritake and UTC modes, chosen by DIP switch, and USB models can run as true USB or virtual COM. The CD5220 command set uses `ESC @` (init), `0C` (clear) and `ESC l x y` (move cursor).
- **Scanners:** on desktop, detect a keyboard-wedge scanner by timing. Scanners typically send keys under about 30 ms apart and finish with Enter. On Android POS, Sunmi sends broadcast `com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED` with the extra `data`. Sunmi's built-in printer is reached through AIDL `woyou.aidlservice.jiuiv5`, which offers `sendRAWData`, `printBarCode` and `openDrawer`.

---

## 1. Barcode symbologies: EAN-13 (GS1 India 890), EAN-8, UPC-A/E, Code 128; check digit; restricted prefixes 20-29

### Takeaway
EAN-13 with the mod-10 check digit is the core format. Indian-registered products carry prefix 890. Prefixes 20-29 (and 02 / 04 in some schemes) are restricted-circulation numbers (RCNs) for in-store use, including variable-measure (scale) items. RCNs may only be encoded in EAN-8, EAN-13, UPC-A or UPC-E.

### Cited Findings
- A VMN-13 is a 13-digit Restricted Circulation Number encoded in an EAN-13 symbol so variable-measure items can be scanned at POS. Its rules are set per target market and tied to GS1 prefix 2 (20-29). RCNs SHALL only be encoded in EAN-8, EAN-13, UPC-A or UPC-E, and SHALL NOT use Application Identifiers. RCN-8 begins with GS1-8 prefix 0 or 2. Search snippets note one GS1 document says the VMN-13 definition conflicts with the prefix table, so check the current GenSpecs. — [GS1 GSCN 23-006 RCN](https://www.gs1.org/docs/barcodes/GSCN-23-006-RCN.pdf); [GS1 General Specifications](https://ref.gs1.org/standards/genspecs/)
- Variable-measure items not scanned at POS use a GTIN-14 with indicator digit 9, and the weight goes in AI 310n (net weight in kg) and AI 392n/393n (price). That is GS1-128/DataMatrix territory, not EAN-13. — [GS1 General Specifications](https://ref.gs1.org/standards/genspecs/) (via search snippet)
- GS1 India publishes a user manual covering numbering and prefix 890 allocation for Indian companies. — [GS1 India global user manual](https://gs1india.org/media/global-user-manual1.pdf)
- GS1 check digit method (standard): starting from the rightmost data digit, multiply digits alternately by 3 and 1, sum the results, and take the check digit as (10 - (sum mod 10)) mod 10. — [GS1 check digit calculator / method](https://www.gs1.org/services/how-calculate-check-digit-manually)

### Inferences
- **EAN-13 check digit algorithm (implementable):** For 12 data digits d1..d12 counted from the left, `sum = (d1+d3+d5+d7+d9+d11) + 3*(d2+d4+d6+d8+d10+d12)` and `check = (10 - sum % 10) % 10`.
  - Worked example: `890123456789` gives odd positions 8+0+2+4+6+8 = 28 and even positions 9+1+3+5+7+9 = 34, so 34×3 = 102. The sum is 130 and the check digit is **0**, giving `8901234567890`.
- **The same function covers EAN-8 (7 data digits), UPC-A (11 digits) and GTIN-14.** Weight the digits right to left starting with 3 (rightmost data digit ×3, next ×1, and so on).
- **UPC-E** must be expanded to UPC-A before validating or looking it up. Normalise every scanned retail code to GTIN-14 (left-pad with zeros) as the database key, so UPC-A `0xxxxxxxxxxx` and its EAN-13 `00xxxxxxxxxxx` match.
- **Code 128** has no GS1 mod-10 check. Its mod-103 check character is internal to the symbol, and scanners strip it. Use Code 128 for internal SKUs, batch codes, and Indian shops' own alphanumeric item codes, which are common in apparel.
- **Classification rule for scanned codes:**
  - 13 digits with prefix `20`-`29` → in-store or scale code; run the scale parser.
  - 8 digits with prefix `0` or `2` → RCN-8, internal.
  - Prefix `890` → Indian GTIN.
  - Anything else → global GTIN lookup.
- **Internal SKU barcodes:** if the POS generates EAN-13s for unbranded loose goods, use prefix `2x` that does not clash with the scale prefix configuration (for example, scale uses `21`/`22` and internal SKUs use `29`).

### Gaps
- I did not fetch the GS1 India page that confirms India-specific rules for the 20-29 range (for example, whether GS1 India has defined an official VMN-13 layout). As far as I found, none is published, which is why vendors make the layout configurable.

---

## 2. Weighing-scale barcode layouts (GS1 variable measure + Indian scale and POS configuration)

### Takeaway
Indian label scales (Essae Teraoka, CAS, Mettler Toledo, Aczet) print a configurable "flag + item/PLU code + weight or price + check" barcode. Indian POS products (GoFrugal, Zoho POS, ERPNext add-ons, OSPOS) let the user define prefix, code length, value length and decimals. Build a field-based parser, not one fixed layout.

### Cited Findings
- **GoFrugal RPOS7 weighable-item profile.**
  - Fields: Item Code, Wt-Weight Prefix, Wt-Weight, each with Order and MaxLength, plus a Precision setting.
  - Example: prefix order 1 and length 1; item code order 2 and length 6; weight order 3 and length 5; precision 3. Checkboxes "Enable Weighing Scale" and "Remove Paisa in Selling Price".
  - Example barcode `W00319801500` is prefix `W`, item `003198`, weight `01500`, which is 1 kg 500 g.
  - Countable items use the `U` prefix with a quantity field.
  - GoFrugal's layout has no price-embedded field. — [GoFrugal barcode profile config](https://community.gofrugal.com/portal/en/kb/articles/configuration-of-a-barcode-profile-for-weighing-scale-rpos7); [GoFrugal weighing scale barcode](https://community.gofrugal.com/portal/en/kb/articles/how-to-configure-barcode-weighing-scale-for-rpos7)
- **Zoho POS (India).**
  - Fields: Prefix (length; must be unique across configurations, for example `1234`, `W123`, `WW12`), SKU (length), Weight (max length and precision) and Amount (max length and precision).
  - Weight with length 4 and precision 2: `0205` = 2.05 kg.
  - Amount with length 5 and precision 2: `12350` = ₹123.50.
  - Sample: `W12123450200` is prefix `W12`, SKU `12345`, weight `0200` = 2.00 kg.
  - The help page does not mention the check digit. — [Zoho POS embedded barcode](https://www.zoho.com/en-in/pos/resources/help/embedded-barcode.html)
- **OpenSourcePOS token syntax.**
  - Tokens: `{I:n}` item, `{W:n}` weight (divided by 1000 by default), `{P:n}` price (cents not counted by default), `\d` ignored digit, plus literal prefixes.
  - Examples: `02{W:5}{I:6}`. EAN-13 `2000021019409` is parsed with `20{I:4}\d{P:5}\d`: literal `20`, item `0002`, a price-check digit `1` (ignored), price `01940`, and check digit `9`. — [OSPOS weighted barcodes](https://github.com/opensourcepos/opensourcepos/wiki/Weighted-Barcodes/Configuration)
- **ERPNext** has no documented core scale-barcode feature. A community Frappe app ("scale", ERPGulf) adds a "Scale Settings" doctype with prefix, item code, weight and price settings. — [bunty9148/scale (GitHub)](https://github.com/bunty9148/scale); [Frappe forum thread](https://discuss.frappe.io/t/which-are-barcode-label-weight-scale-compitible-with-erpnext/69318)
- **Marg ERP:** the only setting found is Control Room > "barcode/qty separator" (for example `1234/10` loads qty 10). I found no Marg page documenting scale-barcode parsing. — [Marg Care](https://care.margcompusoft.com/margerp/inventory/180894/1/inftrees)
- **General vendor guidance:** a typical layout is a 7-digit product code plus a 5-digit weight plus a check digit. The product code stored in the item master must exactly match the digits the scale prints, including leading zeros. Rice Lake recommends printing a test label and comparing the human-readable digits to confirm the format. Ishida/Rice Lake scales append the EAN check digit automatically. — [Enerpize scale docs](https://docs.enerpize.com/?p=4430); [Rice Lake: determining barcode formats](https://www.ricelake.com/media/xa0nhect/tb_determining_barcode_formats.pdf); [Rice Lake Ishida custom barcode](https://cms-prod.ricelake.com/resources/technical-bulletins/ishida-uni-5-uni-7-uni-9-custom-barcode-setup-167478/)

### Inferences
- **Recommended default EAN-13 layouts.** Indices are 0-based; positions are 1-based in the descriptions.
  - **A. Weight, 5-digit code (most common):** `F F I I I I I W W W W W C`. Prefix `21`, PLU 5 digits, weight 5 digits in grams (3 decimals, kg), then the EAN check digit.
    - Example: `21` + `00123` + `01250` gives `210012301250`. The sum is (2+0+1+3+1+5) + 3×(1+0+2+0+2+0) = 12 + 15 = 27, so the check digit is 3 → **`2100123012503`** = PLU 123, 1.250 kg.
  - **B. Price embedded:** same layout with the value as price in paise (2 decimals), for example `22 00123 04550 C` = ₹45.50.
  - **C. 6-digit code + 4-digit weight:** `F F I I I I I I W W W W C`, i.e. prefix 2 digits + 6-digit code + 4-digit weight + check.
  - **D. Variant with a price-check digit:** `2 F I I I I K V V V V C` (European style, as in the OSPOS example above). Some scales add an internal check digit over the value; the parser must be able to skip one position.
  - **E. Non-EAN layouts (GoFrugal style):** letter prefix with no check digit, e.g. `W` + 6-digit code + 5-digit value. These are printed as Code 128, not EAN-13.
- **Parser configuration fields** (one record per scale profile; allow several profiles matched by prefix):
  - `prefix` (string; one or more values, e.g. `21`,`22` or `W`)
  - `symbology` (`EAN13` / `CODE128`)
  - `item_start`, `item_len`
  - `value_kind` (`weight` | `price` | `qty`)
  - `value_start`, `value_len`, `value_decimals` (weight 3 = kg from grams; price 2 = rupees from paise)
  - `has_price_check_digit` (bool)
  - `validate_ean_check` (bool)
  - `item_lookup_mode` (match on PLU code field vs. item code, with or without stripping leading zeros)
- **Billing logic:**
  - Weight barcode: qty = weight and amount = qty × item rate.
  - Price barcode: amount = price and qty = price ÷ rate (round to 3 decimals).
  - For Legal Metrology/GST, keep both on the bill line.
  - If the scale's rate differs from POS rate, the shop decides which wins. Make this a setting, defaulting to "trust barcode price".
- **Indian scales:** Essae Teraoka (DS-852, DS-673 series), CAS (CL5200/CL3000) and Aczet label scales each let the user pick a barcode format, and a flag digit, from a list in the scale's setup menu or PC software. Configure the POS to match by scanning a test label. I could not verify exact format codes for these specific models.

### Gaps
- I found no publicly accessible Essae Teraoka, CAS India, Mettler Toledo or Aczet manual giving their exact barcode-format tables. The search for "Essae DS-852 barcode format" returned nothing relevant.
- GoFrugal's documentation shows only weight and qty fields, not price-embedded barcodes. Whether GoFrugal supports price-embedded barcodes is unverified.
- I found no official ERPNext or Marg documentation for field-level scale configuration.

---

## 3. Label printers: TSPL/TSPL2, ZPL II, Godex EZPL, TVS LP46; 50x25 and 38x25 mm; RAW printing on Windows and Android

### Takeaway
Most Indian shops use 203 dpi desktop thermal-transfer or direct-thermal label printers (TSC TE244/TTP-244, TVS LP46, Godex G500, Zebra GK/ZD). TSPL is the de facto common language. Generate TSPL and ZPL as plain ASCII strings and send them RAW. At 203 dpi (8 dots/mm), a 50x25 mm label is 400x200 dots and a 38x25 mm label is 304x200 dots.

### Cited Findings
- **TSPL BARCODE syntax:** `BARCODE x,y,"type",height,readable,rotation,narrow,wide,"data"`.
  - `readable`: 0 none, 1 below, 2 above, 3 both. `rotation`: 0/90/180/270.
  - Types include `"128"` and `"EAN13"`. For `"EAN13+2"`/`"EAN13+5"`, the data is exactly 12 payload digits plus the add-on, and the check digit is computed automatically.
  - Example: `BARCODE 50,200,"128",80,1,0,2,4,"ABC-12345"`. — [TSPL BARCODE reference](https://rfid-me.pages.dev/reference/tspl/barcode/); official manual: [TSC TSPL/TSPL2 Programming Manual](https://fs.tscprinters.com/system/files/31-0000001-00_tspl_tspl2_programming_3_0.pdf)
- **ZPL `^BE`** is the EAN-13 command in the ZPL II programming guide. — [Zebra ZPL ^BE](https://docs.zebra.com/us/en/printers/software/zpl-pg/c-zpl-zpl-commands/r-zpl-be.html). The page did not render its content when fetched; the syntax below is from the standard ZPL guide.
- **Windows RAW printing:** Microsoft documents sending raw bytes to a printer via the Win32 spooler: `OpenPrinter`, `StartDocPrinter` with `DOC_INFO_1.pDatatype = "RAW"`, `StartPagePrinter`, `WritePrinter`, `EndPagePrinter`, `EndDocPrinter`, `ClosePrinter`. — [Microsoft: Send raw data to a printer](https://learn.microsoft.com/en-us/troubleshoot/developer/dotnet/framework/general/send-raw-data-to-printer) (well-known; not re-fetched)

### Inferences (implementable examples; verify on hardware)
- **TSPL, 50x25 mm, 203 dpi** (400x200 dots, 2 mm gap). Each line ends with CRLF.
  ```
  SIZE 50 mm,25 mm
  GAP 2 mm,0 mm
  DIRECTION 1
  REFERENCE 0,0
  CODEPAGE 1252
  CLS
  TEXT 16,8,"2",0,1,1,"BASMATI RICE 1KG"
  TEXT 16,34,"2",0,1,1,"MRP Rs.125.00 (Incl. of all taxes)"
  BARCODE 40,64,"EAN13",80,1,0,2,2,"890123456789"
  PRINT 1,1
  ```
  - EAN-13 at narrow=2 dots is 95 modules × 2 = 190 dots, about 24 mm. With quiet zones (11 + 7 modules) it needs about 226 dots, so x=40 fits on a 400-dot label.
  - narrow=3 gives about 36 mm (339 dots with quiet zones). It fits only on the 50 mm label.
  - Font `"2"` is 12×20 dots.
  - Use `PRINT n` for copies.
- **TSPL, 38x25 mm** (304x200 dots): change to `SIZE 38 mm,25 mm` and use narrow=2. With quiet zones the barcode is 226 dots wide, so start at x ≈ 30-40. Keep text at font "1" (8×12) or "2" with short strings (about 25 chars at font 2 over 304 dots).
- **The rupee symbol "₹"** is not in TSPL's built-in fonts. Print "Rs." or use a downloaded TTF font (`TEXT ... "ARIAL.TTF"`) or a bitmap. Legal Metrology labels for packaged goods need MRP "incl. of all taxes", so keep MRP on the label.
- **Two-up stock (common in India, e.g. 2 × 38x25 across a 4" roll):** set `SIZE` to the full liner width (e.g. `SIZE 80 mm,25 mm`) and draw the second label offset by (38 + gap) × 8 dots.
- **ZPL II, 50x25 mm @ 203 dpi:**
  ```
  ^XA
  ^PW400^LL200^LH0,0^CI28
  ^FO16,8^A0N,22,22^FDBASMATI RICE 1KG^FS
  ^FO16,34^A0N,22,22^FDMRP Rs.125.00^FS
  ^FO40,64^BY2^BEN,80,Y,N^FD890123456789^FS
  ^PQ1
  ^XZ
  ```
  - `^BEo,h,f,g`: orientation, height, print interpretation line, line above. Supply 12 digits; the printer computes the check digit.
  - For 38x25 mm use `^PW304`.
- **Godex EZPL (50x25 mm).** Not verified against the Godex manual in this session.
  ```
  ^Q25,3
  ^W50
  ^H10
  ^P1
  ^S3
  ^AD
  ^C1
  ^R0
  ~Q+0
  ^O0
  ^D0
  ^E18
  ~R200
  ^L
  AB,16,8,1,1,0,0,BASMATI RICE 1KG
  BE,40,64,2,4,80,0,1,890123456789
  E
  ```
  - `^Q` is label length,gap (mm); `^W` is width (mm); `^L` … `E` is the label body.
  - `BE` is the EAN-13 barcode command in EZPL. Godex printers also commonly support GZPL (ZPL emulation), which is the safer target.
- **TVS LP46 (Neo/Dlite):** TVS-E sells these as TSPL-compatible desktop label printers.
  - Recommendation: target **TSPL as the primary language**, with ZPL as the second. This covers TSC, TVS, most Chinese OEMs (Xprinter, HPRT, Gainscha), and Godex via GZPL.
  - I did not verify TVS LP46's command language from a primary source.
- **Android transport:**
  - **USB:** `UsbManager` → request permission → `openDevice` → claim the interface with a bulk OUT endpoint → `bulkTransfer(endpoint, bytes, len, timeout)` in chunks of 16 KB or less. USB class 7 is the printer class.
  - **Bluetooth Classic:** RFCOMM/SPP socket with UUID `00001101-0000-1000-8000-00805F9B34FB`, then write the bytes.
  - **Network:** raw TCP port 9100.
  - The same applies to ESC/POS receipt printers.
- **Electron/Windows:** call the winspool RAW API through a native addon (for example the `printer`/`@thiagoelg/node-printer` style), or write to a TCP 9100 socket for LAN printers. Do not use the HTML print path for labels, because GDI rasterisation blurs barcodes.

### Gaps
- I did not fetch the TVS LP46 programming manual or Godex EZPL manual. The EZPL example and the TVS language support need hardware verification.
- The Zebra ^BE page content did not load. The ZPL syntax above is from standard knowledge of the ZPL II guide.

---

## 4. ESC/POS receipt printers: cash drawer kick (ESC p)

### Takeaway
The cash drawer is wired to the receipt printer's RJ11/RJ12 DK port and opened with ESC/POS `ESC p m t1 t2` (`1B 70 m t1 t2`). TVS, Posiflex, Epson and almost all Indian-market thermal printers use the same bytes.

### Cited Findings
- Sunmi's built-in printer service exposes `openDrawer()` (no args) to fire the cash box from the device, and `sendRawData(byte[])` for passthrough of ESC/POS. — [Sunmi K2 Print Service Development Documentation](https://file.cdn.sunmi.com/SUNMIDOCS/Sunmi-k2-Print-Service-Development-Documentation.pdf)
- Epson ESC/POS command reference for `ESC p` (generate pulse). — [Epson ESC/POS reference: ESC p](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lp.html). The page returned HTTP 403 when fetched; the byte values below are the well-established standard.

### Inferences
- **`ESC p m t1 t2` = `1B 70 m t1 t2`**
  - `m` = 0 or 48 (`0x00`/`0x30`) selects drawer kick connector pin 2; `m` = 1 or 49 (`0x01`/`0x31`) selects pin 5.
  - On time is t1 × 2 ms; off time is t2 × 2 ms (if t2 < t1, off time = t1 × 2 ms).
  - Common values: `1B 70 00 19 FA` (50 ms on, 500 ms off), `1B 70 00 32 FA`, or `1B 70 00 3C FF`.
  - Send pin 2 by default, with a settings toggle for pin 5 (second drawer).
- **Alternative:** `DLE DC4 n m t` (`10 14 01 m t`) is the real-time pulse, useful when the printer is busy or offline. Fewer clones support it.
- Other useful ESC/POS commands:
  - `1B 40` — initialise
  - `1D 56 42 00` — feed and partial cut
  - `1B 74 n` — code page
  - `1D 6B 43 0D <13 digits>` — GS k EAN-13 barcode on the receipt
- Indian printers (TVS RP3160 Gold/Star, Posiflex PP-8800, Epson TM-T82) generally ship as USB printer-class devices with a Windows driver. Use RAW via winspool, as in section 3.

### Gaps
- I could not fetch the Epson ESC p page (HTTP 403), and I did not verify the TVS RP3160 manual for DK port pinout or the pin-2 default.

---

## 5. Customer pole display (VFD 2x20, e.g. Posiflex PD-2600)

### Takeaway
Pole displays are driven over a serial port (true RS-232 or USB virtual COM, typically 9600 8N1) using one of several command sets chosen by DIP switch. Implement **Epson ESC/POS display mode** and **CD5220** in the POS, and tell installers to set the DIP switches accordingly. The Posiflex PD-2600 ships in Noritake mode.

### Cited Findings
- **Posiflex PD-2600 series:**
  - Supports ADM, Aedex, ESC/POS, Futaba, Noritake and UTC command modes.
  - USB models are "True USB / Virtual COM selectable"; the PD-2600R is serial.
  - Factory default is **Noritake mode**; change it to **Epson mode if an OPOS/UPOS driver is used**.
  - OPOS/JPOS programs require Epson mode.
  - USB models must not be connected through a non-self-powered hub. — [Posiflex PD-2600 product page](https://www2.posiflex.com/en-global/product/index/Line-Display/PD_Standalone/PD-2600-Series); [PD-2600 manual: command mode selection](https://www.manualsdir.com/manuals/783712/posiflex-pd-2600.html?page=10)
- Posiflex provides a "USB Virtual Com Port WHQL Driver" for Windows 11/10/7 (v5.20, 2023) on its pole-display product pages. — [Posiflex PD-2800UE page](https://posiflex.com/product-detail/pd-2800ue)
- **CD5220 standard-mode commands:**
  - `ESC @` (`1B 40`) — initialise
  - `CLR` (`0C`) — clear display and string mode
  - `CAN` (`18`) — clear cursor line
  - `ESC l x y` (`1B 6C x y`) — move cursor to column x (1-20), row y (1-2)
  - `ESC W` — sets the window range
  - `ESC DC1` (`1B 11`) — overwrite mode
  - — [Epson CD5220 manual (manualsdir)](https://www.manualsdir.com/manuals/87094/epson-cd5220.html?page=15); [Birch DSP-840U manual (CD5220-compatible)](https://Scancode.ru/upload/iblock/e3a/dsp840u_operation_manual_tm970060.pdf)
- It is unclear whether the PD-2600 emulates CD5220, because CD5220 is not in Posiflex's list. — [Posiflex PD-2600](https://posiflex.com/product-detail/pd-2600)

### Inferences
- **Epson ESC/POS customer-display mode** (DM-D series compatible): `1B 40` initialise, `0C` clear, `1F 24 x y` move cursor (US $, x 1-20, y 1-2), `0B` home, then plain ASCII text.
  - Example "Total" screen:
    `1B 40 0C` + `"BASMATI RICE 1KG    "` + `1F 24 01 02` + `"TOTAL      Rs 125.00"`.
  - Pad each line to exactly 20 chars.
- **CD5220 equivalent:** `1B 40 0C` + line 1 text + `1B 6C 01 02` + line 2 text.
- **Connection:** open the COM port (Electron: `serialport` npm; Android: USB-serial via `usb-serial-for-android` for CDC/FTDI/Prolific/CH340). Use 9600 baud, 8N1, no flow control (Posiflex default; verify against the DIP table).
- **The "₹" glyph is not available on VFDs.** Use "Rs".
- Android POS terminals (Sunmi T2, iMin D-series) usually have a built-in secondary customer display (LCD) driven via Android `Presentation`/`DisplayManager` or the vendor SDK, rather than a VFD.

### Gaps
- I did not obtain the exact DIP switch table or default baud rate for the PD-2600 from the manual page.

---

## 6. Barcode scanners: keyboard-wedge detection (web/Electron), Android POS scanner intents and printer APIs

### Takeaway
On Windows, USB scanners in India (Honeywell, Zebra, TVS BS-L, Retsol) are almost always HID keyboard-wedge devices with an Enter (CR) suffix. Detect them by keystroke timing. On Android POS terminals, use the vendor broadcast intent (Sunmi: `com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED`, extra `data`) instead of keystrokes. Print through the vendor AIDL service, or send ESC/POS raw bytes through it.

### Cited Findings
- **Sunmi scanner:**
  - Register a receiver for action `com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED` and read the String extra `data`. A `byte[]` extra (`source_byte`) is available from scanner service v2.3.1 or later.
  - Broadcast output mode must be enabled, either in settings or by sending the `com.sunmi.scanner.ACTION_BAR_DEVICES_SETTING` intent with output type 2.
  - Source text is OCR-garbled in places; verify the constants. — [Sunmi Barcode Scanner User Guide](https://file.cdn.sunmi.com/SUNMIDOCS/Barcode-Scanner-User-Guide-20201202.pdf); [Sunmi L2/P2 Lite manual](https://manualmachine.com/sunmi/l2/20169095-user-manual)
- **Sunmi built-in printer:**
  - AIDL service package is `woyou.aidlservice.jiuiv5`; declare it in a `<queries>` block in AndroidManifest for Android 11+.
  - Methods include `sendRawData(byte[])` (ESC/POS passthrough), `printBarCode(String code, int symbology, int height, int width, int textPosition)` (parameter order differs between docs and wrappers) and `openDrawer()`. — [Sunmi K2 print service doc](https://file.cdn.sunmi.com/SUNMIDOCS/Sunmi-k2-Print-Service-Development-Documentation.pdf); [Sunmi built-in printer developer doc (EN)](https://file.cdn.sunmi.com/SUNMIDOCS/%E5%95%86%E7%B1%B3%E5%86%85%E7%BD%AE%E6%89%93%E5%8D%B0%E6%9C%BA%E5%BC%80%E5%8F%91%E8%80%85%E6%96%87%E6%A1%A3EN-0224.pdf); [SunmiV2 Android Library](https://github.com/asannov/SunmiV2-Android-Library)
- Maintained wrappers exist for Flutter (`sunmi_printer_plus`), React Native and Capacitor. — [sunmi_printer_plus](https://pub.dev/documentation/sunmi_printer_plus/2.1.2/); [capacitor-sunmi-printer](https://github.com/kduma-autoid/capacitor-sunmi-printer)
- For comparison, Zebra DataWedge also uses a configurable intent output (action string and extras defined in the profile). — [Zebra DataWedge: receive scanned data](https://techdocs.zebra.com/datawedge/11-0/guide/samples/tutorial-ReceiveScannedData/)

### Inferences
- **Keyboard-wedge detection (web/Electron).** Use a global `keydown` listener in capture phase:
  - Append printable `e.key` chars to a buffer and record `performance.now()`.
  - If the gap since the previous key exceeds about 50 ms (configurable 30-80 ms), reset the buffer.
  - On `Enter` (or `Tab`, configurable) with buffer length ≥ 6 and a mean inter-key interval below about 30 ms, treat the buffer as a scan: `preventDefault`, call `onScan(buffer)`, and clear the buffer.
  - Humans type at about 100-250 ms per key; scanners usually send keys 1-15 ms apart.
  - Also support an optional prefix char (e.g. configure the scanner to send F12 or STX) for 100% reliable detection.
  - Ignore the logic when focus is in a text field that explicitly wants raw typing, or route the scan to the item-lookup field anyway.
  - On Windows, a non-US keyboard layout can garble digits, so tell installers to set scanners to the US layout.
- **Electron alternative:** read the scanner as raw HID through `node-hid` or WebHID, or set the scanner to USB-COM (CDC) mode and read with `serialport`. This avoids focus problems; offer it as an advanced option.
- **Android without a vendor SDK:** most POS devices also offer keyboard-wedge output. In an Android WebView/Capacitor app, the same timing logic works via `dispatchKeyEvent`. Prefer broadcast mode for reliability.
- **PAX and iMin:** these vendors use similar broadcast or SDK approaches (iMin: `com.imin.scanner.api.RESULT_ACTION`-style broadcast and the iMin printer SDK; PAX: NeptuneLite / PAX scanner SDK). These were not verified this session; make the scanner action string and extra name configurable settings so new devices can be supported without a code change.

### Gaps
- I did not fetch PAX or iMin developer documentation, so their exact broadcast action names and printer SDK method names are unverified.
- I found no authoritative source for inter-key timing thresholds. The 30/50 ms values are common practice, not a published spec.
