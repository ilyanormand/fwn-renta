import { processInvoicePdf } from "./invoiceProcessing.server";
import {
  getNextJob,
  startJob,
  completeJob,
  failJob,
} from "../../utils/job.server";
import { createLogEntry } from "../../utils/invoice.server";
import { MAX_CONCURRENT_JOBS } from "../../utils/storage.server";

// Background worker for processing jobs
export class BackgroundWorker {
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;
  private readonly maxConcurrentJobs = MAX_CONCURRENT_JOBS;
  private currentConcurrentJobs = 0;
  private readonly pollInterval = 5000;

  // Start the background worker
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.tryProcessJob();
    this.intervalId = setInterval(() => {
      this.tryProcessJob();
    }, this.pollInterval);
  }

  // Stop the background worker
  stop(): void {
    if (!this.isRunning) {
      console.log("Background worker is not running");
      return;
    }
    console.log("🛑 Stopping background worker...");
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private tryProcessJob(): void {
    if (this.currentConcurrentJobs >= this.maxConcurrentJobs) {
      return;
    }
    this.processSingleJob().catch((error) => {
      console.error("Error processing job:", error);
    });
  }

  private async processSingleJob(): Promise<void> {
    const job = await getNextJob("PDF_PROCESSING");
    if (!job) {
      return;
    }
    this.currentConcurrentJobs++;
    try {
      await startJob(job.id);
      await processInvoicePdf(job.data.invoiceId, job.id);
      await completeJob(job.id, {
        invoiceId: job.data.invoiceId,
        status: "success",
        processedAt: new Date().toISOString(),
      });
      console.log(`✅ PDF job ${job.id} completed successfully`);
    } catch (error) {
      console.error(`❌ PDF job ${job.id} failed:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await failJob(job.id, errorMessage);
    } finally {
      this.currentConcurrentJobs--;
    }
  }

  // Process CMP calculation jobs
  private async processCmpJobs(): Promise<void> {
    let job;
    while ((job = await getNextJob("CMP_CALCULATION"))) {
      try {
        await startJob(job.id);

        // TODO: Implement CMP calculation logic
        // This will be implemented when we add the CMP calculation service

        // For now, just mark as completed
        await completeJob(job.id, {
          productId: job.data.productId,
          status: "success",
          calculatedAt: new Date().toISOString(),
          message: "CMP calculation not yet implemented",
        });

        console.log(`✅ CMP job ${job.id} completed successfully`);
      } catch (error) {
        console.error(`❌ CMP job ${job.id} failed:`, error);

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await failJob(job.id, errorMessage);
      }
    }
  }

  // Process Shopify sync jobs
  private async processShopifyJobs(): Promise<void> {
    let job;
    while ((job = await getNextJob("SHOPIFY_SYNC"))) {
      try {
        console.log(`🛍️ Processing Shopify sync job ${job.id}`);

        await startJob(job.id);

        // TODO: Implement Shopify sync logic
        // This will fetch sales data and update our database

        await completeJob(job.id, {
          status: "success",
          syncedAt: new Date().toISOString(),
          message: "Shopify sync not yet implemented",
        });

        console.log(`✅ Shopify sync job ${job.id} completed successfully`);
      } catch (error) {
        console.error(`❌ Shopify sync job ${job.id} failed:`, error);

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await failJob(job.id, errorMessage);
      }
    }
  }

  // Process Google Sheets export jobs
  private async processGoogleSheetsJobs(): Promise<void> {
    let job;
    while ((job = await getNextJob("GOOGLE_SHEETS_EXPORT"))) {
      try {
        console.log(`📊 Processing Google Sheets export job ${job.id}`);

        await startJob(job.id);

        // TODO: Implement Google Sheets export logic
        // This will export CMP data and sales data to Google Sheets

        await completeJob(job.id, {
          status: "success",
          exportedAt: new Date().toISOString(),
          message: "Google Sheets export not yet implemented",
        });

        console.log(
          `✅ Google Sheets export job ${job.id} completed successfully`
        );
      } catch (error) {
        console.error(`❌ Google Sheets export job ${job.id} failed:`, error);

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await failJob(job.id, errorMessage);
      }
    }
  }

  // Get worker status
  getStatus(): { isRunning: boolean; pollInterval: number } {
    return {
      isRunning: this.isRunning,
      pollInterval: this.pollInterval,
    };
  }
}

export const backgroundWorker = new BackgroundWorker();
void backgroundWorker.start();
