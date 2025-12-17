import { Page, Layout, Banner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

interface ErrorBannerProps {
  error: string;
}

export function ErrorBanner({ error }: ErrorBannerProps) {
  return (
    <Page>
      <TitleBar title="Background Jobs" />
      <Layout>
        <Layout.Section>
          <Banner tone="critical">{error}</Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

