// Pulls the current state of the FWN catalog from Google Sheets and seeds
// Product / SupplierSKU / CMPRecord in the new Postgres database so the app
// starts from accurate cost prices on first launch.
//
// Sheet layout (matches app/services/invoiceProcessor.server.ts):
//   B  = SKU FWN
//   C  = product name           (assumed; printed in dry-run for verification)
//   E  = supplier SKUs joined by , ; / |
//   F  = supplier name / brand   (assumed; printed in dry-run for verification)
//   G  = current CMP (weighted average cost)
//   H  = qty before last incoming
//   I  = qty from last incoming
//   J  = previous unit price
//   K  = current unit price
//
// Auth: same env layout as app/services/googleSheets.server.ts.
//   1. GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON  -> service account (preferred)
//   2. GOOGLE_SHEETS_API_KEY               -> read-only API key
//   Sheet ID:  GOOGLE_SHEETS_SPREADSHEET_ID
//   Tab name:  GOOGLE_SHEETS_TAB (default "Sheet1")
//   Range:     GOOGLE_SHEETS_RANGE (default "A2:L")
//
// Usage:
//   DATABASE_URL=postgresql://... \
//   GOOGLE_SHEETS_SPREADSHEET_ID=... \
//   GOOGLE_SHEETS_API_KEY=... \
//   npx tsx scripts/refresh-from-sheets.ts            # dry run
//   npx tsx scripts/refresh-from-sheets.ts --apply    # actually write

import { PrismaClient } from "@prisma/client";
import {
  GoogleSheetsService,
  GoogleSheetsServiceAccountService,
  createServiceAccountServiceFromConfig,
} from "../app/services/googleSheets.server";

const APPLY = process.argv.includes("--apply");
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const TAB = process.env.GOOGLE_SHEETS_TAB ?? "Sheet1";
const RANGE = process.env.GOOGLE_SHEETS_RANGE ?? "A2:L";

if (!process.env.DATABASE_URL) {
  console.error("✖ DATABASE_URL is required");
  process.exit(1);
}
if (!SPREADSHEET_ID) {
  console.error("✖ GOOGLE_SHEETS_SPREADSHEET_ID is required");
  process.exit(1);
}

function pickSheetsService():
  | GoogleSheetsService
  | GoogleSheetsServiceAccountService {
  if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) {
    return createServiceAccountServiceFromConfig(
      process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    );
  }
  if (process.env.GOOGLE_SHEETS_API_KEY) {
    return new GoogleSheetsService(process.env.GOOGLE_SHEETS_API_KEY);
  }
  console.error(
    "✖ Provide GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON or GOOGLE_SHEETS_API_KEY"
  );
  process.exit(1);
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

type ParsedRow = {
  rowNumber: number;
  skuFwn: string;
  productName: string;
  supplierSkus: string[];
  supplierName: string | null;
  cmp: number | null;
  qPrev: number;
  qIn: number;
};

async function main() {
  const sheets = pickSheetsService();
  const fullRange = `${TAB}!${RANGE}`;
  console.log(`📖 Reading ${fullRange} from ${SPREADSHEET_ID}`);

  const sheet = await sheets.readData(SPREADSHEET_ID!, fullRange);
  if (!sheet || !sheet.values) {
    console.error("✖ No values returned from Sheets");
    process.exit(1);
  }

  const startRow = parseInt(RANGE.match(/(\d+)/)?.[1] ?? "2", 10);
  const parsed: ParsedRow[] = [];
  for (let i = 0; i < sheet.values.length; i++) {
    const row = sheet.values[i];
    // A B C D E F G H I J K L  -> indices 0..11
    const skuFwn = String(row[1] ?? "").trim(); // B
    if (!skuFwn) continue;
    parsed.push({
      rowNumber: startRow + i,
      skuFwn,
      productName: String(row[2] ?? "").trim() || skuFwn, // C, fallback to SKU
      supplierSkus: splitSkus(row[4]),
      supplierName: String(row[5] ?? "").trim() || null, // F
      cmp: parseNumber(row[6]),
      qPrev: parseNumber(row[7]) ?? 0,
      qIn: parseNumber(row[8]) ?? 0,
    });
  }

  console.log(`✅ Parsed ${parsed.length} product rows`);
  console.log("   Sample rows (first 3):");
  for (const r of parsed.slice(0, 3)) {
    console.log(
      `   row ${r.rowNumber}: skuFwn=${r.skuFwn} name="${r.productName}" supplierSkus=[${r.supplierSkus.join(", ")}] brand="${r.supplierName ?? ""}" cmp=${r.cmp} qOnHand=${r.qPrev + r.qIn}`
    );
  }

  if (!APPLY) {
    console.log("\nℹ Dry run — not writing. Re-run with --apply to write.");
    console.log(
      "   Verify the sample above looks right (especially the product name column C and brand column F)."
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    let upsertedProducts = 0;
    let upsertedSkus = 0;
    let cmpRecords = 0;

    for (const row of parsed) {
      const product = await prisma.product.upsert({
        where: { skuFwn: row.skuFwn },
        update: { name: row.productName },
        create: { name: row.productName, skuFwn: row.skuFwn },
      });
      upsertedProducts++;

      for (const sSku of row.supplierSkus) {
        const existing = await prisma.supplierSKU.findFirst({
          where: { productId: product.id, sku: sSku },
        });
        if (existing) {
          if ((existing.brand ?? null) !== row.supplierName) {
            await prisma.supplierSKU.update({
              where: { id: existing.id },
              data: { brand: row.supplierName },
            });
          }
        } else {
          await prisma.supplierSKU.create({
            data: {
              productId: product.id,
              sku: sSku,
              brand: row.supplierName,
            },
          });
          upsertedSkus++;
        }
      }

      if (row.cmp !== null && row.cmp > 0) {
        const onHand = row.qPrev + row.qIn;
        await prisma.cMPRecord.create({
          data: {
            productId: product.id,
            quantity: onHand,
            cmpValue: row.cmp,
            totalCost: row.cmp * onHand,
          },
        });
        cmpRecords++;
      }
    }

    console.log("\n✅ Refresh complete");
    console.log(`   Products upserted:     ${upsertedProducts}`);
    console.log(`   SupplierSKU created:   ${upsertedSkus}`);
    console.log(`   CMPRecord seeded:      ${cmpRecords}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("✖ Failed:", err);
  process.exit(1);
});
