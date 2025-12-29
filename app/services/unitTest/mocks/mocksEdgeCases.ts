/**
 * Mock Shopify Admin for Edge Cases tests
 * Supports batch queries with aliases (variant0, variant1, etc.)
 */
export function createMockShopifyAdmin(
  defaultQuantity: number,
  customQuantities?: Record<string, number>
) {
  return {
    graphql: async (query: string) => {
      const isBatchQuery =
        query.includes("variant0:") || query.includes("variant1:");

      if (isBatchQuery) {
        // Parse batch query aliases
        const skuMatches = query.matchAll(/query:\s*"sku:([^"]+)"/g);
        const skus: string[] = [];
        for (const match of skuMatches) {
          skus.push(match[1]);
        }

        // Build response with aliases
        const responseData: any = {};
        skus.forEach((sku, index) => {
          const alias = `variant${index}`;
          const skuQuantity = customQuantities?.[sku] ?? defaultQuantity;
          responseData[alias] = {
            edges: [
              {
                node: {
                  id: `gid://shopify/ProductVariant/${index + 1000}`,
                  sku: sku,
                  inventoryQuantity: skuQuantity,
                },
              },
            ],
          };
        });

        // Return data directly (matching real admin.graphql behavior)
        return {
          data: responseData,
        };
      }

      // Fallback for non-batch queries
      return { data: {} };
    },
  };
}

/**
 * Mock for Google Sheets service (for Edge Cases tests)
 * Data structure matches real table:
 * [0] FWN SKU, [1] Brand, [2] Name, [3] Invoice SKUs, [4] Supplier,
 * [5] OLD CMP, [6] Old Stock, [7] New Qty, [8] ???, [9] Current K Value (old unit price)
 */
export function createMockSheetsService() {
  return {
    readData: async (spreadsheetId: string, range: string) => {
      return {
        values: [
          [
            "FWN-LEMON", // [0] FWN SKU
            "Test Brand", // [1] Brand
            "Lemon Ice", // [2] Name
            "ICE-LEMON", // [3] Invoice SKUs
            "Test Supplier", // [4] Supplier
            1.1, // [5] OLD CMP ⚠️
            230, // [6] (unused in calculation)
            100, // [7] (unused)
            3.2, // [8] (unused)
            1.0, // [9] Current K Value (old unit price)
            230, // [10] (unused)
          ],
          [
            "FWN-PEACH", // [0] FWN SKU
            "Test Brand", // [1] Brand
            "Peach Ice", // [2] Name
            "ICE-PEACH", // [3] Invoice SKUs
            "Test Supplier", // [4] Supplier
            2.9, // [5] OLD CMP ⚠️
            190, // [6] (unused)
            50, // [7] (unused)
            3.2, // [8] (unused)
            2.5, // [9] Current K Value
            3.3, // [10] (unused)
          ],
        ],
      };
    },

    // Old method (for backward compatibility)
    updateData: async (
      spreadsheetId: string,
      range: string,
      values: any[][]
    ) => {
      return {
        success: true,
        updatedCells: values.length,
      };
    },

    // New method - batch update (used in new algorithm)
    batchUpdate: async (
      spreadsheetId: string,
      updates: Array<{
        range: string;
        values: Array<Array<string | number | boolean>>;
      }>
    ) => {
      return {
        success: true,
        message: `Batch updated ${updates.length} ranges`,
        updatedCells: updates.length,
      };
    },
  };
}
