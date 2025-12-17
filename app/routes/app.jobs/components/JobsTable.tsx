import { Card, BlockStack, Text, DataTable } from "@shopify/polaris";
import type { Job } from "../../../utils/job.server";
import { createJobTableRows } from "../utils";

interface JobsTableProps {
  title: string;
  jobs: Job[];
  activePopover: string | null;
  onPopoverToggle: (jobId: string) => void;
  onPopoverClose: () => void;
}

export function JobsTable({
  title,
  jobs,
  activePopover,
  onPopoverToggle,
  onPopoverClose,
}: JobsTableProps) {
  const tableHeadings = [
    "Job ID",
    "Status",
    "Type",
    "Attempts",
    "Created",
    "Started",
    "Completed",
    "Actions",
  ];

  const columnContentTypes = [
    "text",
    "text",
    "text",
    "text",
    "text",
    "text",
    "text",
    "text",
  ];

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          {title} ({jobs.length})
        </Text>

        {jobs.length > 0 ? (
          <DataTable
            columnContentTypes={columnContentTypes}
            headings={tableHeadings}
            rows={createJobTableRows(
              jobs,
              activePopover,
              onPopoverToggle,
              onPopoverClose
            )}
          />
        ) : (
          <Text variant="bodyMd" as="p" tone="subdued">
            No {title.toLowerCase()}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
