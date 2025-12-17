import { Banner } from "@shopify/polaris";

interface MessageBannerProps {
  status?: "success" | "error" | "warning" | "info";
  message?: string;
}

export function MessageBanner({ status, message }: MessageBannerProps) {
  if (!message) {
    return null;
  }

  const tone =
    status === "success"
      ? "success"
      : status === "error"
        ? "critical"
        : status === "warning"
          ? "warning"
          : "info";

  return <Banner tone={tone}>{message}</Banner>;
}
