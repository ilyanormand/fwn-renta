import {
  failJob,
  getJobById,
  completeJob,
  updateJobProgress,
} from "app/utils/job.server";
import { getInvoiceById, updateInvoice } from "../../utils/invoice.server";
import {
  getAdminFromShopDomain,
  loadGoogleSheetsSettings,
  mapInvoiceItemsToProcessorInvoiceItems,
  chooseService,
} from "./middlewareCmp";
import { updateCmpInSheets } from "../googleSheets/cmpHandle/cmpCalculate";

export async function calculateCmp(
  invoiceId: string,
  jobId: string
): Promise<void> {
  try {
    const job = await getJobById(jobId);
    if (!job) {
      await updateInvoice(invoiceId, {
        status: "ERROR",
      });
      await failJob(jobId, "Job not found");
      return;
    }

    await updateJobProgress(jobId, 10, {
      stage: "loading_data",
      message: "Loading invoice data...",
    });

    const invoice = await getInvoiceById(invoiceId);
    if (!invoice) {
      await updateInvoice(invoiceId, {
        status: "ERROR",
      });
      await failJob(jobId, "Invoice not found");
      return;
    }

    await updateJobProgress(jobId, 20, {
      stage: "getting_admin",
      message: "Creating admin client...",
    });

    const admin = await getAdminFromShopDomain(job);
    if (!admin) {
      const errorMessage = "Admin not found - session not available for shop";
      await updateInvoice(invoiceId, {
        status: "ERROR",
      });
      await failJob(jobId, errorMessage);
      throw new Error(errorMessage);
    }

    await updateJobProgress(jobId, 30, {
      stage: "loading_settings",
      message: "Loading Google Sheets settings...",
    });

    const settings = await loadGoogleSheetsSettings();
    if (!settings.spreadsheetId) {
      await updateInvoice(invoiceId, {
        status: "ERROR",
      });
      await failJob(
        jobId,
        "Google Sheets not configured - spreadsheetId missing"
      );
      return;
    }

    const invoiceItems = mapInvoiceItemsToProcessorInvoiceItems(
      job.data.editedItems || invoice.items
    );

    await updateJobProgress(jobId, 40, {
      stage: "preparing",
      message: `Preparing to process ${invoiceItems.length} items...`,
      total: invoiceItems.length,
    });

    const { sheetsService } = chooseService(settings);
    if (!sheetsService) {
      await updateInvoice(invoiceId, {
        status: "ERROR",
      });
      await failJob(
        jobId,
        "Google Sheets authentication not available - no service configured"
      );
      return;
    }

    const shippingFee =
      job.data.editedShippingFee !== undefined
        ? job.data.editedShippingFee
        : invoice.shippingFee || 0;

    await updateJobProgress(jobId, 50, {
      stage: "fetching_inventory",
      message: `Fetching inventory from Shopify...`,
      total: invoiceItems.length,
    });

    const progressCallback = async (
      current: number,
      total: number,
      sku?: string
    ) => {
      const progress = 50 + Math.floor((current / total) * 40);
      await updateJobProgress(jobId, progress, {
        stage: "calculating_cmp",
        current,
        total,
        message: `Calculating CMP: ${current}/${total} items`,
        sku,
      });
    };

    const result = await updateCmpInSheets(
      invoiceItems,
      sheetsService,
      shippingFee,
      admin,
      progressCallback
    );

    await updateJobProgress(jobId, 100, {
      stage: "completed",
      message: `CMP calculation completed: ${result.updated} rows updated`,
    });

    await updateInvoice(invoiceId, {
      status: "SUCCESS",
    });
    await completeJob(jobId, {
      invoiceId: invoiceId,
      status: "SUCCESS",
      calculatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await failJob(jobId, errorMessage);
    throw error;
  }
}
