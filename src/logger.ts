/**
 * File-based logging for email sending operations
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "..", "logs");

let currentLogFile: string | null = null;

export function initLogger(): string {
  // Ensure logs directory exists
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }

  // Create timestamped log file
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  currentLogFile = join(LOGS_DIR, `email-run-${timestamp}.log`);

  log("=".repeat(80));
  log("DO NOT CONTACT - Email Send Log");
  log(`Started: ${new Date().toISOString()}`);
  log("=".repeat(80));

  return currentLogFile;
}

export function log(message: string): void {
  if (!currentLogFile) {
    initLogger();
  }

  const line = `${message}\n`;
  appendFileSync(currentLogFile!, line);
}

export function logEmail(data: {
  orgName: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  success: boolean;
  messageId?: string;
  error?: string;
}): void {
  log("");
  log("-".repeat(80));
  log(`Timestamp: ${new Date().toISOString()}`);
  log(`Organization: ${data.orgName}`);
  log(`To: ${data.toEmail}`);
  log(`From: ${data.fromEmail}`);
  log(`Subject: ${data.subject}`);
  log(`Status: ${data.success ? "SENT" : "FAILED"}`);
  if (data.messageId) {
    log(`Message-ID: ${data.messageId}`);
  }
  if (data.error) {
    log(`Error: ${data.error}`);
  }
  log("");
  log("--- EMAIL BODY ---");
  log(data.body);
  log("--- END BODY ---");
  log("-".repeat(80));
}

export function logSummary(sent: number, failed: number): void {
  log("");
  log("=".repeat(80));
  log("SUMMARY");
  log(`Completed: ${new Date().toISOString()}`);
  log(`Sent: ${sent}`);
  log(`Failed: ${failed}`);
  log(`Total: ${sent + failed}`);
  log("=".repeat(80));
}

export function getLogFile(): string | null {
  return currentLogFile;
}
