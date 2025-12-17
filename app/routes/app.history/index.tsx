import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useRevalidator,
  useActionData,
  useSearchParams,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  InlineStack,
  Text,
  Pagination,
  Select,
  BlockStack,
  Popover,
  ActionList,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  ArrowDownIcon,
  MenuHorizontalIcon,
  DeleteIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../../shopify.server";
import { getAllInvoices, getAllSuppliers } from "../../utils/invoice.server";
import { getPdfUrl } from "../../utils/fileUpload.server";

// Transform database invoice data for the UI
function transformInvoicesForUI(invoices: any[]) {
  return invoices.map((invoice) => ({
    id: invoice.id,
    supplier: invoice.supplier.name,
    status: invoice.status.toLowerCase(),
    filename: invoice.pdfFileName || "invoice.pdf",
    createdAt: invoice.createdAt,
    errorMessage:
      invoice.logs?.find((log: any) => log.status === "ERROR")?.message || null,
    pdfUrl: invoice.pdfFileName ? getPdfUrl(invoice.pdfFileName) : null,
  }));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  try {
    // Get real invoices and suppliers from database
    const [dbInvoices, dbSuppliers] = await Promise.all([
      getAllInvoices(),
      getAllSuppliers(),
    ]);

    if (!dbInvoices || !Array.isArray(dbInvoices)) {
      console.warn("No invoices found in database");
      return json({ invoices: [], suppliers: [] });
    }

    const invoices = transformInvoicesForUI(dbInvoices);
    const suppliers = (dbSuppliers || [])
      .filter((supplier) => supplier && supplier.name)
      .map((supplier) => ({
        label: supplier.name,
        value: supplier.name,
      }));

    return json({ invoices: invoices || [], suppliers });
  } catch (error) {
    console.error("Error loading invoices:", error);
    return json({ invoices: [], suppliers: [] });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const action = formData.get("_action") as string;
  const invoiceId = formData.get("invoiceId") as string;

  if (action === "delete" && invoiceId) {
    try {
      const { deleteInvoiceById } = await import("../../utils/invoice.server");
      const result = await deleteInvoiceById(invoiceId);
      if (result.success) {
        return json({
          success: true,
          status: result.status,
          message: result.message,
        });
      } else {
        return json({
          success: false,
          status: result.status,
          message: result.message,
        });
      }
    } catch (error) {
      console.error("Delete invoice failed:", error);
      return json(
        {
          success: false,
          status: "error",
          message: error instanceof Error ? error.message : "Delete failed",
        },
        { status: 500 }
      );
    }
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

function getStatusBadge(status: string, errorMessage?: string | null) {
  switch (status) {
    case "success":
      return <Badge tone="success">✅ Success</Badge>;
    case "error":
      return (
        <Badge tone="critical">
          {`❌ Error: ${errorMessage || "Unknown error"}`}
        </Badge>
      );
    case "processing":
      return <Badge tone="info">⏳ Processing...</Badge>;
    case "pending_review":
      return <Badge tone="attention">📋 Pending Review</Badge>;
    case "cancelled":
      return <Badge tone="warning">🚫 Cancelled</Badge>;
    default:
      return <Badge>Unknown</Badge>;
  }
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function History() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const invoices = loaderData?.invoices || [];
  const suppliers = loaderData?.suppliers || [];
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const fetcher = useFetcher();
  const revalidator = useRevalidator();

  // Get message from URL params or action data
  const successMessage = searchParams.get("success");
  const errorMessage = searchParams.get("error");

  // Extract message from fetcher data (for delete action)
  const deleteResult = fetcher.data as
    | { success: boolean; status?: string; message?: string }
    | undefined;

  // Reset dismissed banner when new message appears
  useEffect(() => {
    if (successMessage || errorMessage || deleteResult) {
      setDismissedBanner(false);
    }
  }, [successMessage, errorMessage, deleteResult]);

  const supplierOptions = [
    { label: "All suppliers", value: "all" },
    ...(suppliers || []).filter(
      (s): s is { label: string; value: string } =>
        s !== null && s !== undefined
    ),
  ];

  // Early return if no data loaded
  if (!loaderData) {
    return (
      <Page>
        <TitleBar title="Import History" />
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" align="center">
                <Text variant="headingMd" as="h2">
                  Loading...
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const itemsPerPage = 10;

  // Filter invoices based on status and supplier
  const filteredInvoices = invoices.filter((invoice) => {
    const matchesStatus =
      statusFilter === "all" || invoice.status === statusFilter;
    const matchesSupplier =
      supplierFilter === "all" || invoice.supplier === supplierFilter;
    return matchesStatus && matchesSupplier;
  });

  // Paginate results
  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedInvoices = filteredInvoices.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  const handleDownload = async (invoiceId: string, filename: string) => {
    try {
      console.log(`Generating Excel for invoice ${invoiceId}`);

      // Call API to generate Excel file
      const response = await fetch(
        `/app/api/invoice/${invoiceId}/export-excel`,
        {
          method: "GET",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to generate Excel file");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice_${invoiceId}_export.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setActivePopover(null);
    } catch (error) {
      console.error("Download failed:", error);
      alert("Failed to download Excel file. Please try again.");
    }
  };

  const handleDownloadPdf = async (pdfUrl: string, filename: string) => {
    if (!pdfUrl) return;

    try {
      const fullUrl = pdfUrl.startsWith("http")
        ? pdfUrl
        : `${window.location.origin}${pdfUrl}`;

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
      link.download = filename || "invoice.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
      setActivePopover(null);
    } catch (error) {
      console.error("Error downloading PDF:", error);
      alert("Failed to download PDF file. Please try again.");
    }
  };

  const togglePopover = (invoiceId: string) => {
    setActivePopover(activePopover === invoiceId ? null : invoiceId);
  };

  const handleDelete = (invoiceId: string) => {
    if (confirm("Are you sure you want to delete this invoice?")) {
      const formData = new FormData();
      formData.append("_action", "delete");
      formData.append("invoiceId", invoiceId);
      fetcher.submit(formData, { method: "post" });
      setActivePopover(null);
    }
  };

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      typeof fetcher.data === "object" &&
      "success" in fetcher.data &&
      fetcher.data.success
    ) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const renderActionMenu = (invoice: any) => {
    if (invoice.status === "pending_review") {
      return (
        <Button variant="primary" url={`/app/review/${invoice.id}`}>
          Review
        </Button>
      );
    }

    if (invoice.status === "processing") {
      return (
        <Text variant="bodyMd" as="span" tone="subdued">
          Processing...
        </Text>
      );
    }

    const actions = [];

    if (invoice.status === "success") {
      actions.push({
        content: "Download",
        icon: ArrowDownIcon,
        onAction: () => handleDownload(invoice.id, invoice.filename),
      });
    }

    if (invoice.status === "error" || invoice.status === "cancelled") {
      if (invoice.pdfUrl) {
        actions.push({
          content: "Download PDF",
          icon: ArrowDownIcon,
          onAction: () => handleDownloadPdf(invoice.pdfUrl, invoice.filename),
        });
      }
      actions.push({
        content: "Delete",
        icon: DeleteIcon,
        destructive: true,
        onAction: () => handleDelete(invoice.id),
      });
    }
    if (actions.length === 0) {
      return null;
    }

    return (
      <Popover
        active={activePopover === invoice.id}
        activator={
          <Button
            variant="tertiary"
            icon={MenuHorizontalIcon}
            onClick={() => togglePopover(invoice.id)}
            accessibilityLabel="More actions"
          />
        }
        onClose={() => setActivePopover(null)}
      >
        <ActionList items={actions} />
      </Popover>
    );
  };

  const statusOptions = [
    { label: "All statuses", value: "all" },
    { label: "Success", value: "success" },
    { label: "Error", value: "error" },
    { label: "Processing", value: "processing" },
  ];

  const tableRows = paginatedInvoices.map((invoice) => [
    formatDate(invoice.createdAt),
    invoice.supplier,
    getStatusBadge(invoice.status, invoice.errorMessage),
    renderActionMenu(invoice),
  ]);

  const headings = ["Date", "Supplier", "Status", "Actions"];

  return (
    <Page>
      <TitleBar title="Import History" />
      <Layout.Section variant="oneThird">
        <div style={{ width: "max-content" }}>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Import Statistics
              </Text>
              {(() => {
                const total = invoices.length;
                const successful = invoices.filter(
                  (i) => i.status === "success"
                ).length;
                const failed = invoices.filter(
                  (i) => i.status === "error"
                ).length;
                const processing = invoices.filter(
                  (i) => i.status === "processing"
                ).length;
                const successRate =
                  total > 0 ? Math.round((successful / total) * 100) : 0;

                return (
                  <InlineStack gap="400">
                    <InlineStack blockAlign="end" gap="200">
                      <Text variant="bodyMd" as="p">
                        Total Invoices
                      </Text>
                      <Text variant="headingLg" as="h3">
                        {total}
                      </Text>
                    </InlineStack>

                    <InlineStack blockAlign="end" gap="200">
                      <Text variant="bodyMd" as="p">
                        Successful
                      </Text>
                      <Text variant="headingLg" as="h3" tone="success">
                        {successful}
                      </Text>
                    </InlineStack>

                    <InlineStack blockAlign="end" gap="200">
                      <Text variant="bodyMd" as="p">
                        Failed
                      </Text>
                      <Text variant="headingLg" as="h3" tone="critical">
                        {failed}
                      </Text>
                    </InlineStack>

                    <InlineStack blockAlign="end" gap="200">
                      <Text variant="bodyMd" as="p">
                        Processing
                      </Text>
                      <Text variant="headingLg" as="h3">
                        {processing}
                      </Text>
                    </InlineStack>

                    <InlineStack blockAlign="end" gap="200">
                      <Text variant="bodyMd" as="p">
                        Success Rate
                      </Text>
                      <Text variant="headingLg" as="h3" tone="success">
                        {successRate}%
                      </Text>
                    </InlineStack>
                  </InlineStack>
                );
              })()}
            </BlockStack>
          </Card>
        </div>
      </Layout.Section>
      {!dismissedBanner && (successMessage || errorMessage || deleteResult) && (
        <Layout.Section>
          {successMessage && (
            <Banner tone="success" onDismiss={() => setDismissedBanner(true)}>
              {successMessage}
            </Banner>
          )}
          {errorMessage && (
            <Banner tone="critical" onDismiss={() => setDismissedBanner(true)}>
              {errorMessage}
            </Banner>
          )}
          {deleteResult && deleteResult.message && (
            <Banner
              tone={
                deleteResult.status === "success"
                  ? "success"
                  : deleteResult.status === "error"
                    ? "critical"
                    : "info"
              }
              onDismiss={() => setDismissedBanner(true)}
            >
              {deleteResult.message}
            </Banner>
          )}
        </Layout.Section>
      )}
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" align="space-between">
              <Text variant="headingMd" as="h2">
                Invoice Import History
              </Text>
              <Button variant="primary" url="/app/upload">
                Upload New Invoice
              </Button>
            </InlineStack>

            {/* Filters */}
            <InlineStack gap="300">
              <div style={{ minWidth: "200px" }}>
                <Select
                  label="Filter by status"
                  options={statusOptions}
                  onChange={setStatusFilter}
                  value={statusFilter}
                />
              </div>
              <div style={{ minWidth: "200px" }}>
                <Select
                  label="Filter by supplier"
                  options={supplierOptions}
                  onChange={setSupplierFilter}
                  value={supplierFilter}
                />
              </div>
            </InlineStack>

            {/* Results summary */}
            <Text variant="bodyMd" as="p" tone="subdued">
              Showing {paginatedInvoices.length} of {filteredInvoices.length}{" "}
              invoices
            </Text>

            {/* Data table */}
            <div>
              <style>{`
                .Polaris-DataTable__Table th:nth-child(3),
                .Polaris-DataTable__Table td:nth-child(3) {
                  max-width: 350px;
                  word-wrap: break-word;
                  word-break: break-word;
                  white-space: normal;
                  overflow-wrap: break-word;
                }
              `}</style>
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={headings}
                rows={tableRows}
                footerContent={
                  totalPages > 1 ? (
                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() => setCurrentPage(currentPage - 1)}
                      hasNext={currentPage < totalPages}
                      onNext={() => setCurrentPage(currentPage + 1)}
                      label={`Page ${currentPage} of ${totalPages}`}
                    />
                  ) : undefined
                }
              />
            </div>

            {filteredInvoices.length === 0 && (
              <div style={{ textAlign: "center", padding: "10px" }}>
                <Text variant="bodyMd" as="p" tone="subdued">
                  No invoices found matching your filters.
                </Text>
              </div>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Page>
  );
}

// Error Boundary for error handling
export function ErrorBoundary() {
  return (
    <Page>
      <TitleBar title="Import History - Error" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400" align="center">
              <Text variant="headingMd" as="h2">
                Something went wrong
              </Text>
              <Text variant="bodyMd" as="p" tone="subdued">
                Failed to load import history. Please refresh the page or
                contact support.
              </Text>
              <Button url="/app">Back to Dashboard</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
