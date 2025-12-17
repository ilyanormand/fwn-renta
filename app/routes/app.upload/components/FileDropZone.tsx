import {
  DropZone,
  Thumbnail,
  BlockStack,
  InlineStack,
  Text,
} from "@shopify/polaris";

interface FileDropZoneProps {
  selectedFile: File | null;
  rejectedFiles: File[];
  onDrop: (
    droppedFiles: File[],
    acceptedFiles: File[],
    rejectedFiles: File[]
  ) => void;
}

export function FileDropZone({
  selectedFile,
  rejectedFiles,
  onDrop,
}: FileDropZoneProps) {
  const fileUpload = !selectedFile && <DropZone.FileUpload />;
  const uploadedFiles = selectedFile && (
    <div style={{ padding: "14px" }}>
      <BlockStack gap="200">
        {[selectedFile].map((file: File, index: number) => (
          <InlineStack key={index} gap="200" align="center">
            <Thumbnail
              size="small"
              alt={file.name}
              source="https://cdn.shopify.com/s/files/1/0757/9955/files/New_Post.png?12678548500147524304"
            />
            <div>
              <Text variant="bodySm" as="p">
                {file.name}
              </Text>
              <Text variant="bodySm" as="p">
                {(file.size / 1024).toFixed(1)} KB
              </Text>
            </div>
          </InlineStack>
        ))}
      </BlockStack>
    </div>
  );

  return (
    <div>
      <Text variant="bodyMd" as="p">
        Invoice PDF
      </Text>
      <div style={{ marginTop: "8px" }}>
        <DropZone
          accept="application/pdf"
          type="file"
          onDrop={onDrop}
          variableHeight
        >
          {uploadedFiles}
          {fileUpload}
        </DropZone>
      </div>
    </div>
  );
}
