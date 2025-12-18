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

/**
 * Batch fetch inventory quantities for multiple SKUs in a single GraphQL request
 * Uses aliases to query multiple SKUs at once (up to 50 per request)
 * @param admin Shopify admin API client
 * @param skus Array of SKU strings to fetch
 * @returns Map of SKU to inventory quantity: { "SKU-001": 150, "SKU-002": 200, ... }
 */
export async function getInventoryBySkuBatch(
  admin: any,
  skus: string[]
): Promise<Record<string, number>> {
  const inventoryMap: Record<string, number> = {};

  if (!skus || skus.length === 0) {
    return inventoryMap;
  }

  // Shopify GraphQL has limits on aliases, so we'll process in chunks of 50
  const CHUNK_SIZE = 50;
  const chunks: string[][] = [];

  for (let i = 0; i < skus.length; i += CHUNK_SIZE) {
    chunks.push(skus.slice(i, i + CHUNK_SIZE));
  }

  try {
    // Process each chunk
    for (const chunk of chunks) {
      // Build GraphQL query with aliases for each SKU
      const aliases = chunk
        .map((sku, index) => {
          const alias = `variant${index}`;
          return `${alias}: productVariants(first: 1, query: "sku:${sku}") {
          edges {
            node {
              sku
              inventoryQuantity
            }
          }
        }`;
        })
        .join("\n");

      const query = `#graphql
        query getProductVariantsBySku {
          ${aliases}
        }`;

      const response = await admin.graphql(query);
      const json = await response.json();

      // Extract results from each alias
      chunk.forEach((sku, index) => {
        const alias = `variant${index}`;
        const variantData = json.data?.[alias];

        if (variantData?.edges?.length > 0) {
          const variant = variantData.edges[0].node;
          inventoryMap[sku] = variant.inventoryQuantity || 0;
        } else {
          inventoryMap[sku] = 0;
        }
      });
    }

    return inventoryMap;
  } catch (error) {
    console.error(
      `Error batch fetching Shopify inventory for ${skus.length} SKUs:`,
      error
    );
    // Return partial results if available, or empty map
    return inventoryMap;
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
