import { processInvoicePdf } from "./invoiceProcessing.server";
import { calculateCmp } from "./cmpCalculate.server";
import {
  getNextJob,
  startJob,
  completeJob,
  failJob,
  getJobById,
} from "../../utils/job.server";
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
  // Process PDF processing jobs
  private tryProcessJob(): void {
    if (this.currentConcurrentJobs >= this.maxConcurrentJobs) {
      return;
    }
    this.processSingleJob().catch((error) => {
      console.error("Error processing job:", error);
    });
    // Process CMP jobs (parallel, but respects same limit)
    this.processSingleCmpJob().catch((error) => {
      console.error("Error processing CMP calculation job:", error);
    });
  }
  // Process of parsing and processing the invoice PDF
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

  // Process single CMP calculation job (similar to processSingleJob)
  private async processSingleCmpJob(): Promise<void> {
    const job = await getNextJob("CMP_CALCULATION");
    if (!job) {
      return;
    }
    this.currentConcurrentJobs++;
    try {
      await startJob(job.id);
      await calculateCmp(job.data.invoiceId, job.id);
      // completeJob is called inside calculateCmp, so we don't need to call it here
      // Check job status before logging success (wait a bit for DB to update)
      await new Promise((resolve) => setTimeout(resolve, 200));
      const updatedJob = await getJobById(job.id);
      if (updatedJob?.status === "COMPLETED") {
        console.log(`✅ CMP job ${job.id} completed successfully`);
      } else if (updatedJob?.status === "FAILED") {
        console.error(
          `❌ CMP job ${job.id} failed: ${updatedJob.error || "Unknown error"}`
        );
        // Re-throw to ensure error is handled properly
        throw new Error(updatedJob.error || "CMP calculation failed");
      } else {
        console.log(
          `⚠️ CMP job ${job.id} finished with status: ${updatedJob?.status}`
        );
      }
    } catch (error) {
      // failJob is called inside calculateCmp on error, but we catch here for safety
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      // Only fail if not already failed in calculateCmp
      try {
        const currentJob = await getJobById(job.id);
        if (currentJob?.status !== "FAILED") {
          await failJob(job.id, errorMessage);
        }
      } catch (failError) {
        // Job might already be failed, ignore
        console.error(`❌ Error handling failed job ${job.id}:`, failError);
      }
    } finally {
      this.currentConcurrentJobs--;
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
