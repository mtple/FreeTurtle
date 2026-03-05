import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface AuditToolCall {
  name: string;
  input: Record<string, unknown>; // redacted
  output?: string; // truncated
  error?: string;
  durationMs: number;
  retries: number;
  approvalId?: string;
  approvalStatus?: string;
}

export interface AuditRecord {
  runId: string;
  taskName: string;
  startedAt: string;
  completedAt: string;
  status: "success" | "error";
  promptPreview: string; // first 200 chars
  toolCalls: AuditToolCall[];
  totalDurationMs: number;
  error?: string;
}

export class AuditLogger {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /**
   * Writes an audit record to workspace/audit/YYYY-MM-DD/{runId}.json
   */
  async writeRecord(record: AuditRecord): Promise<void> {
    // Derive the date folder from completedAt (or startedAt as fallback)
    const dateStr = this.extractDate(record.completedAt || record.startedAt);
    const dayDir = join(this.dir, "workspace", "audit", dateStr);

    await mkdir(dayDir, { recursive: true });

    const filePath = join(dayDir, `${record.runId}.json`);
    await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
  }

  /**
   * Extracts YYYY-MM-DD from an ISO date string.
   */
  private extractDate(isoString: string): string {
    try {
      const date = new Date(isoString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    } catch {
      // Fallback: try to parse the first 10 chars directly
      return isoString.slice(0, 10);
    }
  }
}
