import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";

export class Logger {
  //This logger creates logs in logs/uploadLogger directory
  static async uploadLogger(message: string) {
    const logDir = join(process.cwd(), "logs", "uploadLogger");
    try {
      mkdirSync(logDir, { recursive: true });
    } catch (e) {}

    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];
    const logFile = join(logDir, `upload_${dateStr}.log`);

    const timestamp = today.toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;

    try {
      writeFileSync(logFile, logEntry, { flag: "a" });
    } catch (e) {
      console.error("Failed to write to log file:", e);
    }
  }

  //This logger creates logs in logs/backgroundWorkerLogger directory
  static async backgroundWorkerLogger(message: string) {
    const logDir = join(process.cwd(), "logs", "backgroundWorkerLogger");
    try {
      mkdirSync(logDir, { recursive: true });
    } catch (e) {}

    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];
    const logFile = join(logDir, `backgroundWorker_${dateStr}.log`);
    const timestamp = today.toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    try {
      writeFileSync(logFile, logEntry, { flag: "a" });
    } catch (e) {
      console.error("Failed to write to log file:", e);
    }
  }
}
