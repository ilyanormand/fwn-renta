import { Form } from "@remix-run/react";
import {
  Card,
  FormLayout,
  Select,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { FileDropZone } from "./FileDropZone";
import type { SelectOption, ActionData } from "../types";

interface UploadFormCardProps {
  suppliers: SelectOption[];
  selectedSupplier: string;
  onSupplierChange: (value: string) => void;
  selectedFile: File | null;
  rejectedFiles: File[];
  onFileDrop: (
    droppedFiles: File[],
    acceptedFiles: File[],
    rejectedFiles: File[]
  ) => void;
  actionData: ActionData | undefined;
  isSubmitting: boolean;
}

export function UploadFormCard({
  suppliers,
  selectedSupplier,
  onSupplierChange,
  selectedFile,
  rejectedFiles,
  onFileDrop,
  actionData,
  isSubmitting,
}: UploadFormCardProps) {
  const errorMessage = rejectedFiles.length > 0 && (
    <Banner tone="critical">
      <p>The following files were rejected:</p>
      <ul>
        {rejectedFiles.map((file, index) => (
          <li key={index}>{file.name} - Only PDF files are accepted</li>
        ))}
      </ul>
    </Banner>
  );

  return (
    <Card>
      <BlockStack gap="500">
        <Text variant="headingMd" as="h2">
          Import Supplier Invoice
        </Text>

        {actionData && "error" in actionData && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}

        {errorMessage}

        <Form method="post" encType="multipart/form-data">
          <FormLayout>
            <Select
              label="Supplier"
              options={suppliers}
              onChange={onSupplierChange}
              value={selectedSupplier}
              name="supplier"
              placeholder="Select a supplier"
            />

            <FileDropZone
              selectedFile={selectedFile}
              rejectedFiles={rejectedFiles}
              onDrop={onFileDrop}
            />

            {/* Hidden file input for form submission */}
            {selectedFile && (
              <input
                type="file"
                name="invoice"
                accept=".pdf"
                style={{ display: "none" }}
                ref={(input) => {
                  if (input && selectedFile) {
                    const dt = new DataTransfer();
                    dt.items.add(selectedFile);
                    input.files = dt.files;
                  }
                }}
              />
            )}

            <InlineStack gap="200">
              <Button
                variant="primary"
                submit
                loading={isSubmitting}
                disabled={!selectedSupplier || !selectedFile || isSubmitting}
              >
                {isSubmitting ? "Processing Upload..." : "Upload Invoice"}
              </Button>

              <Button url="/app/history" disabled={isSubmitting}>
                View History
              </Button>
            </InlineStack>
          </FormLayout>
        </Form>
      </BlockStack>
    </Card>
  );
}

