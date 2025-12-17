import { Page, Layout, Card, BlockStack, Spinner, Text, Banner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export function ProcessingState() {
  return (
    <Page>
      <TitleBar title="Processing Invoice..." />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400" align="center">
              <Spinner size="large" />
              <Text variant="headingMd" as="h2">
                Processing Your Invoice
              </Text>
              <Text variant="bodyMd" as="p" tone="subdued">
                We're extracting data from your PDF. This usually takes a few
                seconds...
              </Text>
              <Banner tone="info">
                <p>
                  The page will automatically refresh when processing is
                  complete.
                </p>
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

