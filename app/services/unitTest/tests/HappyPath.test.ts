import { describe, it, expect } from "vitest";
import { updateCmpInSheets } from "../../googleSheets/cmpHandle/cmpCalculate";
import { createMockSheetsServiceWithBatch } from "../mocks/mocks";
import { createMockShopifyAdminBatch } from "../mocks/mockOldQuantity";

describe("Happy Path", () => {
  describe("CMP calculation test with batching", () => {
    it("Should calculate CMP correctly with batch processing (10 items)", async () => {
      // Test data
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

      // if (oldStock === 0 || oldCmp === null) return newPrice
      // else: CMP = (oldStock * oldCmp + newStock * newPrice) / (oldStock + newStock)

      // ICE-LEMON: oldStock=230, oldCmp=2.1, newStock=100, newPrice=3.2
      // CMP = (230 * 2.1 + 100 * 3.2) / (230 + 100) = (483 + 320) / 330 = 803 / 330 = 2.433
      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(2.43, 2);

      // ICE-PEACH: oldStock=190, oldCmp=1.9, newStock=50, newPrice=3.5
      // CMP = (190 * 1.9 + 50 * 3.5) / (190 + 50) = (361 + 175) / 240 = 536 / 240 = 2.233
      expect(result.calculatedCmp["ICE-PEACH"]).toBeCloseTo(2.23, 2);

      // ICE-ORANGE: oldStock=150, oldCmp=2.3, newStock=75, newPrice=2.8
      // CMP = (150 * 2.3 + 75 * 2.8) / (150 + 75) = (345 + 210) / 225 = 555 / 225 = 2.467
      expect(result.calculatedCmp["ICE-ORANGE"]).toBeCloseTo(2.47, 2);

      // ICE-APPLE: oldStock=180, oldCmp=3.5, newStock=120, newPrice=4.1
      // CMP = (180 * 3.5 + 120 * 4.1) / (180 + 120) = (630 + 492) / 300 = 1122 / 300 = 3.74
      expect(result.calculatedCmp["ICE-APPLE"]).toBeCloseTo(3.74, 2);

      // ICE-BERRY: oldStock=220, oldCmp=3.2, newStock=80, newPrice=3.9
      // CMP = (220 * 3.2 + 80 * 3.9) / (220 + 80) = (704 + 312) / 300 = 1016 / 300 = 3.387
      expect(result.calculatedCmp["ICE-BERRY"]).toBeCloseTo(3.39, 2);

      expect(result.updated).toBe(10);
      expect(result.processed).toBe(10);
      expect(result.skipped).toBe(0);

      console.log("📊 CMP ICE-LEMON:", result.calculatedCmp["ICE-LEMON"]);
      console.log("📊 CMP ICE-PEACH:", result.calculatedCmp["ICE-PEACH"]);
    });
  });
});
