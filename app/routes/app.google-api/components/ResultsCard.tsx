import { BlockStack, Box } from "@shopify/polaris";
import { Card, Text } from "@shopify/polaris";
import type { ActionResponse } from "../types";

interface ResultsCardProps {
  actionData: ActionResponse;
}

export function ResultsCard({ actionData }: ResultsCardProps) {
  if (!actionData?.data) return null;

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          {actionData.serviceType
            ? `Results (${actionData.serviceType})`
            : "Results"}
        </Text>

        {actionData.data.values && (
          <Box
            padding="400"
            background="bg-surface-secondary"
            borderRadius="200"
          >
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p">
                Range: {actionData.data.range}
              </Text>
              <Text variant="bodyMd" as="p">
                Rows: {actionData.data.rowsCount}
              </Text>

              {actionData.data.values.length > 0 && (
                <div>
                  <Text variant="bodyMd" as="p" fontWeight="semibold">
                    First few rows:
                  </Text>
                  <pre
                    style={{
                      fontSize: "12px",
                      background: "#f9f9f9",
                      padding: "10px",
                      borderRadius: "4px",
                      overflow: "auto",
                      maxHeight: "200px",
                    }}
                  >
                    {actionData.data.values
                      .map(
                        (row: any[], index: number) =>
                          `Row ${index + 1}: ${row.join(" | ")}`
                      )
                      .join("\n")}
                  </pre>
                </div>
              )}
            </BlockStack>
          </Box>
        )}

        {actionData.data && !actionData.data.values && (
          <pre
            style={{
              fontSize: "12px",
              background: "#f9f9f9",
              padding: "10px",
              borderRadius: "4px",
            }}
          >
            {JSON.stringify(actionData.data, null, 2)}
          </pre>
        )}
      </BlockStack>
    </Card>
  );
}

