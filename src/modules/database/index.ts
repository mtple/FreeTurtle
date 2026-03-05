import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import { withRetry } from "../../reliability.js";
import { DatabaseClient } from "./client.js";
import { databaseTools } from "./tools.js";

export class DatabaseModule implements FreeTurtleModule {
  name = "database";
  description = "Query a PostgreSQL database (read-only).";

  private client!: DatabaseClient;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
  ): Promise<void> {
    const url = env.DATABASE_URL;
    if (!url) throw new Error("Database module requires DATABASE_URL");
    this.client = new DatabaseClient(url);
  }

  getTools(): ToolDefinition[] {
    return databaseTools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
    switch (name) {
      case "query_database": {
        const result = await withRetry(() =>
          this.client.query(input.sql as string)
        );
        return JSON.stringify({ rowCount: result.rowCount, rows: result.rows });
      }
      case "list_tables": {
        const tables = await withRetry(() => this.client.listTables());
        return JSON.stringify(tables);
      }
      default:
        throw new Error(`Unknown database tool: ${name}`);
    }
  }
}
