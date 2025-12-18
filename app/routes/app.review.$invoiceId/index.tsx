import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useRevalidator,
} from "@remix-run/react";
import { Page, Layout, Banner, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../../shopify.server";
import { getInvoiceById, getAllSuppliers } from "../../utils/invoice.server";
import { transformInvoiceForUI } from "../../utils/invoice.server";
import {
  loadGoogleSheetsSettings,
  processInvoiceWithGoogleSheets,
} from "./googleSheets.server";
import { ProcessingState } from "./components/ProcessingState";
import { InvoiceInfoCard } from "./components/InvoiceInfoCard";
import { InvoiceItemsTable } from "./components/InvoiceItemsTable";
import { InvoiceTotalsCard } from "./components/InvoiceTotalsCard";
import { InvoiceActionsCard } from "./components/InvoiceActionsCard";
import { InvoiceSidebar } from "./components/InvoiceSidebar";
import { MessageBanner } from "./components/MessageBanner";
import { useInvoiceEditor } from "./hooks/useInvoiceEditor";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const invoiceId = params.invoiceId;

  if (!invoiceId) {
    throw new Response("Invoice ID is required", { status: 400 });
  }

  const invoice = await getInvoiceById(invoiceId);

  if (!invoice) {
    throw new Response("Invoice not found", { status: 404 });
  }

  const suppliers = await getAllSuppliers();

  const sheetsSettings = await loadGoogleSheetsSettings();
  const hasGoogleSheets = !!(
    sheetsSettings.spreadsheetId &&
    (sheetsSettings.serviceAccountConfig || sheetsSettings.oauth2Config)
  );

  const extractedData = await transformInvoiceForUI(invoice);

  return json({
    extractedData,
    suppliers: suppliers.map((s) => ({ label: s.name, value: s.id })),
    logs: invoice.logs || [],
    hasGoogleSheets,
    sheetsConfig: {
      hasServiceAccount: !!sheetsSettings.serviceAccountConfig,
      hasOAuth2: !!sheetsSettings.oauth2Config,
      hasSpreadsheet: !!sheetsSettings.spreadsheetId,
    },
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, redirect } = await authenticate.admin(request);

  const formData = await request.formData();
  const action = formData.get("_action") as string;
  const invoiceId = params.invoiceId!;

  if (action === "confirm") {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let successMessage = "Invoice imported successfully";

    try {
      const { getInvoiceById, updateInvoice } = await import(
        "../../utils/invoice.server"
      );
      const invoiceId = params.invoiceId!;

      const invoice = await getInvoiceById(invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }

      const editedItemsData = formData.get("editedItems");
      const editedShippingFeeData = formData.get("editedShippingFee");

      let editedItems = null;
      let editedShippingFee: number | undefined = undefined;

      if (editedItemsData) {
        try {
          editedItems = JSON.parse(editedItemsData as string);
          console.log(
            "-----> Using edited items from form:",
            editedItems.length
          );
        } catch (error) {
          console.log(
            "-----> Failed to parse edited items, using original data"
          );
        }
      }

      if (editedShippingFeeData) {
        try {
          editedShippingFee = parseFloat(editedShippingFeeData as string);
          console.log(
            "-----> Using edited shipping fee from form:",
            editedShippingFee
          );
        } catch (error) {
          console.log(
            "-----> Failed to parse edited shipping fee, using original data"
          );
        }
      }

      await updateInvoice(invoiceId, { status: "SUCCESS" });

      processInvoiceWithGoogleSheets(
        invoice,
        admin,
        editedItems,
        editedShippingFee
      )
        .then((sheetsResult) => {
          console.log(
            "-----> Google Sheets result (background):",
            sheetsResult
          );
        })
        .catch((error) => {
          console.error(
            "-----> Google Sheets processing error (background):",
            error
          );
        });

      // Don't wait for CMP processing - redirect immediately
      successMessage += " (Google Sheets CMP update in progress)";
    } catch (e: any) {
      console.error("Failed to process confirmation:", e?.message || e);
      throw e;
    }

    return redirect(
      `/app/history?success=${encodeURIComponent(successMessage)}`
    );
  }

  if (action === "reject") {
    try {
      const { updateInvoice } = await import("../../utils/invoice.server");
      const invoiceId = params.invoiceId!;
      await updateInvoice(invoiceId, { status: "CANCELLED" as any });
    } catch (e: any) {
      console.warn("Failed to send rejection email:", e?.message || e);
    }
    return redirect("/app/upload?error=Invoice processing cancelled");
  }

  if (action === "reparse") {
    try {
      const { reprocessInvoicePdf } = await import(
        "../../services/worker/middlewareInvoicer"
      );
      const result = await reprocessInvoicePdf(invoiceId);
      return json({
        success: result.success,
        message: result.message,
        status: result.status,
      });
    } catch (error) {
      console.error("Re-parsing failed:", error);
      return json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Re-parsing failed",
          status: "error",
        },
        { status: 500 }
      );
    }
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function InvoiceReview() {
  const { extractedData, suppliers, hasGoogleSheets, sheetsConfig } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  // Extract message and status from actionData
  const actionStatus =
    actionData && "status" in actionData
      ? (actionData.status as "success" | "error" | "warning" | "info")
      : actionData && "success" in actionData && actionData.success
        ? "success"
        : actionData
          ? "error"
          : undefined;

  const actionMessage =
    actionData && "message" in actionData
      ? actionData.message
      : actionData && "error" in actionData
        ? actionData.error
        : undefined;

  const {
    editableItems,
    editableSupplier,
    editableInvoiceDate,
    editableShippingFee,
    currentPage,
    setEditableSupplier,
    setEditableInvoiceDate,
    setEditableShippingFee,
    setCurrentPage,
    updateItem,
    addNewItem,
    removeItem,
    calculateSubtotal,
    calculateTotal,
  } = useInvoiceEditor({
    initialItems: extractedData.items,
    initialSupplierId: extractedData.supplierId,
    initialInvoiceDate: extractedData.invoiceDate,
    initialShippingFee: extractedData.shippingFee,
    itemsPerPage: 10,
  });

  const isSubmitting = navigation.state === "submitting";
  const isProcessing = extractedData.status === "PROCESSING";

  useEffect(() => {
    if (extractedData.status === "PROCESSING") {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [extractedData.status, revalidator]);

  if (isProcessing) {
    return <ProcessingState />;
  }

  return (
    <Page>
      <TitleBar title="Review Invoice Data" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner tone="info">
              <p>
                Please review the extracted invoice data below. You can edit any
                fields if needed before confirming the import.
              </p>
            </Banner>

            {actionMessage && (
              <MessageBanner status={actionStatus} message={actionMessage} />
            )}

            <InvoiceInfoCard
              extractedData={extractedData}
              suppliers={suppliers}
              editableSupplier={editableSupplier}
              editableInvoiceDate={editableInvoiceDate}
              onSupplierChange={setEditableSupplier}
              onInvoiceDateChange={setEditableInvoiceDate}
              isProcessing={isProcessing}
            />

            <InvoiceItemsTable
              items={editableItems}
              currentPage={currentPage}
              itemsPerPage={10}
              onPageChange={setCurrentPage}
              onItemUpdate={updateItem}
              onItemRemove={removeItem}
              onItemAdd={addNewItem}
              isProcessing={isProcessing}
            />

            <InvoiceTotalsCard
              extractedData={extractedData}
              editableShippingFee={editableShippingFee}
              onShippingFeeChange={setEditableShippingFee}
              calculateSubtotal={calculateSubtotal}
              calculateTotal={calculateTotal}
              isProcessing={isProcessing}
            />

            <InvoiceActionsCard
              editableItems={editableItems}
              editableSupplier={editableSupplier}
              editableInvoiceDate={editableInvoiceDate}
              editableShippingFee={editableShippingFee}
              isSubmitting={isSubmitting}
              isProcessing={isProcessing}
            />
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <InvoiceSidebar
            extractedData={extractedData}
            hasGoogleSheets={hasGoogleSheets}
            sheetsConfig={sheetsConfig}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
