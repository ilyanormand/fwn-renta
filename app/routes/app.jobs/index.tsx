import { useState } from "react";
import { useLoaderData, useActionData } from "@remix-run/react";
import { Page, Layout } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { loader } from "./loader.server";
import { action } from "./actions.server";
import { useAutoRefresh } from "./hooks/useAutoRefresh";
import { ErrorBanner } from "./components/ErrorBanner";
import { MessageBanner } from "./components/MessageBanner";
import { WorkerStatusCard } from "./components/WorkerStatusCard";
import { JobStatisticsCard } from "./components/JobStatisticsCard";
import { JobsTable } from "./components/JobsTable";
import type { ActionData } from "./types";

// Re-export loader and action for Remix
export { loader, action };

export default function Jobs() {
  const {
    stats,
    pendingJobs,
    processingJobs,
    failedJobs,
    workerStatus,
    error,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const [activePopover, setActivePopover] = useState<string | null>(null);

  // Auto-refresh every 10 seconds
  useAutoRefresh(10000);

  const handlePopoverToggle = (jobId: string) => {
    setActivePopover(activePopover === jobId ? null : jobId);
  };

  const handlePopoverClose = () => {
    setActivePopover(null);
  };

  if (error) {
    return <ErrorBanner error={error} />;
  }

  return (
    <Page>
      <TitleBar title="Background Jobs" />
      <Layout>
        <Layout.Section>
          <WorkerStatusCard workerStatus={workerStatus} />
        </Layout.Section>

        <Layout.Section>
          <JobStatisticsCard stats={stats} />
        </Layout.Section>

        <Layout.Section>
          <JobsTable
            title="Pending Jobs"
            jobs={pendingJobs}
            activePopover={activePopover}
            onPopoverToggle={handlePopoverToggle}
            onPopoverClose={handlePopoverClose}
          />
        </Layout.Section>
        {actionData && (
          <Layout.Section>
            <MessageBanner
              status={actionData.status}
              message={actionData.message || actionData.error}
            />
          </Layout.Section>
        )}

        <Layout.Section>
          <JobsTable
            title="Processing Jobs"
            jobs={processingJobs}
            activePopover={activePopover}
            onPopoverToggle={handlePopoverToggle}
            onPopoverClose={handlePopoverClose}
          />
        </Layout.Section>

        <Layout.Section>
          <JobsTable
            title="Failed Jobs"
            jobs={failedJobs}
            activePopover={activePopover}
            onPopoverToggle={handlePopoverToggle}
            onPopoverClose={handlePopoverClose}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
