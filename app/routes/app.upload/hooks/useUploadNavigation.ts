import { useEffect } from "react";
import { useNavigate } from "@remix-run/react";
import type { ActionData } from "../types";

export function useUploadNavigation(actionData: ActionData | undefined) {
  const navigate = useNavigate();

  useEffect(() => {
    if (
      actionData &&
      "success" in actionData &&
      actionData.success &&
      actionData.invoiceId
    ) {
      // Navigate to review page after successful upload
      navigate(`/app/review/${actionData.invoiceId}`);
    }
  }, [actionData, navigate]);
}

