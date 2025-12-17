import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import type { ActionData } from "./types";

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<Response> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  try {
    if (actionType === "retry") {
      const jobId = formData.get("jobId") as string;
      if (!jobId) {
        return json<ActionData>({
          success: false,
          error: "Job ID is required",
        });
      }
      const { retryFailedJob } = await import("../../utils/job.server");
      await retryFailedJob(jobId);
      return json<ActionData>({ success: true });
    }

    if (actionType === "cancel") {
      const jobId = formData.get("jobId") as string;
      if (!jobId) {
        return json<ActionData>({
          success: false,
          error: "Job ID is required",
        });
      }
      const { cancelInvoicePdf } = await import(
        "../../services/worker/middlewareInvoicer"
      );
      const result = await cancelInvoicePdf(jobId);
      const message = (result as any).message || (result as any).error;
      return json<ActionData>({
        success: result.success,
        error: result.success ? undefined : message,
        message: result.success ? message : undefined,
        status: result.success ? "success" : "error",
      });
    }

    if (actionType === "startWorker") {
      const { backgroundWorker } = await import(
        "../../services/worker/backgroundWorker.server"
      );
      await backgroundWorker.start();
      return json<ActionData>({ success: true });
    }

    if (actionType === "stopWorker") {
      const { backgroundWorker } = await import(
        "../../services/worker/backgroundWorker.server"
      );
      backgroundWorker.stop();
      return json<ActionData>({ success: true });
    }

    return json<ActionData>({ success: false, error: "Invalid action" });
  } catch (error) {
    return json<ActionData>({ success: false, error: "Action failed" });
  }
};
