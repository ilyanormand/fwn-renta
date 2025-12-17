import { Badge, Text, Popover, Button, ActionList } from "@shopify/polaris";
import { MenuHorizontalIcon } from "@shopify/polaris-icons";
import type { Job } from "../../utils/job.server";
import { JobActionButtons } from "./components/JobActionButtons";

export function getStatusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return <Badge tone="info">⏳ Pending</Badge>;
    case "PROCESSING":
      return <Badge tone="attention">🔄 Processing</Badge>;
    case "COMPLETED":
      return <Badge tone="success">✅ Completed</Badge>;
    case "FAILED":
      return <Badge tone="critical">❌ Failed</Badge>;
    case "CANCELLED":
      return <Badge tone="warning">🚫 Cancelled</Badge>;
    default:
      return <Badge>Unknown</Badge>;
  }
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function renderJobActions(
  job: Job,
  activePopover: string | null,
  onPopoverToggle: (jobId: string) => void,
  onPopoverClose: () => void
) {
  if (job.status === "FAILED") {
    return (
      <Popover
        active={activePopover === job.id}
        activator={
          <Button
            variant="tertiary"
            icon={MenuHorizontalIcon}
            onClick={() => onPopoverToggle(job.id)}
            accessibilityLabel="More actions"
          />
        }
        onClose={onPopoverClose}
      >
        <ActionList
          items={[
            {
              content: "Retry Job",
              onAction: () => {
                const form = document.createElement("form");
                form.method = "post";
                form.innerHTML = `
                  <input type="hidden" name="action" value="retry" />
                  <input type="hidden" name="jobId" value="${job.id}" />
                `;
                document.body.appendChild(form);
                form.submit();
                document.body.removeChild(form);
              },
            },
            {
              content: "View Details",
              onAction: () => console.log("View job details:", job.id),
            },
          ]}
        />
      </Popover>
    );
  }

  if (job.status === "PROCESSING") {
    return <JobActionButtons job={job} />;
  }

  return (
    <Text variant="bodyMd" as="span" tone="subdued">
      {job.status === "COMPLETED" ? "Completed" : "No actions available"}
    </Text>
  );
}

export function createJobTableRows(
  jobs: Job[],
  activePopover: string | null,
  onPopoverToggle: (jobId: string) => void,
  onPopoverClose: () => void
) {
  return jobs.map((job) => [
    <Text variant="bodyMd" as="span" key={`${job.id}-id`}>
      <code>{job.id.substring(0, 8)}...</code>
    </Text>,
    getStatusBadge(job.status),
    <Text variant="bodyMd" as="span" key={`${job.id}-type`}>
      {job.type.replace(/_/g, " ")}
    </Text>,
    <Text variant="bodyMd" as="span" key={`${job.id}-attempts`}>
      {job.attempts}/{job.maxAttempts}
    </Text>,
    formatDate(job.createdAt),
    job.startedAt ? formatDate(job.startedAt) : "-",
    job.completedAt ? formatDate(job.completedAt) : "-",
    renderJobActions(job, activePopover, onPopoverToggle, onPopoverClose),
  ]);
}
