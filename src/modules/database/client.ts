import pg from "pg";

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface TableInfo {
  table_name: string;
  columns: { name: string; type: string }[];
}

export class DatabaseClient {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async query(sql: string): Promise<QueryResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(sql);
      await client.query("COMMIT");
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? 0,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const tablesResult = await this.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );

    const tables: TableInfo[] = [];
    for (const row of tablesResult.rows) {
      const tableName = row.table_name as string;
      const colsResult = await this.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = '${tableName.replace(/'/g, "''")}'
         ORDER BY ordinal_position`
      );
      tables.push({
        table_name: tableName,
        columns: colsResult.rows.map((c) => ({
          name: c.column_name as string,
          type: c.data_type as string,
        })),
      });
    }

    return tables;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
