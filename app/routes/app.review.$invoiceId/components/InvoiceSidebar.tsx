import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
} from "@shopify/polaris";
import type { TransformedInvoice } from "../types";

interface InvoiceSidebarProps {
  extractedData: TransformedInvoice;
  hasGoogleSheets: boolean;
  sheetsConfig: {
    hasServiceAccount: boolean;
    hasOAuth2: boolean;
    hasSpreadsheet: boolean;
  };
}

export function InvoiceSidebar({
  extractedData,
  hasGoogleSheets,
  sheetsConfig,
}: InvoiceSidebarProps) {
  const handleOpenPdf = async () => {
    if (!extractedData.pdfDownloadUrl) return;

    try {
      const fullUrl = extractedData.pdfDownloadUrl.startsWith("http")
        ? extractedData.pdfDownloadUrl
        : `${window.location.origin}${extractedData.pdfDownloadUrl}`;

      const response = await fetch(fullUrl, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status}`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = extractedData.filename || "invoice.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
    } catch (error) {
      console.error("Error downloading PDF:", error);
      alert("Failed to download PDF file. Please try again.");
    }
  };

  return (
    <BlockStack gap="400">
      {/* PDF Preview */}
      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h3">
            PDF Preview
          </Text>
          <Text variant="bodyMd" as="p" tone="subdued" truncate>
            File: {extractedData.filename}
          </Text>
          <Button variant="primary" onClick={handleOpenPdf}>
            Check Original
          </Button>
        </BlockStack>
      </Card>

      {/* Processing Status */}
      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h3">
            Processing Status
          </Text>

          {/* <Badge tone="success">✅ PDF Processed</Badge>
          <Badge tone="success">✅ Data Extracted</Badge> */}
          <Badge tone="attention">⏳ Awaiting Confirmation</Badge>
        </BlockStack>
      </Card>

      {/* Processing Timeline */}
      {/* <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h3">
            Processing Timeline
          </Text>

          <BlockStack gap="200">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  backgroundColor: "#008060",
                  borderRadius: "50%",
                }}
              ></div>
              <Text variant="bodyMd" as="p">
                Uploaded: Just now
              </Text>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  backgroundColor: "#FFA500",
                  borderRadius: "50%",
                }}
              ></div>
              <Text variant="bodyMd" as="p">
                Awaiting Review
              </Text>
            </div>
          </BlockStack>
        </BlockStack>
      </Card> */}

      {/* Google Sheets Integration Status */}
      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h3">
            Google Sheets Integration
          </Text>

          {hasGoogleSheets ? (
            <BlockStack gap="200">
              <Badge tone="success">✅ Google Sheets Configured</Badge>
              {sheetsConfig.hasServiceAccount && (
                <Badge tone="success">✅ Service Account Ready</Badge>
              )}
              {sheetsConfig.hasOAuth2 && (
                <Badge tone="info">ℹ️ OAuth2 Available</Badge>
              )}
              <Text variant="bodyMd" as="p">
                CMP will be automatically calculated and updated in your Google
                Sheets after confirmation.
              </Text>
            </BlockStack>
          ) : (
            <BlockStack gap="200">
              <Badge tone="attention">⚠️ Google Sheets Not Configured</Badge>
              <Text variant="bodyMd" as="p" tone="subdued">
                CMP processing will be skipped. Configure Google Sheets in the
                API settings to enable automatic CMP updates.
              </Text>
              <Button url="/app/google-api" variant="plain">
                Configure Google Sheets
              </Button>
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h3">
            What happens next?
          </Text>

          <Text variant="bodyMd" as="p">
            After confirmation, this invoice will:
          </Text>

          <BlockStack gap="200">
            <Text variant="bodyMd" as="p">
              • Be saved to the database
            </Text>
            {hasGoogleSheets ? (
              <Text variant="bodyMd" as="p">
                • Update Google Sheets CMP (weighted average costs)
              </Text>
            ) : (
              <Text variant="bodyMd" as="p" tone="subdued">
                • Update weighted average costs (Google Sheets not configured)
              </Text>
            )}
            <Text variant="bodyMd" as="p">
              • Appear in import history
            </Text>
            <Text variant="bodyMd" as="p">
              • Generate processing summary
            </Text>
          </BlockStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
