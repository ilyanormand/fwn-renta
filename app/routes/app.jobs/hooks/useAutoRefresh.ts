import { useEffect } from "react";
import { useRevalidator, useActionData } from "@remix-run/react";
import type { ActionData } from "../types";

export function useAutoRefresh(intervalMs: number = 10000) {
  const revalidator = useRevalidator();
  const actionData = useActionData<typeof import("../actions.server").action>();

  // Auto-refresh every N seconds
  useEffect(() => {
    const interval = setInterval(() => {
      revalidator.revalidate();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [revalidator, intervalMs]);

  // Revalidate when action completes
  useEffect(() => {
    if (actionData?.success) {
      revalidator.revalidate();
    }
  }, [actionData, revalidator]);
}

