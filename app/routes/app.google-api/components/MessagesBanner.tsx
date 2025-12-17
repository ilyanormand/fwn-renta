import { Banner, BlockStack, Text } from "@shopify/polaris";
import type { ActionResponse } from "../types";

interface MessagesBannerProps {
  urlMessage?: { type: "success" | "error"; message: string } | null;
  actionData?: ActionResponse;
}

export function MessagesBanner({
  urlMessage,
  actionData,
}: MessagesBannerProps) {
  return (
    <>
      {urlMessage && (
        <Banner
          tone={urlMessage.type === "success" ? "success" : "critical"}
        >
          {urlMessage.message}
        </Banner>
      )}

      {actionData && "error" in actionData && actionData.error && (
        <Banner tone="critical">{actionData.error}</Banner>
      )}

      {actionData && "success" in actionData && actionData.success && (
        <Banner tone="success">
          {actionData.message || "Operation completed successfully"}
          {actionData.data && actionData.serviceType && (
            <p>Service: {actionData.serviceType}</p>
          )}
        </Banner>
      )}

      {actionData &&
        "success" in actionData &&
        !actionData.success &&
        actionData.troubleshooting && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" fontWeight="semibold">
                Troubleshooting Tips:
              </Text>
              {actionData.troubleshooting.map((tip: string, index: number) => (
                <Text key={index} variant="bodyMd" as="p">
                  {tip}
                </Text>
              ))}
            </BlockStack>
          </Banner>
        )}
    </>
  );
}

