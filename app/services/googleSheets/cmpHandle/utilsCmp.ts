export async function getInventoryBySku(
  admin: any,
  sku: string
): Promise<number> {
  try {
    const response = await admin.graphql(
      `#graphql
        query getProductVariantBySku($query: String!) {
          productVariants(first: 1, query: $query) {
            edges {
              node {
                id
                sku
                inventoryQuantity
              }
            }
          }
        }`,
      {
        variables: {
          query: `sku:${sku}`,
        },
      }
    );

    const json = await response.json();

    if (json.data?.productVariants?.edges?.length > 0) {
      const variant = json.data.productVariants.edges[0].node;
      return variant.inventoryQuantity || 0;
    }

    return 0;
  } catch (error) {
    console.error(`Error fetching Shopify inventory for SKU ${sku}:`, error);
    return 0;
  }
}

export function calculateCMP(
  oldStock: number,
  oldCmp: number | null,
  newStock: number,
  newPrice: number
): number {
  if (oldCmp === null || oldStock === 0) {
    return newPrice;
  }

  const totalQty = oldStock + newStock;
  if (totalQty === 0) return 0;

  return (oldStock * oldCmp + newStock * newPrice) / totalQty;
}

