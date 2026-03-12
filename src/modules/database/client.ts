import pg from "pg";

const MAX_ROWS = 500;
const STATEMENT_TIMEOUT_MS = 15_000; // 15 seconds

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface TableInfo {
  table_name: string;
  columns: { name: string; type: string }[];
}

/**
 * SQL statements that are NOT allowed. Checked case-insensitively
 * after stripping comments.
 */
const WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "EXECUTE",
  "CALL",
  "DO",
  "SET",
  "RESET",
  "LISTEN",
  "NOTIFY",
  "LOCK",
  "DISCARD",
  "REASSIGN",
  "SECURITY",
  "LOAD",
  "REINDEX",
  "CLUSTER",
  "VACUUM",
  "ANALYZE",
  "REFRESH",
  "IMPORT",
  "PREPARE",
  "DEALLOCATE",
];

/**
 * Validate that a SQL string is a read-only SELECT query.
 * Strips comments and checks for write keywords.
 */
export function validateReadOnlyQuery(sql: string): void {
  // Strip single-line comments
  let cleaned = sql.replace(/--.*$/gm, "");
  // Strip block comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  if (!cleaned) {
    throw new Error("Empty query");
  }

  // Must start with SELECT, WITH, or EXPLAIN
  const upper = cleaned.toUpperCase();
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH") && !upper.startsWith("EXPLAIN")) {
    throw new Error("Only SELECT queries are allowed (query must start with SELECT, WITH, or EXPLAIN)");
  }

  // Check for write keywords as standalone words
  for (const keyword of WRITE_KEYWORDS) {
    // Match the keyword as a standalone word (not part of a column/table name)
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(cleaned)) {
      throw new Error(`Forbidden SQL keyword: ${keyword}. Only read-only SELECT queries are allowed.`);
    }
  }

  // Check for semicolons (prevent multi-statement attacks)
  // Allow trailing semicolon but not mid-query
  const withoutTrailing = cleaned.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new Error("Multi-statement queries are not allowed");
  }
}

export class DatabaseClient {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      // Don't expose connection details in error messages
      application_name: "freeturtle",
    });
  }

  async query(sql: string): Promise<QueryResult> {
    // Validate before sending to Postgres
    validateReadOnlyQuery(sql);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      // Set a statement timeout so runaway queries can't hang the process
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const result = await client.query(sql);
      await client.query("COMMIT");

      const rows = result.rows as Record<string, unknown>[];
      const truncated = rows.length > MAX_ROWS;

      return {
        rows: truncated ? rows.slice(0, MAX_ROWS) : rows,
        rowCount: result.rowCount ?? 0,
        truncated,
      };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore rollback errors */ }
      // Sanitize error messages to prevent connection string leakage
      throw sanitizeDbError(err);
    } finally {
      client.release();
    }
  }

  async listTables(allowedSchemas?: string[], allowedTables?: string[]): Promise<TableInfo[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

      // Use parameterized query — no string interpolation
      let tablesQuery = `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name`;
      const tablesParams: string[] = [];

      // Filter by allowed schemas if configured
      if (allowedSchemas && allowedSchemas.length > 0) {
        const placeholders = allowedSchemas.map((_, i) => `$${i + 1}`).join(", ");
        tablesQuery = `SELECT table_schema, table_name FROM information_schema.tables
          WHERE table_schema IN (${placeholders})
          ORDER BY table_schema, table_name`;
        tablesParams.push(...allowedSchemas);
      }

      const tablesResult = await client.query(tablesQuery, tablesParams);

      const tables: TableInfo[] = [];
      for (const row of tablesResult.rows) {
        const schema = row.table_schema as string;
        const tableName = row.table_name as string;

        // Filter by allowed tables if configured
        if (allowedTables && allowedTables.length > 0) {
          if (!allowedTables.some((t) => t.toLowerCase() === tableName.toLowerCase())) {
            continue;
          }
        }

        // Parameterized query for columns — no string interpolation
        const colsResult = await client.query(
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schema, tableName],
        );
        tables.push({
          table_name: schema === "public" ? tableName : `${schema}.${tableName}`,
          columns: colsResult.rows.map((c: Record<string, unknown>) => ({
            name: c.column_name as string,
            type: c.data_type as string,
          })),
        });
      }

      await client.query("COMMIT");
      return tables;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw sanitizeDbError(err);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Strip connection strings and other sensitive data from database error messages.
 */
function sanitizeDbError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return new Error("Database query failed");
  }

  let message = err.message;

  // Strip connection strings (postgres://user:pass@host:port/db)
  message = message.replace(/postgres(ql)?:\/\/[^\s]+/gi, "postgres://***");
  // Strip IP addresses with ports
  message = message.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/g, "***:***");
  // Strip hostnames in common error patterns
  message = message.replace(/(?:connect to|connection to|host) "[^"]+"/gi, (match) =>
    match.replace(/"[^"]+"/, '"***"'),
  );

  const sanitized = new Error(message);
  sanitized.name = err.name;
  return sanitized;
}
