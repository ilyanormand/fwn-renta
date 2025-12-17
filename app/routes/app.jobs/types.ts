import type { Job } from "../../utils/job.server";

export interface JobStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  byType: Record<
    string,
    { total: number; pending: number; completed: number; failed: number }
  >;
}

export interface WorkerStatus {
  isRunning: boolean;
  pollInterval: number;
}

export interface LoaderData {
  stats: JobStats | null;
  pendingJobs: Job[];
  processingJobs: Job[];
  failedJobs: Job[];
  workerStatus: WorkerStatus;
  error: string | null;
}

export interface ActionData {
  success?: boolean;
  error?: string;
  message?: string;
  status?: "success" | "error" | "warning" | "info";
}
