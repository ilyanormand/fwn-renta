import { describe, it, expect } from "vitest";
import { updateCmpInSheets } from "../../googleSheets/cmpHandle/cmpCalculate";
import { createMockSheetsServiceWithBatch } from "../mocks/mocks";
import { createMockShopifyAdminBatch } from "../mocks/mockOldQuantity";

describe("Happy Path", () => {
  describe("CMP calculation test with batching", () => {
    it("Should calculate CMP correctly with batch processing (10 items)", async () => {
      // Тестовые данные: 10 разных товаров
      const invoiceItems = [
        { invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 },
        { invoice_sku: "ICE-PEACH", qty: 50, unit_price: 3.5 },
        { invoice_sku: "ICE-ORANGE", qty: 75, unit_price: 2.8 },
        { invoice_sku: "ICE-APPLE", qty: 120, unit_price: 4.1 },
        { invoice_sku: "ICE-BERRY", qty: 80, unit_price: 3.9 },
        { invoice_sku: "ICE-MANGO", qty: 90, unit_price: 4.5 },
        { invoice_sku: "ICE-GRAPE", qty: 60, unit_price: 3.1 },
        { invoice_sku: "ICE-CHERRY", qty: 110, unit_price: 4.2 },
        { invoice_sku: "ICE-BANANA", qty: 95, unit_price: 2.5 },
        { invoice_sku: "ICE-STRAWBERRY", qty: 70, unit_price: 3.8 },
      ];
      const mockSheetsService = createMockSheetsServiceWithBatch();
      const mockShopifyAdmin = createMockShopifyAdminBatch(200, {
        "FWN-LEMON": 230,
        "FWN-PEACH": 190,
        "FWN-ORANGE": 150,
        "FWN-APPLE": 180,
        "FWN-BERRY": 220,
        "FWN-MANGO": 160,
        "FWN-GRAPE": 140,
        "FWN-CHERRY": 200,
        "FWN-BANANA": 170,
        "FWN-STRAWBERRY": 210,
      });
      const shippingFee = 0;

      const result = await updateCmpInSheets(
        invoiceItems,
        mockSheetsService,
        shippingFee,
        mockShopifyAdmin
      );

      // Check CMP calculation correctness for multiple items
      // Formula: (oldStock * oldCmp + newStock * newPrice) / (oldStock + newStock)

      // ICE-LEMON: (230 * 2.1 + 100 * 3.2) / (230 + 100) = 803 / 330 = 2.43
      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(2.43, 2);

      // ICE-PEACH: (190 * 1.9 + 50 * 3.5) / (190 + 50) = 536 / 240 = 2.23
      expect(result.calculatedCmp["ICE-PEACH"]).toBeCloseTo(2.23, 2);

      // ICE-ORANGE: (150 * 2.3 + 75 * 2.8) / (150 + 75) = 555 / 225 = 2.47
      expect(result.calculatedCmp["ICE-ORANGE"]).toBeCloseTo(2.47, 2);

      // ICE-APPLE: (180 * 3.5 + 120 * 4.1) / (180 + 120) = 1122 / 300 = 3.74
      expect(result.calculatedCmp["ICE-APPLE"]).toBeCloseTo(3.74, 2);

      // ICE-BERRY: (220 * 3.2 + 80 * 3.9) / (220 + 80) = 1016 / 300 = 3.39
      expect(result.calculatedCmp["ICE-BERRY"]).toBeCloseTo(3.39, 2);

      expect(result.updated).toBe(10);
      expect(result.processed).toBe(10);
      expect(result.skipped).toBe(0);

      console.log("📊 Обработано товаров:", result.processed);
      console.log("📊 Обновлено строк:", result.updated);
      console.log("📊 CMP для ICE-LEMON:", result.calculatedCmp["ICE-LEMON"]);
      console.log("📊 CMP для ICE-PEACH:", result.calculatedCmp["ICE-PEACH"]);
    });
  });
});
