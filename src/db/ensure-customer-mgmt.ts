import fs from 'node:fs/promises';
import path from 'node:path';
import { createPool } from './index.ts';

let customerMgmtSqlEnsured = false;
let publicSyncEnsured = false;
let lastPublicSyncAttemptAt = 0;
let lastPublicSyncError: string | null = null;

export function getCustomerSchemaBootstrapError(): string | null {
  return lastPublicSyncError;
}

async function runPublicCustomersSyncSql(): Promise<void> {
  const pool = createPool();
  if (!pool) return;
  try {
    const publicSyncPath = path.resolve(process.cwd(), 'supabase/public_customers_sync.sql');
    const publicSyncSql = await fs.readFile(publicSyncPath, 'utf8');
    await pool.query(publicSyncSql);
    publicSyncEnsured = true;
    lastPublicSyncError = null;
  } catch (err) {
    publicSyncEnsured = false;
    lastPublicSyncError = (err as Error).message || 'Failed to apply supabase/public_customers_sync.sql';
    console.warn('Public customers SQL bootstrap note:', lastPublicSyncError);
  }
}

export async function ensureCustomerManagementSchema(forceRetry = false): Promise<void> {
  const pool = createPool();
  if (!pool) {
    customerMgmtSqlEnsured = true;
    publicSyncEnsured = true;
    lastPublicSyncError = null;
    return;
  }

  if (!customerMgmtSqlEnsured || forceRetry) {
    try {
      const sqlPath = path.resolve(process.cwd(), 'supabase/customer_management_table.sql');
      const sqlText = await fs.readFile(sqlPath, 'utf8');
      await pool.query(sqlText);
      customerMgmtSqlEnsured = true;
    } catch (err) {
      console.warn('Customer management DDL bootstrap warning:', (err as Error).message);
    }
  }

  const now = Date.now();
  if (forceRetry || (!publicSyncEnsured && now - lastPublicSyncAttemptAt >= 15_000)) {
    lastPublicSyncAttemptAt = now;
    await runPublicCustomersSyncSql();
  }
}
