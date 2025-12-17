import { Card, BlockStack, InlineStack, Text } from "@shopify/polaris";
import type { JobStats } from "../types";

interface JobStatisticsCardProps {
  stats: JobStats;
}

export function JobStatisticsCard({ stats }: JobStatisticsCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Job Statistics
        </Text>

        <InlineStack gap="400" wrap={false}>
          <div style={{ flex: 1 }}>
            <Text variant="headingLg" as="h3" tone="success">
              {stats?.completed || 0}
            </Text>
            <Text variant="bodyMd" as="p">
              Completed
            </Text>
          </div>

          <div style={{ flex: 1 }}>
            <Text variant="headingLg" as="h3" tone="success">
              {stats?.pending || 0}
            </Text>
            <Text variant="bodyMd" as="p">
              Pending
            </Text>
          </div>

          <div style={{ flex: 1 }}>
            <Text variant="headingLg" as="h3" tone="success">
              {stats?.processing || 0}
            </Text>
            <Text variant="bodyMd" as="p">
              Processing
            </Text>
          </div>

          <div style={{ flex: 1 }}>
            <Text variant="headingLg" as="h3" tone="critical">
              {stats?.failed || 0}
            </Text>
            <Text variant="bodyMd" as="p">
              Failed
            </Text>
          </div>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
