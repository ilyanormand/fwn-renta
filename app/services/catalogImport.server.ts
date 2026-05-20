// One-shot catalog import from the FWN Google Sheet. Mirrors the logic that
// used to live in scripts/refresh-from-sheets.ts, but runs inside the app
// so it can be triggered from the Google API admin page.
//
// Sheet layout (matches app/services/invoiceProcessor.server.ts):
//   B  = SKU FWN
//   C  = product name           (assumed)
//   E  = supplier SKUs joined by , ; / |
//   F  = supplier name / brand   (assumed)
//   G  = current CMP (weighted average cost)
//   H  = qty before last incoming
//   I  = qty from last incoming
//
// Idempotent — upserts Products/SupplierSKUs by natural key and appends a
// fresh CMPRecord per product so historical CMP records still accumulate.

import db from "../db.server";

type AnySheetsService = {
  readData(
    spreadsheetId: string,
    range: string
  ): Promise<{ values: Array<Array<string | number | boolean>> } | null>;
};

export interface ImportResult {
  parsed: number;
  productsUpserted: number;
  supplierSkusCreated: number;
  cmpRecordsCreated: number;
  skipped: number;
  errors: string[];
  samples: Array<{
    rowNumber: number;
    skuFwn: string;
    productName: string;
    supplierSkus: string[];
    brand: string | null;
    cmp: number | null;
    onHand: number;
  }>;
}

const SPLIT_RE = /[,;/|]/;

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(",", ".").replace(/\s/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function splitSkus(cell: unknown): string[] {
  if (!cell) return [];
  return String(cell)
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function importCatalogFromSheets(
  sheets: AnySheetsService,
  spreadsheetId: string,
  options?: { tab?: string; range?: string; apply?: boolean }
): Promise<ImportResult> {
  const tab = options?.tab ?? "Sheet1";
  const range = options?.range ?? "A2:L";
  const apply = options?.apply ?? true;
  const fullRange = `${tab}!${range}`;

  const sheet = await sheets.readData(spreadsheetId, fullRange);
  if (!sheet || !sheet.values) {
    throw new Error("No values returned from Google Sheets");
  }

  const startRow = parseInt(range.match(/(\d+)/)?.[1] ?? "2", 10);

  type Parsed = {
    rowNumber: number;
    skuFwn: string;
    productName: string;
    supplierSkus: string[];
    brand: string | null;
    cmp: number | null;
    qPrev: number;
    qIn: number;
  };

  const parsed: Parsed[] = [];
  for (let i = 0; i < sheet.values.length; i++) {
    const row = sheet.values[i];
    const skuFwn = String(row[1] ?? "").trim(); // B
    if (!skuFwn) continue;
    parsed.push({
      rowNumber: startRow + i,
      skuFwn,
      productName: String(row[2] ?? "").trim() || skuFwn, // C
      supplierSkus: splitSkus(row[4]), // E
      brand: String(row[5] ?? "").trim() || null, // F
      cmp: parseNumber(row[6]), // G
      qPrev: parseNumber(row[7]) ?? 0, // H
      qIn: parseNumber(row[8]) ?? 0, // I
    });
  }

  const result: ImportResult = {
    parsed: parsed.length,
    productsUpserted: 0,
    supplierSkusCreated: 0,
    cmpRecordsCreated: 0,
    skipped: 0,
    errors: [],
    samples: parsed.slice(0, 3).map((p) => ({
      rowNumber: p.rowNumber,
      skuFwn: p.skuFwn,
      productName: p.productName,
      supplierSkus: p.supplierSkus,
      brand: p.brand,
      cmp: p.cmp,
      onHand: p.qPrev + p.qIn,
    })),
  };

  if (!apply) return result;

  for (const row of parsed) {
    try {
      const product = await db.product.upsert({
        where: { skuFwn: row.skuFwn },
        update: { name: row.productName },
        create: { name: row.productName, skuFwn: row.skuFwn },
      });
      result.productsUpserted++;

      for (const sSku of row.supplierSkus) {
        const existing = await db.supplierSKU.findFirst({
          where: { productId: product.id, sku: sSku },
        });
        if (existing) {
          if ((existing.brand ?? null) !== row.brand) {
            await db.supplierSKU.update({
              where: { id: existing.id },
              data: { brand: row.brand },
            });
          }
        } else {
          await db.supplierSKU.create({
            data: {
              productId: product.id,
              sku: sSku,
              brand: row.brand,
            },
          });
          result.supplierSkusCreated++;
        }
      }

      if (row.cmp !== null && row.cmp > 0) {
        const onHand = row.qPrev + row.qIn;
        await db.cMPRecord.create({
          data: {
            productId: product.id,
            quantity: onHand,
            cmpValue: row.cmp,
            totalCost: row.cmp * onHand,
          },
        });
        result.cmpRecordsCreated++;
      }
    } catch (e: any) {
      result.skipped++;
      result.errors.push(`row ${row.rowNumber} (${row.skuFwn}): ${e?.message ?? String(e)}`);
    }
  }

  return result;
}
