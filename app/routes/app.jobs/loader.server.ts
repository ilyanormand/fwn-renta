import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import type { LoaderData } from "./types";

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<Response> => {
  await authenticate.admin(request);

  try {
    const { getJobStats, getJobsByStatus } = await import(
      "../../utils/job.server"
    );
    const { backgroundWorker } = await import(
      "../../services/worker/backgroundWorker.server"
    );

    const [stats, pendingJobs, processingJobs, failedJobs] = await Promise.all([
      getJobStats(),
      getJobsByStatus("PENDING", 10),
      getJobsByStatus("PROCESSING", 10),
      getJobsByStatus("FAILED", 10),
    ]);

    return json<LoaderData>({
      stats,
      pendingJobs,
      processingJobs,
      failedJobs,
      workerStatus: backgroundWorker.getStatus(),
      error: null,
    });
  } catch (error) {
    console.error("Error loading job data:", error);
    return json<LoaderData>({
      stats: null,
      pendingJobs: [],
      processingJobs: [],
      failedJobs: [],
      workerStatus: { isRunning: false, pollInterval: 5000 },
      error: "Failed to load job data",
    });
  }
};
