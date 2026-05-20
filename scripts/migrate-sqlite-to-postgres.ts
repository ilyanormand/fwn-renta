// Migrates Supplier, Product, SupplierSKU from a local SQLite snapshot into
// the configured Postgres database. The destination DB is expected to be
// freshly migrated (empty schema). Historical Invoice / LogEntry / CMP /
// ShopifySale / Job rows are intentionally skipped — we only carry over the
// catalog so the new instance can keep parsing PDFs against the same SKUs.
//
// Usage:
//   DATABASE_URL="postgresql://..." \
//   SQLITE_PATH="./prisma/dev.sqlite" \
//   npx tsx scripts/migrate-sqlite-to-postgres.ts

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const SQLITE_PATH = process.env.SQLITE_PATH ?? "./prisma/dev.sqlite";

if (!process.env.DATABASE_URL) {
  console.error("✖ DATABASE_URL is required");
  process.exit(1);
}
if (!existsSync(SQLITE_PATH)) {
  console.error(`✖ SQLite file not found at ${SQLITE_PATH}`);
  process.exit(1);
}

type SupplierRow = { id: string; name: string; createdAt: string };
type ProductRow = { id: string; name: string; skuFwn: string; createdAt: string };
type SupplierSKURow = { id: string; productId: string; sku: string; brand: string | null };

function readJson<T>(query: string): T[] {
  const out = execFileSync("sqlite3", [SQLITE_PATH, "-json", query], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim() ? (JSON.parse(out) as T[]) : [];
}

// SQLite stores DATETIME as ISO string; Postgres TIMESTAMP(3) accepts it directly
// via JS Date. Wrap so undefined/null stays null.
function toDate(v: string | null | undefined): Date | undefined {
  return v ? new Date(v) : undefined;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const [existingSuppliers, existingProducts, existingSkus] = await Promise.all([
      prisma.supplier.count(),
      prisma.product.count(),
      prisma.supplierSKU.count(),
    ]);

    if (existingSuppliers + existingProducts + existingSkus > 0) {
      console.warn(
        `⚠ Target DB is not empty (Supplier=${existingSuppliers}, Product=${existingProducts}, SupplierSKU=${existingSkus}).`
      );
      console.warn("   Re-running will skip rows whose IDs already exist (idempotent).");
    }

    const suppliers = readJson<SupplierRow>("SELECT id, name, createdAt FROM Supplier");
    const products = readJson<ProductRow>("SELECT id, name, skuFwn, createdAt FROM Product");
    const skus = readJson<SupplierSKURow>(
      'SELECT id, productId, sku, brand FROM "SupplierSKU"'
    );

    console.log(`📦 Source rows: ${suppliers.length} suppliers, ${products.length} products, ${skus.length} SKUs`);

    let inserted = { supplier: 0, product: 0, sku: 0 };
    let skipped = { supplier: 0, product: 0, sku: 0 };

    for (const row of suppliers) {
      const res = await prisma.supplier.upsert({
        where: { id: row.id },
        update: {},
        create: {
          id: row.id,
          name: row.name,
          createdAt: toDate(row.createdAt) ?? new Date(),
        },
      });
      if (res.id === row.id) inserted.supplier++;
    }

    for (const row of products) {
      try {
        await prisma.product.create({
          data: {
            id: row.id,
            name: row.name,
            skuFwn: row.skuFwn,
            createdAt: toDate(row.createdAt) ?? new Date(),
          },
        });
        inserted.product++;
      } catch (e: any) {
        if (e?.code === "P2002") {
          skipped.product++;
        } else {
          throw e;
        }
      }
    }

    for (const row of skus) {
      try {
        await prisma.supplierSKU.create({
          data: {
            id: row.id,
            productId: row.productId,
            sku: row.sku,
            brand: row.brand,
          },
        });
        inserted.sku++;
      } catch (e: any) {
        if (e?.code === "P2002" || e?.code === "P2003") {
          skipped.sku++;
        } else {
          throw e;
        }
      }
    }

    console.log("\n✅ Migration complete");
    console.log(`   Supplier:    inserted ${inserted.supplier}, skipped ${skipped.supplier}`);
    console.log(`   Product:     inserted ${inserted.product}, skipped ${skipped.product}`);
    console.log(`   SupplierSKU: inserted ${inserted.sku}, skipped ${skipped.sku}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("✖ Migration failed:", err);
  process.exit(1);
});
