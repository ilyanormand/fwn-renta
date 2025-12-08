-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "invoiceDate" DATETIME NOT NULL,
    "shippingFee" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "rate" REAL NOT NULL DEFAULT 1.0,
    "status" TEXT NOT NULL,
    "pdfFileName" TEXT,
    "pdfFilePath" TEXT,
    "pdfFileSize" INTEGER,
    "pdfUploadedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("createdAt", "currency", "id", "invoiceDate", "pdfFileName", "pdfFilePath", "pdfFileSize", "pdfUploadedAt", "rate", "shippingFee", "status", "supplierId") SELECT "createdAt", "currency", "id", "invoiceDate", "pdfFileName", "pdfFilePath", "pdfFileSize", "pdfUploadedAt", "rate", "shippingFee", "status", "supplierId" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
