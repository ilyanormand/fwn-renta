import { useState } from "react";
import { useActionData, useNavigation, useLoaderData } from "@remix-run/react";
import { Page, Layout } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { loader } from "./loader.server";
import { action } from "./action.server";
import { useUploadNavigation } from "./hooks/useUploadNavigation";
import { UploadFormCard } from "./components/UploadFormCard";
import { UploadInstructionsCard } from "./components/UploadInstructionsCard";
import type { ActionData, LoaderData } from "./types";

// Re-export loader and action for Remix
export { loader, action };

export default function Upload() {
  const { suppliers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([]);

  // Handle successful upload navigation
  useUploadNavigation(actionData);

  const isSubmitting = navigation.state === "submitting";

  const handleDropZoneDrop = (
    droppedFiles: File[],
    acceptedFiles: File[],
    rejectedFiles: File[]
  ) => {
    setSelectedFile(acceptedFiles[0]);
    setRejectedFiles(rejectedFiles);
  };

  return (
    <Page>
      <TitleBar title="Upload Invoice" />
      <Layout>
        <Layout.Section>
          <UploadFormCard
            suppliers={suppliers}
            selectedSupplier={selectedSupplier}
            onSupplierChange={setSelectedSupplier}
            selectedFile={selectedFile}
            rejectedFiles={rejectedFiles}
            onFileDrop={handleDropZoneDrop}
            actionData={actionData}
            isSubmitting={isSubmitting}
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <UploadInstructionsCard />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

