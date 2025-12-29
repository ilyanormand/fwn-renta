import { describe, it, expect } from "vitest";
import { updateCmpInSheets } from "../../googleSheets/cmpHandle/cmpCalculate";
import {
  createMockSheetsService,
  createMockShopifyAdmin,
} from "../mocks/mocksEdgeCases";

describe("Edge Cases", () => {
  describe("Test 1: oldStock = 0 (new product in Shopify)", () => {
    it("Should use newPrice as CMP when oldStock = 0", async () => {
      const invoiceItems = [
        { invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 },
        { invoice_sku: "ICE-PEACH", qty: 230, unit_price: 3.0 },
      ];

      const mockSheetsService = createMockSheetsService();
      // oldStock = 0 for both products
      const mockShopifyAdmin = createMockShopifyAdmin(0);
      const shippingFee = 50;

      const result = await updateCmpInSheets(
        invoiceItems,
        mockSheetsService,
        shippingFee,
        mockShopifyAdmin
      );

      // Formula: if (oldStock === 0) return newPrice
      // totalQty = 100 + 230 = 330
      // shipping_per_unit = 50 / 330 = 0.1515

      // ICE-LEMON: newPrice = 3.2 + 0.1515 = 3.3515
      // oldStock = 0 → CMP = 3.35
      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(3.35, 2);

      // ICE-PEACH: newPrice = 3.0 + 0.1515 = 3.1515
      // oldStock = 0 → CMP = 3.15
      expect(result.calculatedCmp["ICE-PEACH"]).toBeCloseTo(3.15, 2);

      expect(result.processed).toBe(2);
      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(0);

      console.log(
        "📊 CMP ICE-LEMON (oldStock=0):",
        result.calculatedCmp["ICE-LEMON"]
      );
      console.log(
        "📊 CMP ICE-PEACH (oldStock=0):",
        result.calculatedCmp["ICE-PEACH"]
      );
    });
  });

  describe("Test 2: oldCmp = null (product without old price)", () => {
    it("Should use newPrice as CMP when oldCmp = null", async () => {
      const invoiceItems = [
        { invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 },
        { invoice_sku: "ICE-PEACH", qty: 230, unit_price: 3.0 },
      ];

      // Create special mock with oldCmp = null
      const mockSheetsServiceWithNullCmp = {
        readData: async (spreadsheetId: string, range: string) => {
          return {
            values: [
              [
                "FWN-LEMON",
                "Test Brand",
                "Lemon Ice",
                "ICE-LEMON",
                "Test Supplier",
                null, // [5] OLD CMP = null ⚠️
                230,
                100,
                3.2,
                1.0,
                230,
              ],
              [
                "FWN-PEACH",
                "Test Brand",
                "Peach Ice",
                "ICE-PEACH",
                "Test Supplier",
                null, // [5] OLD CMP = null ⚠️
                190,
                50,
                3.2,
                2.5,
                3.3,
              ],
            ],
          };
        },
        batchUpdate: async (spreadsheetId: string, updates: any[]) => {
          return {
            success: true,
            message: `Batch updated ${updates.length} ranges`,
            updatedCells: updates.length,
          };
        },
      };

      const mockShopifyAdmin = createMockShopifyAdmin(190);
      const shippingFee = 0;

      const result = await updateCmpInSheets(
        invoiceItems,
        mockSheetsServiceWithNullCmp,
        shippingFee,
        mockShopifyAdmin
      );

      // Formula: if (oldCmp === null) return newPrice
      // Without shipping fee, newPrice = unit_price

      // ICE-LEMON: oldCmp = null → CMP = 3.2
      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(3.2, 2);

      // ICE-PEACH: oldCmp = null → CMP = 3.0
      expect(result.calculatedCmp["ICE-PEACH"]).toBeCloseTo(3.0, 2);

      console.log(
        "📊 CMP ICE-LEMON (oldCmp=null):",
        result.calculatedCmp["ICE-LEMON"]
      );
      console.log(
        "📊 CMP ICE-PEACH (oldCmp=null):",
        result.calculatedCmp["ICE-PEACH"]
      );
    });
  });

  describe("Test 3: Multiple items with shipping fee distribution", () => {
    it("Should distribute shipping fee proportionally to quantity", async () => {
      const invoiceItems = [
        { invoice_sku: "ICE-LEMON", qty: 333, unit_price: 1.1 },
        { invoice_sku: "ICE-PEACH", qty: 177, unit_price: 0.9 },
      ];

      const mockSheetsService = createMockSheetsService();
      const mockShopifyAdmin = createMockShopifyAdmin(30);
      const shippingFee = 250;

      const result = await updateCmpInSheets(
        invoiceItems,
        mockSheetsService,
        shippingFee,
        mockShopifyAdmin
      );

      // Formula:
      // totalQty = 333 + 177 = 510
      // shipping_per_unit = 250 / 510 = 0.4902

      // ICE-LEMON:
      // newPrice = 1.1 + 0.4902 = 1.5902
      // oldStock = 30, oldCmp = 1.1
      // CMP = (30 * 1.1 + 333 * 1.5902) / (30 + 333) = (33 + 529.54) / 363 = 1.55
      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(1.55, 2);

      // ICE-PEACH:
      // newPrice = 0.9 + 0.4902 = 1.3902
      // oldStock = 30, oldCmp = 2.9
      // CMP = (30 * 2.9 + 177 * 1.3902) / (30 + 177) = (87 + 246.07) / 207 = 1.61
      expect(result.calculatedCmp["ICE-PEACH"]).toBeCloseTo(1.61, 2);

      console.log(
        "📊 CMP ICE-LEMON (with shipping):",
        result.calculatedCmp["ICE-LEMON"]
      );
      console.log(
        "📊 CMP ICE-PEACH (with shipping):",
        result.calculatedCmp["ICE-PEACH"]
      );
    });
  });

  describe("Test 4: SKU not found in Google Sheets", () => {
    it("Should skip non-existent SKU", async () => {
      const invoiceItems = [
        { invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 },
        { invoice_sku: "NOT-EXIST", qty: 50, unit_price: 2.0 }, // Does not exist
        { invoice_sku: "ICE-PEACH", qty: 230, unit_price: 3.0 },
      ];

      const mockSheetsService = createMockSheetsService();
      const mockShopifyAdmin = createMockShopifyAdmin(100);
      const shippingFee = 0;

      const result = await updateCmpInSheets(
        invoiceItems,
        mockSheetsService,
        shippingFee,
        mockShopifyAdmin
      );

      // Should process all 3, update 2, skip 1
      expect(result.processed).toBe(3);
      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.notFound).toContain("NOT-EXIST");

      // Check that the rest were processed
      expect(result.calculatedCmp["ICE-LEMON"]).toBeDefined();
      expect(result.calculatedCmp["ICE-PEACH"]).toBeDefined();
      expect(result.calculatedCmp["NOT-EXIST"]).toBeUndefined();

      console.log("📊 Not found SKUs:", result.notFound);
    });
  });

  describe("Test 5: Very large oldStock vs small newStock", () => {
    it("CMP should not change significantly with small purchase", async () => {
      const invoiceItems = [
        { invoice_sku: "ICE-LEMON", qty: 1, unit_price: 10.0 }, // Very expensive but small qty
      ];

      const mockSheetsServiceBigStock = {
        readData: async () => ({
          values: [
            [
              "FWN-LEMON",
              "Test Brand",
              "Lemon Ice",
              "ICE-LEMON",
              "Test Supplier",
              2.0, // [5] OLD CMP = 2.0
              10000, // Large old stock
              1,
              10.0,
              2.0,
              0,
            ],
          ],
        }),
        batchUpdate: async () => ({
          success: true,
          message: "Updated",
          updatedCells: 1,
        }),
      };

      // oldStock = 10000 (very large)
      const mockShopifyAdmin = createMockShopifyAdmin(10000);
      const shippingFee = 0;

      const result = await updateCmpInSheets(
        invoiceItems,
        mockSheetsServiceBigStock,
        shippingFee,
        mockShopifyAdmin
      );

      // CMP = (10000 * 2.0 + 1 * 10.0) / (10000 + 1) = (20000 + 10) / 10001 = 2.001
      // Should remain close to 2.0
      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(2.0, 1);
      expect(result.calculatedCmp["ICE-LEMON"]).toBeGreaterThan(2.0);
      expect(result.calculatedCmp["ICE-LEMON"]).toBeLessThan(2.01);

      console.log(
        "📊 CMP with large oldStock:",
        result.calculatedCmp["ICE-LEMON"]
      );
    });
  });
});
