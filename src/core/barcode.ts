// Barcodes for retail: GS1 check digits (EAN-13/8, UPC-A/E), GTIN-14 lookup keys, and weighing-scale barcodes.
// Pure functions, no database. docs/BARCODES.md has the layouts and where they come from.

/** GS1 check digit for the data digits (everything but the check digit): weights 3,1,3,... from the right. */
export function gs1CheckDigit(data: string): number {
  if (!/^\d+$/.test(data)) throw new RangeError('barcode data must be digits');
  let s = 0;
  for (let i = data.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) s += Number(data[i]) * w;
  return (10 - (s % 10)) % 10;
}

/** A full GS1 code (EAN-8, UPC-A 12, EAN-13, GTIN-14) with a correct check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** UPC-E (8 digits: number system, 6 digits, check) to its UPC-A (12 digits); null when it is not a UPC-E. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const n = code[0]!, d = code.slice(1, 7), c = code[7]!;
  const last = Number(d[5]);
  let body: string;
  if (last <= 2) body = `${d[0]}${d[1]}${d[5]}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === 3) body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === 4) body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d.slice(0, 5)}0000${d[5]}`;
  const a = `${n}${body}${c}`;
  return isValidGtin(a) ? a : null;
}

/** The lookup key for a GS1 code: 14 digits with leading zeros (UPC-E expanded first); null when not a valid GTIN. */
export function gtin14(code: string): string | null {
  const c = code.length === 8 && /^[01]/.test(code) && !isValidGtin(code) ? expandUpcE(code) : code;
  if (!c || !isValidGtin(c)) return null;
  return c.padStart(14, '0');
}

/** Builds an EAN-13 for an in-store code: a restricted-circulation prefix (20-29) plus digits, with its check digit. */
export function makeEan13(first12: string): string {
  if (!/^\d{12}$/.test(first12)) throw new RangeError('EAN-13 needs 12 data digits');
  return first12 + String(gs1CheckDigit(first12));
}

// ---------------------------------------------------------------- weighing-scale barcodes

/**
 * Where a scale puts the item code and the weight (or price) in its barcode. India has no standard layout, so every
 * shop sets one up to match its scale (Settings > Scale barcodes); positions are 0-based.
 * Default "A": 21 IIIII WWWWW C  ->  2100123012503 = item 00123, 1.250 kg.
 */
export interface ScaleProfile {
  id: string;
  name: string;
  /** Codes starting with one of these are read with this profile, e.g. ["21"] or ["W"]. */
  prefixes: string[];
  /** Exact length of the code, e.g. 13 (EAN-13) or 12 (a Code 128 label without a check digit). */
  length: number;
  itemStart: number;
  itemLen: number;
  /** weight: kilograms with `valueDecimals` decimals; price: rupees with `valueDecimals` decimals; qty: pieces. */
  valueKind: 'weight' | 'price' | 'qty';
  valueStart: number;
  valueLen: number;
  valueDecimals: number;
  /** The last digit is a GS1 check digit and must be right (EAN-13 labels). */
  checkDigit: boolean;
}

export interface ScaleRead {
  profileId: string;
  /** The item code as printed (leading zeros kept); look it up by PLU. */
  itemCode: string;
  valueKind: ScaleProfile['valueKind'];
  /** weight / qty: thousandths (1.250 kg = 1250); price: paise. */
  value: number;
}

export const DEFAULT_SCALE_PROFILES: ScaleProfile[] = [
  { id: 'gs1-21-weight', name: 'Weight: 21 + item 5 + kg 5 (3 decimals) + check', prefixes: ['21'], length: 13, itemStart: 2, itemLen: 5, valueKind: 'weight', valueStart: 7, valueLen: 5, valueDecimals: 3, checkDigit: true },
  { id: 'gs1-22-price', name: 'Price: 22 + item 5 + rupees 5 (2 decimals) + check', prefixes: ['22'], length: 13, itemStart: 2, itemLen: 5, valueKind: 'price', valueStart: 7, valueLen: 5, valueDecimals: 2, checkDigit: true },
];

export function validateScaleProfile(p: ScaleProfile): string[] {
  const e: string[] = [];
  if (!p.prefixes.length || p.prefixes.some((x) => !/^[0-9A-Z]{1,4}$/.test(x))) e.push('Each prefix is 1 to 4 letters or digits.');
  if (!Number.isInteger(p.length) || p.length < 6 || p.length > 20) e.push('Barcode length must be 6 to 20.');
  const end = p.length - (p.checkDigit ? 1 : 0);
  const fits = (s: number, l: number) => Number.isInteger(s) && Number.isInteger(l) && s >= 0 && l >= 1 && s + l <= end;
  if (!fits(p.itemStart, p.itemLen)) e.push('The item code does not fit in the barcode.');
  if (!fits(p.valueStart, p.valueLen)) e.push('The weight or price does not fit in the barcode.');
  if (p.itemStart < p.valueStart + p.valueLen && p.valueStart < p.itemStart + p.itemLen) e.push('The item code and the value overlap.');
  const maxDec = p.valueKind === 'price' ? 2 : 3;
  if (!Number.isInteger(p.valueDecimals) || p.valueDecimals < 0 || p.valueDecimals > maxDec) e.push(`Decimals must be 0 to ${maxDec} for ${p.valueKind}.`);
  if (p.checkDigit && p.length !== 13 && p.length !== 8 && p.length !== 12) e.push('A check digit is only used on EAN-8, UPC-A or EAN-13 labels (8, 12 or 13 long).');
  return e;
}

/** Reads a scale barcode with the first profile whose prefix and length match; null when none does. */
export function readScaleBarcode(code: string, profiles: readonly ScaleProfile[]): ScaleRead | null {
  for (const p of profiles) {
    if (code.length !== p.length || !p.prefixes.some((x) => code.startsWith(x))) continue;
    if (p.checkDigit && !isValidGtin(code)) return null; // misread label: never guess a weight
    const itemCode = code.slice(p.itemStart, p.itemStart + p.itemLen);
    const raw = code.slice(p.valueStart, p.valueStart + p.valueLen);
    if (!/^\d+$/.test(raw) || !itemCode) return null;
    const n = Number(raw);
    const value = p.valueKind === 'price' ? n * 10 ** (2 - p.valueDecimals) : n * 10 ** (3 - p.valueDecimals);
    return { profileId: p.id, itemCode, valueKind: p.valueKind, value };
  }
  return null;
}

// ---------------------------------------------------------------- what a scan is

export type ScanKind =
  | { kind: 'scale'; read: ScaleRead }
  | { kind: 'gtin'; key: string }
  /** Anything else (Code 128 style codes, SKUs, a wrong check digit): looked up as typed. */
  | { kind: 'code'; key: string };

/** Scale profiles first (a 2x label is never a product code), then a valid GTIN, then the raw code. */
export function classifyScan(raw: string, profiles: readonly ScaleProfile[]): ScanKind {
  const code = raw.trim().toUpperCase();
  const scale = readScaleBarcode(code, profiles);
  if (scale) return { kind: 'scale', read: scale };
  const g = /^\d+$/.test(code) ? gtin14(code) : null;
  return g ? { kind: 'gtin', key: g } : { kind: 'code', key: code };
}

/** The key a barcode is stored under, so a scan finds it however it was typed in (8, 12 or 13 digits). */
export function barcodeKey(raw: string): string {
  const code = raw.trim().toUpperCase();
  return (/^\d+$/.test(code) ? gtin14(code) : null) ?? code;
}
