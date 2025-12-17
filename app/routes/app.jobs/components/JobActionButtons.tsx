import { Button } from "@shopify/polaris";
import { useFetcher, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import type { Job } from "../../../utils/job.server";

interface JobActionButtonsProps {
  job: Job;
}

export function JobActionButtons({ job }: JobActionButtonsProps) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();

  // Revalidate data after successful action
  useEffect(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean }).success) {
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator]);

  const handleRetry = () => {
    const formData = new FormData();
    formData.append("action", "retry");
    formData.append("jobId", job.id);
    fetcher.submit(formData, { method: "post" });
  };

  const handleCancel = () => {
    const formData = new FormData();
    formData.append("action", "cancel");
    formData.append("jobId", job.id);
    fetcher.submit(formData, { method: "post" });
  };

  if (job.status === "PROCESSING") {
    return (
      <div style={{ display: "flex", gap: "8px" }}>
        <Button
          size="micro"
          variant="secondary"
          onClick={handleRetry}
          loading={fetcher.state === "submitting"}
        >
          Repeat
        </Button>
        <Button
          size="micro"
          variant="secondary"
          tone="critical"
          onClick={handleCancel}
          loading={fetcher.state === "submitting"}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return null;
}
