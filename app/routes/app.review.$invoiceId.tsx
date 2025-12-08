import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useRevalidator,
  Form,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Button,
  InlineStack,
  Text,
  TextField,
  Select,
  Banner,
  BlockStack,
  Badge,
  Divider,
  Box,
  Spinner,
  EmptyState,
  Pagination,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getInvoiceById,
  updateInvoice,
  getAllSuppliers,
} from "../utils/invoice.server";
import { getPdfUrl } from "../utils/fileUpload.server";
import { createInvoiceProcessor, type InvoiceItem as ProcessorInvoiceItem } from "../services/invoiceProcessor.server";
import { createServiceAccountServiceFromConfig, createOAuth2ServiceFromConfig, getGoogleSheetsService } from "../services/googleSheets.server";

// Load Google Sheets settings from JSON file
async function loadGoogleSheetsSettings() {
  try {
    const fs = await import('fs');
    const { PATHS } = await import('../utils/storage.server');
    const settingsPath = PATHS.GOOGLE_SETTINGS;
    
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.log('Google Sheets settings file not found');
  }
  return {};
}

// Process invoice with Google Sheets integration
async function processInvoiceWithGoogleSheets(
  invoice: any,
  admin: any, // Shopify Admin API for inventory lookup
  editedItems?: any[], 
  editedShippingFee?: number
): Promise<{
  success: boolean;
  message: string;
  report?: string;
}> {
  try {
    const settings = await loadGoogleSheetsSettings();
    
    if (!settings.spreadsheetId) {
      return {
        success: false,
        message: "Google Sheets not configured - skipping CMP processing"
      };
    }

    // Use edited items if available, otherwise use original invoice items
    const itemsToProcess = editedItems || invoice.items;
    console.log(`-----> Using ${editedItems ? 'edited' : 'original'} items for processing`);

    // Convert invoice items to processor format
    const invoiceItems: ProcessorInvoiceItem[] = itemsToProcess.map((item: any) => ({
      invoice_sku: item.sku,
      qty: item.quantity,
      unit_price: item.unitPrice
    }));

    console.log(`-----> Processing ${invoiceItems.length} items for Google Sheets CMP update`);

    // Get appropriate sheets service
    let sheetsService;
    let serviceType = "None";

    if (settings.serviceAccountConfig) {
      console.log("-----> Using Service Account for CMP processing");
      try {
        sheetsService = createServiceAccountServiceFromConfig(settings.serviceAccountConfig);
        serviceType = "Service Account";
      } catch (error: any) {
        console.log("-----> Service Account failed:", error.message);
      }
    }

    if (!sheetsService && settings.oauth2Config && settings.oauth2Tokens) {
      console.log("-----> Using OAuth2 for CMP processing");
      try {
        const tokens = JSON.parse(settings.oauth2Tokens);
        sheetsService = createOAuth2ServiceFromConfig(settings.oauth2Config, tokens.access_token);
        serviceType = "OAuth2";
      } catch (error: any) {
        console.log("-----> OAuth2 failed:", error.message);
      }
    }

    if (!sheetsService) {
      return {
        success: false,
        message: "Google Sheets authentication not available - skipping CMP processing"
      };
    }

    // Use edited shipping fee if available, otherwise use original from invoice
    const shippingFee = editedShippingFee !== undefined ? editedShippingFee : (invoice.shippingFee || 0);
    console.log(`-----> Shipping fee: ${shippingFee} (${editedShippingFee !== undefined ? 'edited' : 'original'})`);
    
    // Create processor and process invoice with shipping fee and Shopify admin
    const processor = createInvoiceProcessor(settings.spreadsheetId);
    const result = await processor.processInvoice(invoiceItems, sheetsService, shippingFee, admin);
    
    console.log(`-----> Google Sheets processing completed: ${result.updated} rows updated`);

    return {
      success: result.updated > 0,
      message: `Google Sheets CMP processing completed: ${result.updated} rows updated, ${result.skipped} skipped (${serviceType})`,
      report: result.report
    };

  } catch (error: any) {
    console.error('-----> Google Sheets processing error:', error);
    return {
      success: false,
      message: `Google Sheets processing failed: ${error.message}`
    };
  }
}

// Define types for better type safety
interface InvoiceItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface TransformedInvoice {
  id: string;
  supplier: string;
  supplierId: string;
  invoiceDate: string;
  invoiceNumber: string;
  currency: string;
  shippingFee: number;
  discount: number;
  items: InvoiceItem[];
  filename: string;
  pdfUrl: string | null; // Data URL for iframe preview
  pdfDownloadUrl: string | null; // HTTP URL for download/open in new tab
  pdfFilePath: string | null;
  status: string;
  createdAt: Date;
}

// Transform database invoice data for the UI
async function transformInvoiceForUI(invoice: any): Promise<TransformedInvoice> {
  const pdfUrl = invoice.pdfFileName ? getPdfUrl(invoice.pdfFileName) : null;
  
  // Don't load PDF as base64 during revalidation (too expensive)
  // Just use the URL endpoint which handles auth properly with Cache-Control headers
  console.log("📄 PDF URL generated:", {
    pdfFileName: invoice.pdfFileName,
    pdfUrl: pdfUrl,
    status: invoice.status,
  });

  // Calculate gross total of items to distribute discount
  const itemsGrossTotal = invoice.items.reduce((sum: number, item: any) => sum + (item.total || 0), 0);
  const discount = invoice.discount || 0;
  
  return {
    id: invoice.id,
    supplier: invoice.supplier.name,
    supplierId: invoice.supplierId,
    invoiceDate: invoice.invoiceDate.toISOString().split("T")[0],
    invoiceNumber: `INV-${invoice.id.slice(-8).toUpperCase()}`,
    currency: invoice.currency,
    shippingFee: invoice.shippingFee,
    discount: discount,
    items: invoice.items.map(
      (item: any): InvoiceItem => {
        // Apply discount proportionally if it exists and is non-zero
        // Discount is usually negative in invoice.discount
        let adjustedUnitPrice = item.unitPrice;
        let adjustedTotal = item.total;

        if (discount !== 0 && itemsGrossTotal !== 0) {
            // Calculate proportion of this item's total to the gross total
            const ratio = item.total / itemsGrossTotal;
            // Distribute discount amount (add because discount is negative)
            const itemDiscountShare = discount * ratio;
            
            adjustedTotal = item.total + itemDiscountShare;
            if (item.quantity > 0) {
                adjustedUnitPrice = adjustedTotal / item.quantity;
            }
        }

        return {
        id: item.id,
        sku: item.sku,
        name: item.description || item.product?.name || item.sku,
        quantity: item.quantity,
            unitPrice: adjustedUnitPrice,
            total: adjustedTotal,
        };
      }
    ),
    filename: invoice.pdfFileName || "invoice.pdf",
    pdfUrl: pdfUrl, // HTTP URL for iframe preview (cached with Cache-Control headers)
    pdfDownloadUrl: pdfUrl, // HTTP URL for download/open in new tab
    pdfFilePath: invoice.pdfFilePath || null,
    status: invoice.status,
    createdAt: invoice.createdAt,
  };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const invoiceId = params.invoiceId;

  if (!invoiceId) {
    throw new Response("Invoice ID is required", { status: 400 });
  }

  // Get invoice from database
  const invoice = await getInvoiceById(invoiceId);

  if (!invoice) {
    throw new Response("Invoice not found", { status: 404 });
  }

  // Get all suppliers for the dropdown
  const suppliers = await getAllSuppliers();

  // Check Google Sheets configuration
  const sheetsSettings = await loadGoogleSheetsSettings();
  const hasGoogleSheets = !!(sheetsSettings.spreadsheetId && (sheetsSettings.serviceAccountConfig || sheetsSettings.oauth2Config));

  // Transform invoice data for UI
  const extractedData = await transformInvoiceForUI(invoice);

  return json({
    extractedData,
    suppliers: suppliers.map((s) => ({ label: s.name, value: s.id })),
    logs: invoice.logs || [],
    hasGoogleSheets,
    sheetsConfig: {
      hasServiceAccount: !!sheetsSettings.serviceAccountConfig,
      hasOAuth2: !!sheetsSettings.oauth2Config,
      hasSpreadsheet: !!sheetsSettings.spreadsheetId
    }
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, redirect } = await authenticate.admin(request);

  const formData = await request.formData();
  const action = formData.get("_action") as string;
  const invoiceId = params.invoiceId!;

  if (action === "confirm") {
    // Perform import (mocked delay here)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let successMessage = "Invoice imported successfully";

    try {
      const { getInvoiceById, updateInvoice } = await import(
        "../utils/invoice.server"
      );
      const invoiceId = params.invoiceId!;
      
      // Get invoice data before updating status
      const invoice = await getInvoiceById(invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }

      // Get edited data from form (if any)
      const editedItemsData = formData.get("editedItems");
      const editedShippingFeeData = formData.get("editedShippingFee");
      
      let editedItems = null;
      let editedShippingFee: number | undefined = undefined;
      
      if (editedItemsData) {
        try {
          editedItems = JSON.parse(editedItemsData as string);
          console.log("-----> Using edited items from form:", editedItems.length);
          console.log("-----> Edited items:", editedItems);
        } catch (error) {
          console.log("-----> Failed to parse edited items, using original data");
        }
      } else {
        console.log("-----> No edited items data found, using original invoice data");
      }
      
      if (editedShippingFeeData) {
        try {
          editedShippingFee = parseFloat(editedShippingFeeData as string);
          console.log("-----> Using edited shipping fee from form:", editedShippingFee);
        } catch (error) {
          console.log("-----> Failed to parse edited shipping fee, using original data");
        }
      }

      // Mark invoice as confirmed so it stops showing as pending
      await updateInvoice(invoiceId, { status: "SUCCESS" });

      // Email imports and calculations commented out for now
      /*
      const { sendParsingEmail } = await import("../services/notify");
      const itemsTotal = (invoice?.items || []).reduce(
        (s, it) => s + (it.total || 0),
        0,
      );
      const shipping = invoice?.shippingFee || 0;
      const grandTotal = Math.round((itemsTotal + shipping) * 100) / 100;
      */

      // Process Google Sheets CMP update with edited data and shipping fee
      console.log("-----> Starting Google Sheets CMP processing");
      const sheetsResult = await processInvoiceWithGoogleSheets(invoice, admin, editedItems, editedShippingFee);
      console.log("-----> Google Sheets result:", sheetsResult);

      // Success email on confirmed import (commented out for now)
      /*
      try {
        await sendParsingEmail({
          success: true,
          supplierName: invoice?.supplier?.name || "",
          totalPrice: grandTotal,
          itemsCount: invoice?.items?.length || 0,
          warnings: sheetsResult.success ? undefined : [sheetsResult.message],
        });
        console.log("Confirmation email sent successfully");
      } catch (emailError: any) {
        console.error(
          "Failed to send confirmation email:",
          emailError?.message || emailError,
        );
        // Don't fail the entire operation if email fails
      }
      */

      // Prepare success message with Google Sheets info
      if (sheetsResult.success) {
        successMessage += ` and Google Sheets CMP updated (${sheetsResult.message})`;
      } else {
        successMessage += `. Note: ${sheetsResult.message}`;
      }

    } catch (e: any) {
      console.error("Failed to process confirmation:", e?.message || e);
      throw e; // Re-throw the main error
    }

    return redirect(`/app/history?success=${encodeURIComponent(successMessage)}`);
  }

  if (action === "reject") {
    try {
      const { getInvoiceById, updateInvoice } = await import(
        "../utils/invoice.server"
      );
      const invoiceId = params.invoiceId!;
      // Mark invoice as cancelled/rejected
      await updateInvoice(invoiceId, { status: "CANCELLED" as any });
      const invoice = await getInvoiceById(invoiceId);

      // Email sending commented out for now
      /*
      const { sendParsingEmail } = await import("../services/notify");
      const itemsTotal = (invoice?.items || []).reduce(
        (s, it) => s + (it.total || 0),
        0,
      );
      const shipping = invoice?.shippingFee || 0;
      const grandTotal = Math.round((itemsTotal + shipping) * 100) / 100;

      await sendParsingEmail({
        success: false,
        supplierName: invoice?.supplier?.name || "",
        totalPrice: grandTotal,
        errorMessage: "User cancelled import",
      });
      */
    } catch (e: any) {
      console.warn("Failed to send rejection email:", e?.message || e);
    }
    return redirect("/app/upload?error=Invoice processing cancelled");
  }

  if (action === "reparse") {
    try {
      const { reprocessInvoicePdf } = await import(
        "../services/invoiceProcessing.server"
      );
      await reprocessInvoicePdf(invoiceId);
      return json({ success: true, message: "PDF re-parsed successfully" });
    } catch (error) {
      console.error("Re-parsing failed:", error);
      return json(
        {
          error: error instanceof Error ? error.message : "Re-parsing failed",
        },
        { status: 500 },
      );
    }
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function InvoiceReview() {
  const { extractedData, suppliers, hasGoogleSheets, sheetsConfig } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [editableItems, setEditableItems] = useState(extractedData.items);
  const [editableSupplier, setEditableSupplier] = useState(
    extractedData.supplierId,
  );
  const [editableInvoiceDate, setEditableInvoiceDate] = useState(
    extractedData.invoiceDate,
  );
  const [editableShippingFee, setEditableShippingFee] = useState(
    extractedData.shippingFee.toString(),
  );
  // We don't allow editing discount directly yet, but we display it? 
  // Actually the transformed items already include the discount.
  // If we want to show the discount, we can add it to the UI.


  // Pagination state for performance with large item lists
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const isSubmitting = navigation.state === "submitting";
  const isProcessing = extractedData.status === "PROCESSING";

  // Auto-refresh while background processing is running
  // This keeps the page updated until items are parsed and saved
  useEffect(() => {
    if (extractedData.status === "PROCESSING") {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [extractedData.status, revalidator]);

  // Sync local editable state with latest extracted data after revalidation
  useEffect(() => {
    setEditableItems(extractedData.items);
    setEditableSupplier(extractedData.supplierId);
    setEditableInvoiceDate(extractedData.invoiceDate);
    setEditableShippingFee(extractedData.shippingFee.toString());
  }, [
    extractedData.items,
    extractedData.supplierId,
    extractedData.invoiceDate,
    extractedData.shippingFee,
  ]);

  const updateItem = (itemId: string, field: string, value: string) => {
    setEditableItems((items) =>
      items.map((item) => {
        if (item.id === itemId) {
          const updatedItem = {
            ...item,
            [field]:
              field === "quantity" || field === "unitPrice"
                ? parseFloat(value) || 0
                : value,
          };
          // Recalculate total when quantity or unitPrice changes
          if (field === "quantity" || field === "unitPrice") {
            updatedItem.total = updatedItem.quantity * updatedItem.unitPrice;
          }
          return updatedItem;
        }
        return item;
      }),
    );
  };

  const addNewItem = () => {
    const newItem = {
      id: Date.now().toString(),
      sku: "",
      name: "",
      quantity: 0,
      unitPrice: 0,
      total: 0,
    };
    setEditableItems((items) => {
      const newItems = [...items, newItem];
      // Navigate to the page where the new item will be visible
      const newTotalPages = Math.ceil(newItems.length / itemsPerPage);
      setCurrentPage(newTotalPages);
      return newItems;
    });
  };

  const removeItem = (itemId: string) => {
    setEditableItems((items) => {
      const newItems = items.filter((item) => item.id !== itemId);
      // Adjust current page if we're on a page that no longer exists
      const newTotalPages = Math.ceil(newItems.length / itemsPerPage);
      if (currentPage > newTotalPages && newTotalPages > 0) {
        setCurrentPage(newTotalPages);
      }
      return newItems;
    });
  };

  const calculateSubtotal = () => {
    return editableItems.reduce((sum, item) => sum + item.total, 0);
  };

  const calculateTotal = () => {
    return calculateSubtotal() + parseFloat(editableShippingFee || "0");
  };

  // Pagination calculations
  const totalItems = editableItems.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = editableItems.slice(startIndex, endIndex);

  // Use real suppliers provided by loader
  const supplierOptions = suppliers;

  const tableRows = currentItems.map((item, index) => [
    <TextField
      label=""
      labelHidden
      value={item.sku}
      onChange={(value: string) => updateItem(item.id, "sku", value)}
      autoComplete="off"
      disabled={isProcessing}
    />,
    <TextField
      label=""
      labelHidden
      value={item.name}
      onChange={(value: string) => updateItem(item.id, "name", value)}
      autoComplete="off"
      disabled={isProcessing}
    />,
    <TextField
      label=""
      labelHidden
      value={item.quantity.toString()}
      onChange={(value: string) => updateItem(item.id, "quantity", value)}
      type="number"
      autoComplete="off"
      disabled={isProcessing}
    />,
    <TextField
      label=""
      labelHidden
      value={item.unitPrice.toString()}
      onChange={(value: string) => updateItem(item.id, "unitPrice", value)}
      type="number"
      step={0.01}
      autoComplete="off"
      disabled={isProcessing}
    />,
    <Text as="span" variant="bodyMd">
      €{item.quantity > 0 ? (item.total / item.quantity).toFixed(2) : "0.00"}
    </Text>,
    <Text as="span" variant="bodyMd">
      €{item.total.toFixed(2)}
    </Text>,
    <Button
      variant="plain"
      tone="critical"
      onClick={() => removeItem(item.id)}
      disabled={editableItems.length <= 1 || isProcessing}
    >
      Remove
    </Button>,
  ]);

  const headings = [
    "SKU",
    "Description",
    "Quantity",
    "Unit Price (€)",
    "Discount ",
    "Total (€)",
    "Actions",
  ];

  // Show loading state when invoice is still processing
  if (isProcessing) {
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
                  We're extracting data from your PDF. This usually takes a few seconds...
                </Text>
                <Banner tone="info">
                  <p>
                    The page will automatically refresh when processing is complete.
                  </p>
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
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

            {actionData && "error" in actionData && actionData.error && (
              <Banner tone="critical">{actionData.error}</Banner>
            )}

            {actionData && "success" in actionData && actionData.success && (
              <Banner tone="success">
                {actionData.message || "Operation completed successfully"}
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Invoice Information
                </Text>

                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="Supplier"
                      options={supplierOptions}
                      value={editableSupplier}
                      onChange={setEditableSupplier}
                      disabled={isProcessing}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Invoice Date"
                      value={editableInvoiceDate}
                      onChange={setEditableInvoiceDate}
                      type="date"
                      autoComplete="off"
                      disabled={isProcessing}
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Invoice Number"
                      value={extractedData.invoiceNumber}
                      disabled
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Currency"
                      value={extractedData.currency}
                      disabled
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    Invoice Items
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    {totalItems} total items
                  </Text>
                </InlineStack>

                {totalItems === 0 ? (
                  <EmptyState
                    heading="No items found"
                    subheading="Add items to this invoice"
                    action={{
                      content: "Add Item",
                      onAction: addNewItem,
                    }}
                  />
                ) : (
                  <>
                    <DataTable
                      columnContentTypes={[
                        "text",
                        "text",
                        "numeric",
                        "numeric",
                        "numeric",
                        "numeric",
                        "text",
                      ]}
                      headings={headings}
                      rows={tableRows}
                    />

                    {totalPages > 1 && (
                      <InlineStack align="center">
                        <Pagination
                          hasPrevious={currentPage > 1}
                          onPrevious={() => setCurrentPage(currentPage - 1)}
                          hasNext={currentPage < totalPages}
                          onNext={() => setCurrentPage(currentPage + 1)}
                          label={`Page ${currentPage} of ${totalPages}`}
                        />
                      </InlineStack>
                    )}

                    <InlineStack gap="200">
                      <Button variant="plain" onClick={addNewItem}>
                        + Add Item
                      </Button>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of {totalItems} items
                      </Text>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Divider />

                <InlineStack gap="400" align="end">
                  <div style={{ minWidth: "200px" }}>
                    <TextField
                      label="Shipping Fee (€)"
                      value={editableShippingFee}
                      onChange={setEditableShippingFee}
                      type="number"
                      step={0.01}
                      autoComplete="off"
                      disabled={isProcessing}
                    />
                  </div>
                </InlineStack>

                <Box
                  padding="400"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" as="span">
                        Subtotal:
                      </Text>
                      <Text variant="bodyMd" as="span">
                        €{calculateSubtotal().toFixed(2)}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" as="span">
                        Shipping:
                      </Text>
                      <Text variant="bodyMd" as="span">
                        €{parseFloat(editableShippingFee || "0").toFixed(2)}
                      </Text>
                    </InlineStack>
                    {extractedData.discount !== 0 && (
                        <InlineStack align="space-between">
                        <Text variant="bodyMd" as="span" tone="subdued">
                            Discount (applied to items):
                        </Text>
                        <Text variant="bodyMd" as="span" tone="subdued">
                            €{extractedData.discount.toFixed(2)}
                        </Text>
                        </InlineStack>
                    )}
                    <Divider />
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h3">
                        Total:
                      </Text>
                      <Text variant="headingMd" as="h3">
                        €{calculateTotal().toFixed(2)}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Actions
                </Text>

                <Form method="post">
                  {/* Hidden field with edited items data */}
                  <input 
                    type="hidden" 
                    name="editedItems" 
                    value={JSON.stringify(editableItems)} 
                  />
                  <input 
                    type="hidden" 
                    name="editedSupplier" 
                    value={editableSupplier} 
                  />
                  <input 
                    type="hidden" 
                    name="editedInvoiceDate" 
                    value={editableInvoiceDate} 
                  />
                  <input 
                    type="hidden" 
                    name="editedShippingFee" 
                    value={editableShippingFee} 
                  />
                  
                  <InlineStack gap="300">
                    <button
                      type="submit"
                      name="_action"
                      value="confirm"
                      disabled={isSubmitting || isProcessing}
                      style={{
                        backgroundColor: "#008060",
                        color: "white",
                        border: "none",
                        padding: "8px 16px",
                        borderRadius: "4px",
                        cursor: (isSubmitting || isProcessing) ? "not-allowed" : "pointer",
                        opacity: (isSubmitting || isProcessing) ? 0.6 : 1,
                      }}
                    >
                      {isSubmitting &&
                      navigation.formData?.get("_action") === "confirm"
                        ? "Importing..."
                        : "Confirm & Import"}
                    </button>

                    <button
                      type="submit"
                      name="_action"
                      value="reject"
                      disabled={isSubmitting || isProcessing}
                      style={{
                        backgroundColor: "#f6f6f7",
                        color: "#202223",
                        border: "1px solid #c9cccf",
                        padding: "8px 16px",
                        borderRadius: "4px",
                        cursor: (isSubmitting || isProcessing) ? "not-allowed" : "pointer",
                        opacity: (isSubmitting || isProcessing) ? 0.6 : 1,
                      }}
                    >
                      Cancel Import
                    </button>

                    <button
                      type="submit"
                      name="_action"
                      value="reparse"
                      disabled={isSubmitting || isProcessing}
                      style={{
                        backgroundColor: "#f6f6f7",
                        color: "#202223",
                        border: "1px solid #c9cccf",
                        padding: "8px 16px",
                        borderRadius: "4px",
                        cursor: (isSubmitting || isProcessing) ? "not-allowed" : "pointer",
                        opacity: (isSubmitting || isProcessing) ? 0.6 : 1,
                      }}
                    >
                      Re-parse PDF
                    </button>

                    <Button url="/app/upload" disabled={isSubmitting || isProcessing}>
                      Back to Upload
                    </Button>
                  </InlineStack>
                </Form>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          {/* PDF Preview */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                PDF Preview
              </Text>

              {/* PDF Preview with real file */}
              <div
                style={{
                  height: "400px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  overflow: "hidden",
                }}
              >
                <iframe
                  src={extractedData.pdfUrl || ""}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "none",
                  }}
                  title="PDF Preview"
                  key={extractedData.pdfUrl || ""}
                  loading="lazy"
                />
              </div>

              <InlineStack gap="200">
                <Button
                  variant="plain"
                  url={extractedData.pdfDownloadUrl || ""}
                  target="_blank"
                >
                  Open in New Tab
                </Button>
                <Button
                  variant="plain"
                  onClick={() => {
                    const link = document.createElement("a");
                    link.href = extractedData.pdfDownloadUrl || "";
                    link.download = extractedData.filename;
                    link.click();
                  }}
                >
                  Download Original
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Processing Status */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Processing Status
              </Text>

              <Badge tone="success">✅ PDF Processed</Badge>
              <Badge tone="success">✅ Data Extracted</Badge>
              <Badge tone="attention">⏳ Awaiting Confirmation</Badge>

              <Text variant="bodyMd" as="p" tone="subdued">
                Original file: {extractedData.filename}
              </Text>
            </BlockStack>
          </Card>

          {/* Processing Timeline */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Processing Timeline
              </Text>

              <BlockStack gap="200">
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
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

                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      backgroundColor: "#008060",
                      borderRadius: "50%",
                    }}
                  ></div>
                  <Text variant="bodyMd" as="p">
                    Processed: Just now
                  </Text>
                </div>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
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
          </Card>

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
                    CMP will be automatically calculated and updated in your Google Sheets after confirmation.
                  </Text>
                </BlockStack>
              ) : (
                <BlockStack gap="200">
                  <Badge tone="attention">⚠️ Google Sheets Not Configured</Badge>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    CMP processing will be skipped. Configure Google Sheets in the API settings to enable automatic CMP updates.
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
        </Layout.Section>
      </Layout>
    </Page>
  );
}
