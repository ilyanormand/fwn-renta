import db from "../../db.server";
import { createLogEntry } from "../../utils/invoice.server";
import { processInvoicePdf } from "./invoiceProcessing.server";
import {
  cancelJob,
  deleteJobById,
  getJobById,
  getJobByInvoiceId,
  resetJobToPending,
} from "../../utils/job.server";
import { deletePdfFile } from "../../utils/fileUpload.server";

// Re-parse an existing invoice (useful for fixing parsing errors)
export async function reprocessInvoicePdf(invoiceId: string) {
  await db.invoiceItem.deleteMany({
    where: { invoiceId },
  });

  // Log reprocessing start
  await createLogEntry(
    invoiceId,
    "PROCESSING",
    "INFO",
    "Reprocessing invoice PDF"
  );
  const existingJob = await getJobByInvoiceId(invoiceId, "PDF_PROCESSING");
  if (existingJob) {
    await resetJobToPending(existingJob.id);
    console.log(
      `🔄 Reset job ${existingJob.id} to PENDING for reprocessing invoice ${invoiceId}`
    );
    return { success: true, status: "success", message: `Reparsing started` };
  } else {
    return {
      success: false,
      status: "error",
      message: `Please cancel the invoice and try again`,
    };
  }
}

export async function cancelInvoicePdf(jobId: string) {
  const job = await getJobById(jobId);
  if (!job) {
    console.error(`❌ Job ${jobId} not found`);
    return { success: false, message: `Job ${jobId} not found` };
  }
  const fileName = job.data?.fileName as string | undefined;
  if (fileName) {
    const deleteResult = await deletePdfFile(fileName);
    if (!deleteResult.success) {
      console.warn(`⚠️ Failed to delete PDF file: ${deleteResult.error}`);
      await deleteJobById(jobId);
      return {
        success: true,
        message: `⚠️ Failed to delete PDF file, but job deleted successfully`,
      };
    } else {
      await deleteJobById(jobId);
      return { success: true, message: `PDF file deleted successfully` };
    }
  } else {
    await deleteJobById(jobId);
    return { success: true, message: `Job don't have a PDF file` };
  }
}
