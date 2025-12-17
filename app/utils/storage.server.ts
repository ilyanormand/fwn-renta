// Centralized storage path configuration
// In production (Fly.io), use persistent /data volume
// In development, use local directories

import { join } from "path";
import { existsSync } from "fs";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const HAS_DATA_VOLUME = existsSync("/data");
export const MAX_CONCURRENT_JOBS = 5;
// Use /data volume in production if available, otherwise fallback to local
export const STORAGE_BASE =
  IS_PRODUCTION && HAS_DATA_VOLUME
    ? "/data"
    : join(process.cwd(), ".local-storage");

export const PATHS = {
  // PDF uploads directory
  PDFS: join(STORAGE_BASE, "pdfs"),

  // Google API settings file
  GOOGLE_SETTINGS: join(STORAGE_BASE, "google-api-settings.json"),

  // SQLite database (for reference, actual path set via DATABASE_URL)
  DATABASE: join(STORAGE_BASE, "dev.sqlite"),
} as const;

// Public URL paths (for serving files via HTTP)
export const PUBLIC_PATHS = {
  PDFS: "/app/pdf", // Route: app.pdf.$fileName.tsx
} as const;

console.log(`📁 Storage configuration:
  Environment: ${IS_PRODUCTION ? "production" : "development"}
  Data volume: ${HAS_DATA_VOLUME ? "available" : "not available"}
  Base path: ${STORAGE_BASE}
  PDFs: ${PATHS.PDFS}
  Google settings: ${PATHS.GOOGLE_SETTINGS}
`);
