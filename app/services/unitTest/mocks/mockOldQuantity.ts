/**
 * Creates a mock Shopify admin for batch queries (getInventoryBySkuBatch)
 * Supports GraphQL queries with aliases (variant0, variant1, etc.)
 *
 * @param quantity - Default inventory quantity for all SKUs
 * @param customQuantities - Optional map of SKU to custom quantity: { "FWN-LEMON": 150, "FWN-PEACH": 200 }
 */
export function createMockShopifyAdminBatch(
  quantity: number,
  customQuantities?: Record<string, number>
) {
  return {
    graphql: async (query: string, options?: any) => {
      const isBatchQuery =
        query.includes("variant0:") || query.includes("variant1:");

      if (isBatchQuery) {
        // Parse batch query with aliases
        // Extract SKUs from query like: variant0: productVariants(first: 1, query: "sku:SKU-001")
        const skuMatches = query.matchAll(/query:\s*"sku:([^"]+)"/g);
        const skus: string[] = [];
        for (const match of skuMatches) {
          skus.push(match[1]);
        }

        // Build response with aliases
        const responseData: any = {};
        skus.forEach((sku, index) => {
          const alias = `variant${index}`;
          const skuQuantity = customQuantities?.[sku] ?? quantity;
          responseData[alias] = {
            edges: [
              {
                node: {
                  id: `gid://shopify/ProductVariant/${index + 123}`,
                  sku: sku,
                  inventoryQuantity: skuQuantity,
                },
              },
            ],
          };
        });

        return {
          json: async () => ({
            data: responseData,
          }),
        };
      } else {
        // Fallback to old single SKU query format (for compatibility)
        const sku = options?.variables?.query?.replace("sku:", "");
        const skuQuantity = customQuantities?.[sku] ?? quantity;
        return {
          json: async () => ({
            data: {
              productVariants: {
                edges: [
                  {
                    node: {
                      id: "gid://shopify/ProductVariant/123",
                      sku: sku,
                      inventoryQuantity: skuQuantity,
                    },
                  },
                ],
              },
            },
          }),
        };
      }
    },
  };
}
