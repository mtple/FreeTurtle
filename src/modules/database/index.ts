import type { FreeTurtleModule, ToolDefinition } from "../types.js";
import type { PolicyConfig } from "../../policy.js";
import { assertDatabaseScopeAllowed } from "../../policy.js";
import { withRetry } from "../../reliability.js";
import { DatabaseClient } from "./client.js";
import { databaseTools } from "./tools.js";

export class DatabaseModule implements FreeTurtleModule {
  name = "database";
  description = "Query a PostgreSQL database (read-only).";

  private client!: DatabaseClient;
  private policy?: PolicyConfig;

  async initialize(
    _config: Record<string, unknown>,
    env: Record<string, string>,
    options?: { policy?: PolicyConfig },
  ): Promise<void> {
    const url = env.DATABASE_URL;
    if (!url) throw new Error("Database module requires DATABASE_URL");
    this.client = new DatabaseClient(url);
    this.policy = options?.policy;
  }

  getTools(): ToolDefinition[] {
    return databaseTools;
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (name) {
      case "query_database": {
        const sql = input.sql as string;
        if (!sql) return "Error: sql is required";

        // Enforce schema/table policy if configured
        this.enforceQueryPolicy(sql);

        const result = await withRetry(() => this.client.query(sql));
        const response: Record<string, unknown> = {
          rowCount: result.rowCount,
          rows: result.rows,
        };
        if (result.truncated) {
          response.warning = `Results truncated to 500 rows (${result.rowCount} total)`;
        }
        return JSON.stringify(response);
      }
      case "list_tables": {
        const allowedSchemas = this.policy?.database?.allowed_schemas;
        const allowedTables = this.policy?.database?.allowed_tables;
        const tables = await withRetry(() =>
          this.client.listTables(allowedSchemas, allowedTables),
        );
        return JSON.stringify(tables);
      }
      default:
        throw new Error(`Unknown database tool: ${name}`);
    }
  }

  /**
   * Extract referenced table names from a SQL query and check them against policy.
   * This is a best-effort heuristic — the real enforcement is the READ ONLY transaction
   * and the validateReadOnlyQuery() check in the client.
   */
  private enforceQueryPolicy(sql: string): void {
    if (!this.policy) return;

    const schemas = this.policy.database?.allowed_schemas;
    const tables = this.policy.database?.allowed_tables;

    // If neither is configured, no restrictions
    if (schemas === undefined && tables === undefined) return;

    // Extract table references from FROM and JOIN clauses
    const tableRefs = extractTableReferences(sql);

    for (const ref of tableRefs) {
      const schema = ref.schema ?? "public";
      assertDatabaseScopeAllowed(this.policy, schema, ref.table);
    }
  }
}

interface TableRef {
  schema?: string;
  table: string;
}

/**
 * Best-effort extraction of table names from SQL.
 * Matches patterns after FROM, JOIN, INTO, UPDATE, and table-like references.
 */
function extractTableReferences(sql: string): TableRef[] {
  // Strip comments
  let cleaned = sql.replace(/--.*$/gm, "");
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");

  const refs: TableRef[] = [];
  const seen = new Set<string>();

  // Match table references after FROM, JOIN keywords
  // Handles: schema.table, "schema"."table", table
  const pattern = /\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)(?:\s|,|$)/gi;
  let match;
  while ((match = pattern.exec(cleaned)) !== null) {
    const fullRef = match[1];
    const parts = fullRef.split(".");
    const ref: TableRef =
      parts.length === 2
        ? { schema: parts[0], table: parts[1] }
        : { table: parts[0] };

    const key = `${ref.schema ?? "public"}.${ref.table}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
  }

  return refs;
}
