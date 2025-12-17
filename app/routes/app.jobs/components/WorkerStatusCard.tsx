import {
  Button,
  InlineStack,
  Text,
  BlockStack,
  ProgressBar,
  Card,
} from "@shopify/polaris";
import { RefreshIcon, PlayIcon, PauseCircleIcon } from "@shopify/polaris-icons";
import { Form, useRevalidator, useNavigation } from "@remix-run/react";
import type { WorkerStatus } from "../types";

interface WorkerStatusCardProps {
  workerStatus: WorkerStatus;
}

export function WorkerStatusCard({ workerStatus }: WorkerStatusCardProps) {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isStoppingWorker =
    isSubmitting && navigation.formData?.get("action") === "stopWorker";
  const isStartingWorker =
    isSubmitting && navigation.formData?.get("action") === "startWorker";

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack gap="200" align="space-between">
          <Text variant="headingMd" as="h2">
            Worker Status
          </Text>
          <InlineStack gap="200">
            <Form method="post">
              <input type="hidden" name="action" value="startWorker" />
              <Button
                submit
                variant="primary"
                icon={PlayIcon}
                disabled={workerStatus.isRunning || isSubmitting}
                loading={isStartingWorker}
              >
                Start Worker
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="action" value="stopWorker" />
              <Button
                submit
                variant="secondary"
                icon={PauseCircleIcon}
                disabled={!workerStatus.isRunning || isSubmitting}
                loading={isStoppingWorker}
              >
                Stop Worker
              </Button>
            </Form>
            <Button
              variant="tertiary"
              icon={RefreshIcon}
              onClick={() => revalidator.revalidate()}
            >
              Refresh
            </Button>
          </InlineStack>
        </InlineStack>

        <InlineStack gap="400">
          <div>
            <Text variant="bodyMd" as="p">
              <strong>Status:</strong>{" "}
              {workerStatus.isRunning ? "Running" : "Stopped"}
            </Text>
            <Text variant="bodyMd" as="p">
              <strong>Poll Interval:</strong> {workerStatus.pollInterval / 1000}
              s
            </Text>
          </div>

          {workerStatus.isRunning && (
            <div style={{ flex: 1 }}>
              <Text variant="bodyMd" as="p">
                <strong>Active:</strong> Processing jobs every{" "}
                {workerStatus.pollInterval / 1000} seconds
              </Text>
              <ProgressBar progress={100} size="small" />
            </div>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
