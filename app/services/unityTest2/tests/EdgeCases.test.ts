import { describe, it, expect } from "vitest";
import { updateCmpInSheets } from "../../googleSheets/cmpHandle/cmpCalculate";
import { createMockSheetsService } from "../mocks/mocksEdgeCases";
import { createMockShopifyAdmin } from "../mocks/mockOldQuantity";

describe("Edge Cases", () => {
  describe("first test", () => {
    it("oldStock = 0", async () => {
      const invoiceItems = [
        { invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 },
        { invoice_sku: "ICE-PEACH", qty: 230, unit_price: 3 },
      ];
      const mockSheetsService = createMockSheetsService();
      const mockShopifyAdmin = createMockShopifyAdmin(0);
      const shippingFee = 50;

      const result = await updateCmpInSheets(
        invoiceItems,
        mockSheetsService,
        shippingFee,
        mockShopifyAdmin
      );

      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(3.7, 2);
      expect(result.calculatedCmp["ICE-PEACH"]).toBeCloseTo(3.22, 2);
      console.log("📊 Рассчитанный CMP:", result.calculatedCmp["ICE-LEMON"]);
    });
  });

  describe("second test", () => {
    it("oldCmp = null", async () => {
      // 1. Подготовка (Arrange)
      const invoiceItems = [
        { invoice_sku: "ICE-LEMON", qty: 100, unit_price: 3.2 },
        { invoice_sku: "ICE-PEACH", qty: 230, unit_price: 3 },
      ];
      const mockSheetsService = createMockSheetsService();
      const mockShopifyAdmin = createMockShopifyAdmin(190);
      const shippingFee = 0;

      const result = await updateCmpInSheets(
        invoiceItems,
        mockSheetsService,
        shippingFee,
        mockShopifyAdmin
      );

      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(2.48, 2);
      expect(result.calculatedCmp["ICE-PEACH"]).toBeCloseTo(2.45, 2);
      console.log("📊 CMP для ICE-LEMON:", result.calculatedCmp["ICE-LEMON"]);
      console.log("📊 CMP для ICE-PEACH:", result.calculatedCmp["ICE-PEACH"]);
    });
  });

  describe("third test", () => {
    it("Muiltiple items with shipping fee test", async () => {
      // 1. Подготовка (Arrange)
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

      expect(result.calculatedCmp["ICE-LEMON"]).toBeCloseTo(1.87, 2);
      expect(result.calculatedCmp["ICE-PEACH"]).toBeCloseTo(2.25, 2);
      console.log("📊 CMP для ICE-LEMON:", result.calculatedCmp["ICE-LEMON"]);
      console.log("📊 CMP для ICE-PEACH:", result.calculatedCmp["ICE-PEACH"]);
    });
  });
});
