export function createMockShopifyAdmin(quantity: number) {
  return {
    graphql: async (query: string, options?: any) => {
      const sku = options?.variables?.query?.replace("sku:", "");
      return {
        json: async () => ({
          data: {
            productVariants: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/ProductVariant/123",
                    sku: sku,
                    inventoryQuantity: quantity,
                  },
                },
              ],
            },
          },
        }),
      };
    },
  };
}
