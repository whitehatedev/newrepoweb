import crypto from 'crypto';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { createPool, db } from '../db/index.ts';
import {
  ensureCustomerManagementSchema,
  getCustomerSchemaBootstrapError,
} from '../db/ensure-customer-mgmt.ts';
import {
  adminSessions,
  customerIdHistory,
  customerPasswordHistory,
  customers as webCustomers,
  users,
} from '../db/schema.ts';
import {
  getServerSupabaseClient,
  getServiceRoleSupabaseClient,
  getSupabasePublicConfig,
} from '../lib/supabase-admin.ts';

const STAFF_ROLES_SET = new Set([
  'super_admin',
  'admin',
  'website_manager',
  'product_manager',
  'sales_manager',
  'project_manager',
  'engineer',
  'printing_operator',
  'inventory_manager',
  'accounts_manager',
  'support_manager',
  'support_staff',
]);

function cleanEmailStr(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function cleanMobileStr(mobile?: string | null): string {
  let cleaned = String(mobile || '').trim().replace(/[\s()-]+/g, '');
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) {
    cleaned = cleaned.slice(3);
  } else if (/^91[6-9]\d{9}$/.test(cleaned)) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

export function isUuidStr(value?: string | null): boolean {
  return Boolean(
    value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

export interface PublicCustomerRecord {
  id: string;
  customerId: string;
  userId: string | null;
  authUserId: string | null;
  userUid: string;
  webUserId: number | null;
  fullName: string;
  email: string;
  phoneNumber: string;
  companyOrCollege: string;
  fullAddress: string;
  city: string;
  state: string;
  pinCode: string;
  accountStatus: 'Active' | 'Suspended' | 'Deactivated' | string;
  statusReason: string;
  emailVerified: boolean;
  emailConfirmedAt: string | null;
  lastPasswordResetAt: string | null;
  lastPasswordChangeAt: string | null;
  passwordResetStatus: string;
  registrationDate: string;
  lastLoginAt: string | null;
  deletedAt: string | null;
  deletedReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerIdHistoryRecord {
  id: string | number;
  customerDbId: string | null;
  authUserId: string | null;
  email: string;
  previousCustomerId: string | null;
  newCustomerId: string;
  previousAccountStatus: string;
  newAccountStatus: string;
  operationType: string;
  reason: string;
  changedBy: string;
  createdAt: string;
}

export interface PasswordActivityRecord {
  id: string | number;
  customerId: string;
  customerDbId: string | null;
  email: string;
  authUserId: string | null;
  actionType: 'registration' | 'reset' | 'change' | 'recovery' | string;
  actionStatus: 'requested' | 'verified' | 'completed' | 'failed' | string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

export interface CustomerRealtimeEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE' | 'SYNC';
  id?: string;
  customerId?: string;
  email?: string;
  timestamp: string;
}

type SseListener = (event: CustomerRealtimeEvent) => void;
const sseListeners = new Set<SseListener>();

export function subscribeCustomerStream(listener: SseListener): () => void {
  sseListeners.add(listener);
  return () => {
    sseListeners.delete(listener);
  };
}

export function emitCustomerStreamEvent(event: Omit<CustomerRealtimeEvent, 'timestamp'>): void {
  const payload: CustomerRealtimeEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  for (const listener of sseListeners) {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  }
}

export function getPublicCustomersClient(): SupabaseClient | null {
  return getServiceRoleSupabaseClient() || getServerSupabaseClient();
}

export function isSupabasePublicCustomersConfigured(): boolean {
  const pub = getSupabasePublicConfig();
  return Boolean(pub.url && (process.env.SUPABASE_SERVICE_ROLE_KEY || pub.anonKey));
}

export interface PublicCustomersMigrationStatus {
  checkedAt: string;
  checkedVia: 'postgres' | 'supabase_rpc' | 'postgrest' | 'unconfigured';
  configured: boolean;
  verified: boolean;
  requiresMigration: boolean;
  customersTableExists: boolean;
  usersTableExists: boolean;
  customerIdHistoryExists: boolean;
  customerPasswordHistoryExists: boolean;
  customersUserIdType: string | null;
  customersUserIdNullable: boolean;
  usersIdType: string | null;
  usersIdUnique: boolean;
  typesCompatible: boolean;
  fkConstraintName: string | null;
  fkSourceColumn: string | null;
  fkTargetSchema: string | null;
  fkTargetTable: string | null;
  fkTargetColumn: string | null;
  fkOnDelete: string | null;
  fkValid: boolean;
  missingColumns: string[];
  issues: string[];
  warningMessage: string | null;
}

const REQUIRED_PUBLIC_CUSTOMER_COLUMNS = [
  'id',
  'customer_id',
  'user_id',
  'auth_user_id',
  'user_uid',
  'web_user_id',
  'full_name',
  'email',
  'phone_number',
  'company_or_college',
  'full_address',
  'city',
  'state',
  'pin_code',
  'account_status',
  'status_reason',
  'email_verified',
  'last_password_reset_at',
  'password_reset_status',
  'registration_date',
  'last_login_at',
  'deleted_at',
] as const;

export interface RawPostgresInspectionInput {
  customersTableExists: boolean;
  usersTableExists: boolean;
  customerIdHistoryExists: boolean;
  customerPasswordHistoryExists: boolean;
  customerColumns: Array<{ columnName: string; udtName: string; isNullable: boolean }>;
  usersIdColumn: { udtName: string; isUnique?: boolean } | null;
  fkConstraints: Array<{
    conname: string;
    sourceCol: string;
    sourceColCount?: number;
    targetColCount?: number;
    targetSchema: string;
    targetTable: string;
    targetCol: string;
    onDelete: string;
  }>;
}

function normalizeFkDeleteLabel(codeOrLabel?: string | null): string | null {
  const val = String(codeOrLabel || '').trim();
  if (!val) return null;
  switch (val.toLowerCase()) {
    case 'n':
    case 'set null':
      return 'SET NULL';
    case 'c':
    case 'cascade':
      return 'CASCADE';
    case 'a':
    case 'no action':
      return 'NO ACTION';
    case 'r':
    case 'restrict':
      return 'RESTRICT';
    case 'd':
    case 'set default':
      return 'SET DEFAULT';
    default:
      return val.toUpperCase();
  }
}

export function evaluatePostgresPublicCustomersInspection(
  input: RawPostgresInspectionInput
): PublicCustomersMigrationStatus {
  const checkedAt = new Date().toISOString();
  const issues: string[] = [];

  if (!input.customersTableExists) {
    issues.push('Missing table public.customers.');
  }
  if (!input.usersTableExists) {
    issues.push('Missing table public.users.');
  }
  if (!input.customerIdHistoryExists) {
    issues.push('Missing table public.customer_id_history.');
  }
  if (!input.customerPasswordHistoryExists) {
    issues.push('Missing table public.customer_password_history.');
  }

  const colMap = new Map<string, { udtName: string; isNullable: boolean }>();
  for (const col of input.customerColumns) {
    colMap.set(String(col.columnName).toLowerCase(), {
      udtName: String(col.udtName || '').toLowerCase(),
      isNullable: Boolean(col.isNullable),
    });
  }

  const missingColumns: string[] = [];
  if (input.customersTableExists) {
    for (const reqCol of REQUIRED_PUBLIC_CUSTOMER_COLUMNS) {
      if (!colMap.has(reqCol)) {
        missingColumns.push(reqCol);
      }
    }
    if (missingColumns.length > 0) {
      issues.push(`public.customers missing columns: ${missingColumns.join(', ')}.`);
    }
  }

  const userIdCol = colMap.get('user_id') || null;
  const customersUserIdType = userIdCol?.udtName || null;
  const customersUserIdNullable = Boolean(userIdCol?.isNullable);
  const usersIdType = input.usersIdColumn?.udtName
    ? String(input.usersIdColumn.udtName).toLowerCase()
    : null;
  const usersIdUnique = input.usersIdColumn ? input.usersIdColumn.isUnique !== false : false;

  if (customersUserIdType !== 'text') {
    issues.push(
      `Expected public.customers.user_id to be text, found ${customersUserIdType || 'missing'}.`
    );
  }
  if (userIdCol && !customersUserIdNullable) {
    issues.push('Expected public.customers.user_id to be nullable.');
  }
  if (usersIdType !== 'text') {
    issues.push(`Expected public.users.id to be text, found ${usersIdType || 'missing'}.`);
  }
  if (input.usersTableExists && input.usersIdColumn && !usersIdUnique) {
    issues.push('Expected public.users(id) to have a PRIMARY KEY or UNIQUE constraint.');
  }

  const typesCompatible =
    customersUserIdType === 'text' &&
    customersUserIdNullable &&
    usersIdType === 'text' &&
    usersIdUnique;

  const matchingFk =
    input.fkConstraints.find((fk) => fk.conname === 'customers_user_id_fkey') ||
    input.fkConstraints.find((fk) => fk.sourceCol === 'user_id') ||
    null;

  const fkConstraintName = matchingFk?.conname || null;
  const fkSourceColumn = matchingFk?.sourceCol || null;
  const fkTargetSchema = matchingFk?.targetSchema || null;
  const fkTargetTable = matchingFk?.targetTable || null;
  const fkTargetColumn = matchingFk?.targetCol || null;
  const fkOnDelete = normalizeFkDeleteLabel(matchingFk?.onDelete || null);

  const fkValid = Boolean(
    matchingFk &&
      fkConstraintName === 'customers_user_id_fkey' &&
      fkSourceColumn === 'user_id' &&
      (matchingFk.sourceColCount === undefined || matchingFk.sourceColCount === 1) &&
      (matchingFk.targetColCount === undefined || matchingFk.targetColCount === 1) &&
      fkTargetSchema === 'public' &&
      fkTargetTable === 'users' &&
      fkTargetColumn === 'id' &&
      (fkOnDelete === 'SET NULL' || fkOnDelete === 'NO ACTION' || fkOnDelete === 'RESTRICT')
  );

  if (!fkValid) {
    issues.push(
      `Constraint customers_user_id_fkey must reference public.users(id) from public.customers.user_id (found: name=${fkConstraintName || 'none'} col=${fkSourceColumn || 'none'} target=${fkTargetSchema || 'none'}.${fkTargetTable || 'none'}(${fkTargetColumn || 'none'}) on_delete=${fkOnDelete || 'none'}).`
    );
  }

  const verified = Boolean(
    input.customersTableExists &&
      input.usersTableExists &&
      input.customerIdHistoryExists &&
      input.customerPasswordHistoryExists &&
      typesCompatible &&
      fkValid &&
      missingColumns.length === 0
  );

  return {
    checkedAt,
    checkedVia: 'postgres',
    configured: true,
    verified,
    requiresMigration: !verified,
    customersTableExists: input.customersTableExists,
    usersTableExists: input.usersTableExists,
    customerIdHistoryExists: input.customerIdHistoryExists,
    customerPasswordHistoryExists: input.customerPasswordHistoryExists,
    customersUserIdType,
    customersUserIdNullable,
    usersIdType,
    usersIdUnique,
    typesCompatible,
    fkConstraintName,
    fkSourceColumn,
    fkTargetSchema,
    fkTargetTable,
    fkTargetColumn,
    fkOnDelete,
    fkValid,
    missingColumns,
    issues,
    warningMessage: verified
      ? null
      : 'Database schema migration required: please run supabase/public_customers_sync.sql in Supabase SQL Editor to verify customers_user_id_fkey -> public.users(id) with TEXT user_id.',
  };
}

let schemaReadyCache: {
  ready: boolean;
  hasUserIdCol: boolean;
  hasHistoryTables: boolean;
  hasExtendedCols: boolean;
  migrationStatus: PublicCustomersMigrationStatus;
  checkedAt: number;
} | null = null;
let loggedMissingUpgradeWarning = false;

function buildUnconfiguredMigrationStatus(): PublicCustomersMigrationStatus {
  return {
    checkedAt: new Date().toISOString(),
    checkedVia: 'unconfigured',
    configured: false,
    verified: false,
    requiresMigration: false,
    customersTableExists: false,
    usersTableExists: false,
    customerIdHistoryExists: false,
    customerPasswordHistoryExists: false,
    customersUserIdType: null,
    customersUserIdNullable: false,
    usersIdType: null,
    usersIdUnique: false,
    typesCompatible: false,
    fkConstraintName: null,
    fkSourceColumn: null,
    fkTargetSchema: null,
    fkTargetTable: null,
    fkTargetColumn: null,
    fkOnDelete: null,
    fkValid: false,
    missingColumns: [],
    issues: [],
    warningMessage: null,
  };
}

async function inspectMigrationViaPostgres(): Promise<PublicCustomersMigrationStatus | null> {
  const pool = createPool();
  if (!pool) return null;

  try {
    const [tablesRes, colsRes, usersColRes, fkRes] = await Promise.all([
      pool.query<{
        customers_exists: boolean;
        users_exists: boolean;
        id_history_exists: boolean;
        pw_history_exists: boolean;
      }>(`
        SELECT
          (to_regclass('public.customers') IS NOT NULL) AS customers_exists,
          (to_regclass('public.users') IS NOT NULL) AS users_exists,
          (to_regclass('public.customer_id_history') IS NOT NULL) AS id_history_exists,
          (to_regclass('public.customer_password_history') IS NOT NULL) AS pw_history_exists
      `),
      pool.query<{ column_name: string; udt_name: string; is_nullable: string }>(`
        SELECT column_name, udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customers'
      `),
      pool.query<{ udt_name: string; is_unique: boolean }>(`
        SELECT
          c.udt_name,
          EXISTS (
            SELECT 1
            FROM pg_index ix
            JOIN pg_attribute a
              ON a.attrelid = ix.indrelid
             AND a.attnum = ANY(ix.indkey)
            WHERE ix.indrelid = to_regclass('public.users')
              AND ix.indisunique
              AND ix.indisvalid
              AND array_length(ix.indkey, 1) = 1
              AND a.attname = 'id'
          ) AS is_unique
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = 'users'
          AND c.column_name = 'id'
        LIMIT 1
      `),
      pool.query<{
        conname: string;
        source_col: string;
        source_col_count: number;
        target_col_count: number;
        target_schema: string;
        target_table: string;
        target_col: string;
        on_delete: string;
      }>(`
        SELECT
          c.conname,
          src.attname AS source_col,
          COALESCE(array_length(c.conkey, 1), 0) AS source_col_count,
          COALESCE(array_length(c.confkey, 1), 0) AS target_col_count,
          ns.nspname AS target_schema,
          rel.relname AS target_table,
          tgt.attname AS target_col,
          c.confdeltype::text AS on_delete
        FROM pg_constraint c
        JOIN pg_attribute src
          ON src.attrelid = c.conrelid
         AND src.attnum = ANY(c.conkey)
         AND NOT src.attisdropped
        JOIN pg_class rel ON rel.oid = c.confrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        JOIN pg_attribute tgt
          ON tgt.attrelid = c.confrelid
         AND tgt.attnum = c.confkey[1]
         AND NOT tgt.attisdropped
        WHERE c.conrelid = to_regclass('public.customers')
          AND c.contype = 'f'
          AND (c.conname = 'customers_user_id_fkey' OR src.attname = 'user_id')
      `),
    ]);

    const tRow = tablesRes.rows[0];
    return evaluatePostgresPublicCustomersInspection({
      customersTableExists: Boolean(tRow?.customers_exists),
      usersTableExists: Boolean(tRow?.users_exists),
      customerIdHistoryExists: Boolean(tRow?.id_history_exists),
      customerPasswordHistoryExists: Boolean(tRow?.pw_history_exists),
      customerColumns: colsRes.rows.map((r) => ({
        columnName: r.column_name,
        udtName: r.udt_name,
        isNullable: r.is_nullable === 'YES',
      })),
      usersIdColumn: usersColRes.rows[0]
        ? { udtName: usersColRes.rows[0].udt_name, isUnique: Boolean(usersColRes.rows[0].is_unique) }
        : null,
      fkConstraints: fkRes.rows.map((r) => ({
        conname: r.conname,
        sourceCol: r.source_col,
        sourceColCount: Number(r.source_col_count || 0),
        targetColCount: Number(r.target_col_count || 0),
        targetSchema: r.target_schema,
        targetTable: r.target_table,
        targetCol: r.target_col,
        onDelete: r.on_delete,
      })),
    });
  } catch {
    return null;
  }
}

async function inspectMigrationViaSupabaseClient(
  client: SupabaseClient
): Promise<{
  status: PublicCustomersMigrationStatus;
  postgrestCustomersColsOk: boolean;
  hasUserIdCol: boolean;
  hasExtendedCols: boolean;
  hasHistoryTables: boolean;
}> {
  const checkedAt = new Date().toISOString();
  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Check PostgREST visibility of tables & columns (never query public.users.email)
  const [custRes, uidRes, extRes, usersIdRes, idHistRes, pwHistRes, rpcRes] = await Promise.all([
    client
      .from('customers')
      .select(
        'id, customer_id, auth_user_id, user_uid, web_user_id, full_name, phone_number, company_or_college, full_address, city, state, pin_code, account_status, status_reason, registration_date, last_login_at, email'
      )
      .limit(1),
    client.from('customers').select('user_id').limit(1),
    client
      .from('customers')
      .select('email_verified, last_password_reset_at, password_reset_status, deleted_at')
      .limit(1),
    client.from('users').select('id').limit(1),
    client.from('customer_id_history').select('id').limit(1),
    client.from('customer_password_history').select('id').limit(1),
    client.rpc('verify_public_customers_migration_status'),
  ]);

  const postgrestCustomersColsOk = !custRes.error;
  const hasUserIdCol = !uidRes.error;
  const hasExtendedCols = !extRes.error;
  const hasHistoryTables = !idHistRes.error && !pwHistRes.error;

  if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
    const r = rpcRes.data as Record<string, any>;
    const issues = Array.isArray(r.issues) ? r.issues.map((x) => String(x)) : [];
    const missingColumns = Array.isArray(r.missing_columns)
      ? r.missing_columns.map((x) => String(x))
      : [];

    if (!postgrestCustomersColsOk && custRes.error?.message) {
      if (!hasServiceRole && /permission denied/i.test(custRes.error.message)) {
        issues.push(
          'SUPABASE_SERVICE_ROLE_KEY is missing on the server; configure it so PostgREST can verify and manage public.customers.'
        );
      } else {
        issues.push(`PostgREST public.customers schema check: ${custRes.error.message}`);
      }
    }

    const verified = Boolean(r.migration_verified) && postgrestCustomersColsOk;
    return {
      postgrestCustomersColsOk,
      hasUserIdCol: hasUserIdCol || !missingColumns.includes('user_id'),
      hasExtendedCols,
      hasHistoryTables:
        hasHistoryTables ||
        (Boolean(r.customer_id_history_exists) && Boolean(r.customer_password_history_exists)),
      status: {
        checkedAt,
        checkedVia: 'supabase_rpc',
        configured: true,
        verified,
        requiresMigration: !verified,
        customersTableExists: Boolean(r.customers_table_exists),
        usersTableExists: Boolean(r.users_table_exists),
        customerIdHistoryExists: Boolean(r.customer_id_history_exists),
        customerPasswordHistoryExists: Boolean(r.customer_password_history_exists),
        customersUserIdType: r.customers_user_id_type ? String(r.customers_user_id_type) : null,
        customersUserIdNullable: Boolean(r.customers_user_id_nullable),
        usersIdType: r.users_id_type ? String(r.users_id_type) : null,
        usersIdUnique: r.users_id_unique !== undefined ? Boolean(r.users_id_unique) : Boolean(r.fk_valid),
        typesCompatible: Boolean(r.types_compatible),
        fkConstraintName: r.fk_constraint_name ? String(r.fk_constraint_name) : null,
        fkSourceColumn: r.fk_source_column ? String(r.fk_source_column) : null,
        fkTargetSchema: r.fk_target_schema ? String(r.fk_target_schema) : null,
        fkTargetTable: r.fk_target_table ? String(r.fk_target_table) : null,
        fkTargetColumn: r.fk_target_column ? String(r.fk_target_column) : null,
        fkOnDelete: normalizeFkDeleteLabel(r.fk_on_delete ? String(r.fk_on_delete) : null),
        fkValid: Boolean(r.fk_valid),
        missingColumns,
        issues,
        warningMessage: verified
          ? null
          : 'Database schema migration required: please run supabase/public_customers_sync.sql in Supabase SQL Editor to verify customers_user_id_fkey -> public.users(id) with TEXT user_id.',
      },
    };
  }

  // Fallback when verification RPC is not yet installed in Supabase
  const issues: string[] = [];
  if (custRes.error) {
    issues.push(`public.customers columns check failed: ${custRes.error.message}`);
  }
  if (uidRes.error) {
    issues.push(`public.customers.user_id check failed: ${uidRes.error.message}`);
  }
  if (usersIdRes.error) {
    issues.push(`public.users(id) check failed: ${usersIdRes.error.message}`);
  }
  if (idHistRes.error) {
    issues.push(`public.customer_id_history check failed: ${idHistRes.error.message}`);
  }
  if (pwHistRes.error) {
    issues.push(`public.customer_password_history check failed: ${pwHistRes.error.message}`);
  }
  issues.push(
    `Constraint verification RPC public.verify_public_customers_migration_status() is missing or unavailable (${rpcRes.error?.message || 'not installed'}); run supabase/public_customers_sync.sql in Supabase SQL Editor so customers_user_id_fkey -> public.users(id) and TEXT column types can be verified.`
  );

  return {
    postgrestCustomersColsOk,
    hasUserIdCol,
    hasExtendedCols,
    hasHistoryTables,
    status: {
      checkedAt,
      checkedVia: 'postgrest',
      configured: true,
      verified: false,
      requiresMigration: true,
      customersTableExists: !custRes.error || !/does not exist|schema cache/i.test(custRes.error.message || ''),
      usersTableExists: !usersIdRes.error || !/does not exist|schema cache/i.test(usersIdRes.error.message || ''),
      customerIdHistoryExists: !idHistRes.error,
      customerPasswordHistoryExists: !pwHistRes.error,
      customersUserIdType: null,
      customersUserIdNullable: false,
      usersIdType: null,
      usersIdUnique: false,
      typesCompatible: false,
      fkConstraintName: null,
      fkSourceColumn: null,
      fkTargetSchema: null,
      fkTargetTable: null,
      fkTargetColumn: null,
      fkOnDelete: null,
      fkValid: false,
      missingColumns: [],
      issues,
      warningMessage:
        'Database schema migration required: please run supabase/public_customers_sync.sql in Supabase SQL Editor to verify customers_user_id_fkey -> public.users(id) with TEXT user_id.',
    },
  };
}

export async function verifyPublicCustomersMigrationStatus(
  forceRefresh = false
): Promise<PublicCustomersMigrationStatus> {
  const now = Date.now();
  if (!forceRefresh && schemaReadyCache && now - schemaReadyCache.checkedAt < 30_000) {
    return schemaReadyCache.migrationStatus;
  }

  const client = getPublicCustomersClient();
  const poolStatus = await inspectMigrationViaPostgres();

  if (poolStatus) {
    let hasExtendedCols = !poolStatus.missingColumns.some((c) =>
      ['email_verified', 'last_password_reset_at', 'password_reset_status', 'deleted_at'].includes(c)
    );
    let hasUserIdCol = !poolStatus.missingColumns.includes('user_id');
    let hasHistoryTables =
      poolStatus.customerIdHistoryExists && poolStatus.customerPasswordHistoryExists;
    let ready = Boolean(client) && poolStatus.customersTableExists && poolStatus.missingColumns.length === 0;

    if (client) {
      const custRes = await client
        .from('customers')
        .select('id, customer_id, user_id')
        .limit(1);
      if (custRes.error) {
        ready = false;
      }
    }

    if (poolStatus.requiresMigration) {
      const bootstrapErr = getCustomerSchemaBootstrapError();
      if (bootstrapErr && !poolStatus.issues.some((i) => i.includes(bootstrapErr))) {
        poolStatus.issues.push(`SQL bootstrap error: ${bootstrapErr}`);
      }
      if (!loggedMissingUpgradeWarning) {
        loggedMissingUpgradeWarning = true;
        console.warn(
          `[Supabase public.customers] Schema verification failed: ${poolStatus.issues.join(' | ')}`
        );
      }
    } else if (poolStatus.verified) {
      loggedMissingUpgradeWarning = false;
    }

    schemaReadyCache = {
      ready,
      hasUserIdCol,
      hasHistoryTables,
      hasExtendedCols,
      migrationStatus: poolStatus,
      checkedAt: now,
    };
    return poolStatus;
  }

  if (!client) {
    const unconfigured = buildUnconfiguredMigrationStatus();
    schemaReadyCache = {
      ready: false,
      hasUserIdCol: false,
      hasHistoryTables: false,
      hasExtendedCols: false,
      migrationStatus: unconfigured,
      checkedAt: now,
    };
    return unconfigured;
  }

  try {
    const inspected = await inspectMigrationViaSupabaseClient(client);
    const ready = inspected.postgrestCustomersColsOk;

    if (inspected.status.requiresMigration && !loggedMissingUpgradeWarning) {
      loggedMissingUpgradeWarning = true;
      console.warn(
        `[Supabase public.customers] Schema verification failed: ${inspected.status.issues.join(' | ')}`
      );
    } else if (inspected.status.verified) {
      loggedMissingUpgradeWarning = false;
    }

    schemaReadyCache = {
      ready,
      hasUserIdCol: inspected.hasUserIdCol,
      hasHistoryTables: inspected.hasHistoryTables,
      hasExtendedCols: inspected.hasExtendedCols,
      migrationStatus: inspected.status,
      checkedAt: now,
    };
    return inspected.status;
  } catch (err: any) {
    const failedStatus: PublicCustomersMigrationStatus = {
      ...buildUnconfiguredMigrationStatus(),
      checkedVia: 'postgrest',
      configured: true,
      requiresMigration: true,
      issues: [err?.message || 'Unable to verify Supabase schema constraints.'],
      warningMessage:
        'Database schema migration verification failed: please check Supabase connectivity or run supabase/public_customers_sync.sql in Supabase SQL Editor.',
    };
    schemaReadyCache = {
      ready: false,
      hasUserIdCol: false,
      hasHistoryTables: false,
      hasExtendedCols: false,
      migrationStatus: failedStatus,
      checkedAt: now,
    };
    return failedStatus;
  }
}

export async function isPublicCustomersSchemaReady(forceRefresh = false): Promise<boolean> {
  const client = getPublicCustomersClient();
  if (!client) return false;

  await verifyPublicCustomersMigrationStatus(forceRefresh);
  return Boolean(schemaReadyCache?.ready);
}

function mapSupabaseRow(row: Record<string, any>): PublicCustomerRecord {
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();
  const registrationDate = row.registration_date
    ? new Date(row.registration_date).toISOString()
    : createdAt;
  const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : createdAt;
  const rawUserId =
    row.user_id !== null && row.user_id !== undefined ? String(row.user_id).trim() : '';

  return {
    id: String(row.id),
    customerId: String(row.customer_id || '').trim() || `NTF-CUST-${String(row.id).slice(0, 6).toUpperCase()}`,
    userId: rawUserId || null,
    authUserId: row.auth_user_id ? String(row.auth_user_id) : null,
    userUid: String(row.user_uid || row.auth_user_id || row.customer_id || row.id || ''),
    webUserId:
      row.web_user_id !== null && row.web_user_id !== undefined && Number.isFinite(Number(row.web_user_id))
        ? Number(row.web_user_id)
        : null,
    fullName: String(row.full_name || '').trim(),
    email: cleanEmailStr(row.email),
    phoneNumber: cleanMobileStr(row.phone_number || row.mobile || ''),
    companyOrCollege: String(row.company_or_college || row.organization || '').trim(),
    fullAddress: String(row.full_address || '').trim(),
    city: String(row.city || '').trim(),
    state: String(row.state || '').trim(),
    pinCode: String(row.pin_code || '').trim(),
    accountStatus: String(row.account_status || 'Active').trim() || 'Active',
    statusReason: String(row.status_reason || '').trim(),
    emailVerified: Boolean(row.email_verified),
    emailConfirmedAt: row.email_confirmed_at ? new Date(row.email_confirmed_at).toISOString() : null,
    lastPasswordResetAt: row.last_password_reset_at ? new Date(row.last_password_reset_at).toISOString() : null,
    lastPasswordChangeAt: row.last_password_change_at ? new Date(row.last_password_change_at).toISOString() : null,
    passwordResetStatus: String(row.password_reset_status || 'Active').trim() || 'Active',
    registrationDate,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    deletedReason: String(row.deleted_reason || '').trim(),
    createdAt,
    updatedAt,
  };
}

export async function listPublicCustomers(includeDeleted = false): Promise<PublicCustomerRecord[] | null> {
  const client = getPublicCustomersClient();
  if (!client) return null;
  if (!(await isPublicCustomersSchemaReady())) return null;

  let query = client
    .from('customers')
    .select('*')
    .order('registration_date', { ascending: false });

  if (!includeDeleted && schemaReadyCache?.hasExtendedCols) {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[Supabase public.customers] List failed:', error.message);
    return null;
  }

  return (data || []).map((r) => mapSupabaseRow(r));
}

export async function findPublicCustomerByEmail(
  email: string,
  opts?: { includeDeleted?: boolean }
): Promise<PublicCustomerRecord | null> {
  const client = getPublicCustomersClient();
  const cleanEmail = cleanEmailStr(email);
  if (!client || !cleanEmail) return null;
  if (!(await isPublicCustomersSchemaReady())) return null;

  const { data, error } = await client
    .from('customers')
    .select('*')
    .ilike('email', cleanEmail)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const mapped = mapSupabaseRow(data[0]);
  if (!opts?.includeDeleted && mapped.deletedAt) return null;
  return mapped;
}

export async function findPublicCustomerByPhone(phone: string): Promise<PublicCustomerRecord | null> {
  const client = getPublicCustomersClient();
  const cleanPhone = cleanMobileStr(phone);
  if (!client || !cleanPhone) return null;
  if (!(await isPublicCustomersSchemaReady())) return null;

  const { data, error } = await client
    .from('customers')
    .select('*')
    .or(`phone_number.eq.${cleanPhone},mobile.eq.${cleanPhone}`)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const mapped = mapSupabaseRow(data[0]);
  if (mapped.deletedAt) return null;
  return mapped;
}

export async function findPublicCustomerByKey(key: string): Promise<PublicCustomerRecord | null> {
  const client = getPublicCustomersClient();
  const trimmed = String(key || '').trim();
  if (!client || !trimmed) return null;
  if (!(await isPublicCustomersSchemaReady())) return null;

  if (isUuidStr(trimmed)) {
    const { data } = await client
      .from('customers')
      .select('*')
      .or(`id.eq.${trimmed},auth_user_id.eq.${trimmed},user_uid.eq.${trimmed}`)
      .limit(1);
    if (data && data.length > 0) return mapSupabaseRow(data[0]);
  }

  if (/^NTF-CUST-/i.test(trimmed)) {
    const { data } = await client
      .from('customers')
      .select('*')
      .eq('customer_id', trimmed.toUpperCase())
      .limit(1);
    if (data && data.length > 0) return mapSupabaseRow(data[0]);
  }

  if (/^\d+$/.test(trimmed)) {
    const numId = Number(trimmed);
    const { data } = await client
      .from('customers')
      .select('*')
      .eq('web_user_id', numId)
      .limit(1);
    if (data && data.length > 0) return mapSupabaseRow(data[0]);
  }

  if (trimmed.includes('@')) {
    return await findPublicCustomerByEmail(trimmed);
  }

  const { data } = await client
    .from('customers')
    .select('*')
    .eq('user_uid', trimmed)
    .limit(1);
  if (data && data.length > 0) return mapSupabaseRow(data[0]);

  return null;
}

export async function findPublicCustomerForUser(user: {
  authUserId?: string | null;
  uid?: string | null;
  id?: number | null;
  email?: string | null;
}): Promise<PublicCustomerRecord | null> {
  const client = getPublicCustomersClient();
  if (!client) return null;
  if (!(await isPublicCustomersSchemaReady())) return null;

  const filters: string[] = [];
  if (user.authUserId && isUuidStr(user.authUserId)) {
    filters.push(`auth_user_id.eq.${user.authUserId}`);
  }
  if (user.uid && isUuidStr(user.uid)) {
    filters.push(`auth_user_id.eq.${user.uid}`);
    filters.push(`id.eq.${user.uid}`);
  }
  if (user.uid) {
    filters.push(`user_uid.eq.${user.uid}`);
  }
  if (user.id && Number.isInteger(user.id)) {
    filters.push(`web_user_id.eq.${user.id}`);
  }

  if (filters.length > 0) {
    const { data, error } = await client
      .from('customers')
      .select('*')
      .or(filters.join(','))
      .limit(1);
    if (!error && data && data.length > 0) {
      return mapSupabaseRow(data[0]);
    }
  }

  if (user.email) {
    return await findPublicCustomerByEmail(user.email);
  }
  return null;
}

export async function createPublicCustomerRecord(input: {
  customerId?: string;
  userId?: string | null;
  authUserId?: string | null;
  userUid?: string;
  webUserId?: number | null;
  fullName: string;
  email: string;
  phoneNumber?: string;
  companyOrCollege?: string;
  fullAddress?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  accountStatus?: string;
  statusReason?: string;
  emailVerified?: boolean;
  emailConfirmedAt?: Date | string | null;
  passwordResetStatus?: string;
  registrationDate?: Date | string;
  lastLoginAt?: Date | string | null;
}): Promise<PublicCustomerRecord | null> {
  const client = getPublicCustomersClient();
  if (!client) return null;
  if (!(await isPublicCustomersSchemaReady())) return null;

  const cleanEmail = cleanEmailStr(input.email);
  const cleanPhone = cleanMobileStr(input.phoneNumber);
  const cleanCompany = String(input.companyOrCollege || '').trim();
  const explicitCode = input.customerId?.trim();
  const normalizedUserId =
    input.userId !== undefined && input.userId !== null && String(input.userId).trim()
      ? String(input.userId).trim()
      : null;
  const authUid = input.authUserId && isUuidStr(input.authUserId) ? input.authUserId : null;
  const explicitUserUid = String(input.userUid || authUid || '').trim();
  const nowIso = new Date().toISOString();
  const regIso = input.registrationDate ? new Date(input.registrationDate).toISOString() : nowIso;

  const hasUserIdCol = Boolean(schemaReadyCache?.hasUserIdCol);
  const hasExtendedCols = Boolean(schemaReadyCache?.hasExtendedCols);

  const hasRealPostgres = Boolean(createPool());

  // Omit customer_id when not explicitly provided so Postgres sequence + trigger
  // generates NTF-CUST-000001 monotonically (never reusing deleted IDs).
  // user_id is TEXT nullable referencing public.users(id) ON DELETE SET NULL.
  const payload: Record<string, any> = {
    ...(explicitCode ? { customer_id: explicitCode } : {}),
    auth_user_id: authUid,
    ...(hasUserIdCol ? { user_id: normalizedUserId } : {}),
    ...(explicitUserUid ? { user_uid: explicitUserUid } : {}),
    ...(hasRealPostgres && input.webUserId !== undefined ? { web_user_id: input.webUserId } : {}),
    full_name: String(input.fullName || '').trim(),
    email: cleanEmail,
    phone_number: cleanPhone,
    mobile: cleanPhone,
    company_or_college: cleanCompany,
    organization: cleanCompany,
    full_address: String(input.fullAddress || '').trim(),
    city: String(input.city || '').trim(),
    state: String(input.state || '').trim(),
    pin_code: String(input.pinCode || '').trim(),
    account_status: input.accountStatus || 'Active',
    status_reason: String(input.statusReason || '').trim(),
    ...(hasExtendedCols
      ? {
          email_verified: Boolean(input.emailVerified),
          email_confirmed_at: input.emailConfirmedAt ? new Date(input.emailConfirmedAt).toISOString() : null,
          password_reset_status: input.passwordResetStatus || 'Active',
        }
      : {}),
    registration_date: regIso,
    last_login_at: input.lastLoginAt ? new Date(input.lastLoginAt).toISOString() : null,
    updated_at: nowIso,
  };

  let { data, error } = await client
    .from('customers')
    .insert(payload)
    .select('*')
    .single();

  if (error && /web_user_id/i.test(error.message) && payload.web_user_id !== undefined && payload.web_user_id !== null) {
    const retryPayload: Record<string, any> = {
      ...payload,
      web_user_id: null,
    };
    const retried = await client
      .from('customers')
      .insert(retryPayload)
      .select('*')
      .single();
    data = retried.data;
    error = retried.error;
  }

  if (error && /customers_user_id_fkey/i.test(error.message) && (hasRealPostgres || !hasUserIdCol)) {
    if (hasRealPostgres) {
      await ensureCustomerManagementSchema(true);
    }
    await verifyPublicCustomersMigrationStatus(true);
    const retryPayload: Record<string, any> = {
      ...payload,
      user_id: normalizedUserId,
    };
    const retried = await client
      .from('customers')
      .insert(retryPayload)
      .select('*')
      .single();
    data = retried.data;
    error = retried.error;
  }

  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
      const msg = error.message.toLowerCase();
      if (msg.includes('phone') || msg.includes('mobile')) {
        throw new Error('This phone number is already registered with another customer.');
      }
      if (msg.includes('customer_id')) {
        throw new Error('Customer ID conflict occurred. Please try registering again.');
      }
      if (msg.includes('user_uid') || msg.includes('auth_user_id')) {
        throw new Error('This user account is already linked to an existing customer profile.');
      }
      throw new Error('An account with this email already exists.');
    }
    if (/customers_user_id_fkey/i.test(error.message)) {
      const migration = await verifyPublicCustomersMigrationStatus(true);
      console.error('[Supabase public.customers] Insert FK failure:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        migrationIssues: migration.issues,
      });
      if (migration.requiresMigration) {
        throw new Error(
          migration.warningMessage ||
            'Database schema migration required: please run supabase/public_customers_sync.sql in Supabase SQL Editor to verify customers_user_id_fkey -> public.users(id) with TEXT user_id.'
        );
      }
      throw new Error(
        'Customer insert failed customers_user_id_fkey: the supplied user_id does not reference an existing public.users(id).'
      );
    }
    throw new Error(error.message || 'Failed to save customer in Supabase public.customers.');
  }

  const mapped = mapSupabaseRow(data);
  emitCustomerStreamEvent({
    type: 'INSERT',
    id: mapped.id,
    customerId: mapped.customerId,
    email: mapped.email,
  });
  return mapped;
}

export async function updatePublicCustomerRecord(
  id: string,
  patch: {
    customerId?: string;
    userId?: string | null;
    authUserId?: string | null;
    userUid?: string;
    webUserId?: number | null;
    fullName?: string;
    email?: string;
    phoneNumber?: string;
    companyOrCollege?: string;
    fullAddress?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    accountStatus?: string;
    statusReason?: string;
    emailVerified?: boolean;
    emailConfirmedAt?: Date | string | null;
    lastPasswordResetAt?: Date | string | null;
    lastPasswordChangeAt?: Date | string | null;
    passwordResetStatus?: string;
    lastLoginAt?: Date | string | null;
    deletedAt?: Date | string | null;
    deletedReason?: string;
  }
): Promise<PublicCustomerRecord | null> {
  const client = getPublicCustomersClient();
  if (!client) return null;
  if (!(await isPublicCustomersSchemaReady())) return null;

  const hasExtendedCols = Boolean(schemaReadyCache?.hasExtendedCols);
  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.customerId !== undefined) updates.customer_id = patch.customerId;
  if (patch.userId !== undefined) {
    updates.user_id =
      patch.userId !== null && String(patch.userId).trim() ? String(patch.userId).trim() : null;
  }
  if (patch.authUserId !== undefined) {
    updates.auth_user_id = patch.authUserId && isUuidStr(patch.authUserId) ? patch.authUserId : null;
  }
  if (patch.userUid !== undefined) updates.user_uid = patch.userUid;
  if (patch.webUserId !== undefined) updates.web_user_id = patch.webUserId;
  if (patch.fullName !== undefined) updates.full_name = String(patch.fullName || '').trim();
  if (patch.email !== undefined) updates.email = cleanEmailStr(patch.email);
  if (patch.phoneNumber !== undefined) {
    const cleanPhone = cleanMobileStr(patch.phoneNumber);
    updates.phone_number = cleanPhone;
    updates.mobile = cleanPhone;
  }
  if (patch.companyOrCollege !== undefined) {
    const cleanCompany = String(patch.companyOrCollege || '').trim();
    updates.company_or_college = cleanCompany;
    updates.organization = cleanCompany;
  }
  if (patch.fullAddress !== undefined) updates.full_address = String(patch.fullAddress || '').trim();
  if (patch.city !== undefined) updates.city = String(patch.city || '').trim();
  if (patch.state !== undefined) updates.state = String(patch.state || '').trim();
  if (patch.pinCode !== undefined) updates.pin_code = String(patch.pinCode || '').trim();
  if (patch.accountStatus !== undefined) updates.account_status = patch.accountStatus;
  if (patch.statusReason !== undefined) updates.status_reason = String(patch.statusReason || '').trim();
  if (patch.lastLoginAt !== undefined) {
    updates.last_login_at = patch.lastLoginAt ? new Date(patch.lastLoginAt).toISOString() : null;
  }
  if (hasExtendedCols) {
    if (patch.emailVerified !== undefined) updates.email_verified = Boolean(patch.emailVerified);
    if (patch.emailConfirmedAt !== undefined) {
      updates.email_confirmed_at = patch.emailConfirmedAt ? new Date(patch.emailConfirmedAt).toISOString() : null;
    }
    if (patch.lastPasswordResetAt !== undefined) {
      updates.last_password_reset_at = patch.lastPasswordResetAt ? new Date(patch.lastPasswordResetAt).toISOString() : null;
    }
    if (patch.lastPasswordChangeAt !== undefined) {
      updates.last_password_change_at = patch.lastPasswordChangeAt ? new Date(patch.lastPasswordChangeAt).toISOString() : null;
    }
    if (patch.passwordResetStatus !== undefined) {
      updates.password_reset_status = String(patch.passwordResetStatus || '').trim();
    }
    if (patch.deletedAt !== undefined) {
      updates.deleted_at = patch.deletedAt ? new Date(patch.deletedAt).toISOString() : null;
    }
    if (patch.deletedReason !== undefined) {
      updates.deleted_reason = String(patch.deletedReason || '').trim();
    }
  }

  const { data, error } = await client
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
      const msg = error.message.toLowerCase();
      if (msg.includes('phone') || msg.includes('mobile')) {
        throw new Error('Another customer already uses this phone number.');
      }
      throw new Error('Another customer already uses this email address.');
    }
    throw new Error(error.message || 'Failed to update customer in Supabase public.customers.');
  }

  const mapped = mapSupabaseRow(data);
  emitCustomerStreamEvent({
    type: 'UPDATE',
    id: mapped.id,
    customerId: mapped.customerId,
    email: mapped.email,
  });
  return mapped;
}

export async function generateNextCustomerCodeFromDb(): Promise<string> {
  const pool = createPool();
  if (pool) {
    const res = await pool.query(
      `SELECT 'NTF-CUST-' || LPAD(nextval('web_platform.customers_code_seq')::text, 6, '0') AS code`
    );
    const code = res.rows?.[0]?.code;
    if (code) return String(code);
  }
  const anyDb = db as any;
  if (typeof anyDb.nextCustomerCode === 'function') {
    return anyDb.nextCustomerCode();
  }
  return `NTF-CUST-${Date.now().toString().slice(-6)}`;
}

export async function recordCustomerIdHistory(entry: {
  customerDbId?: string | number | null;
  authUserId?: string | null;
  email: string;
  previousCustomerId?: string | null;
  newCustomerId: string;
  previousAccountStatus?: string;
  newAccountStatus?: string;
  operationType: string;
  reason?: string;
  changedBy?: string;
}): Promise<void> {
  const cleanEmail = cleanEmailStr(entry.email);
  const authUid = entry.authUserId && isUuidStr(entry.authUserId) ? entry.authUserId : null;
  const dbIdStr = entry.customerDbId ? String(entry.customerDbId) : '';

  try {
    await db.insert(customerIdHistory).values({
      customerDbId: dbIdStr,
      authUserId: authUid,
      email: cleanEmail,
      previousCustomerId: entry.previousCustomerId ?? null,
      newCustomerId: entry.newCustomerId,
      previousAccountStatus: entry.previousAccountStatus || '',
      newAccountStatus: entry.newAccountStatus || 'Active',
      operationType: entry.operationType || 'id_regeneration',
      reason: entry.reason || '',
      changedBy: entry.changedBy || 'system',
    });
  } catch {
    // non-fatal local mirror
  }

  const client = getPublicCustomersClient();
  if (client && (await isPublicCustomersSchemaReady()) && schemaReadyCache?.hasHistoryTables) {
    try {
      await client.from('customer_id_history').insert({
        customer_db_id: isUuidStr(dbIdStr) ? dbIdStr : null,
        auth_user_id: authUid,
        email: cleanEmail,
        previous_customer_id: entry.previousCustomerId ?? null,
        new_customer_id: entry.newCustomerId,
        previous_account_status: entry.previousAccountStatus || '',
        new_account_status: entry.newAccountStatus || 'Active',
        operation_type: entry.operationType || 'id_regeneration',
        reason: entry.reason || '',
        changed_by: entry.changedBy || 'system',
      });
    } catch {
      // non-fatal
    }
  }
}

export async function listCustomerIdHistory(opts: {
  customerDbId?: string | number | null;
  email?: string | null;
  authUserId?: string | null;
}): Promise<CustomerIdHistoryRecord[]> {
  const cleanEmail = cleanEmailStr(opts.email);
  const authUid = opts.authUserId && isUuidStr(opts.authUserId) ? opts.authUserId : null;
  const dbIdStr = opts.customerDbId ? String(opts.customerDbId) : '';
  const results: CustomerIdHistoryRecord[] = [];
  const seenKeys = new Set<string>();

  const client = getPublicCustomersClient();
  if (client && (await isPublicCustomersSchemaReady()) && schemaReadyCache?.hasHistoryTables) {
    try {
      const filters: string[] = [];
      if (isUuidStr(dbIdStr)) filters.push(`customer_db_id.eq.${dbIdStr}`);
      if (authUid) filters.push(`auth_user_id.eq.${authUid}`);
      if (cleanEmail) filters.push(`email.ilike.${cleanEmail}`);

      if (filters.length > 0) {
        const { data } = await client
          .from('customer_id_history')
          .select('*')
          .or(filters.join(','))
          .order('created_at', { ascending: false })
          .limit(100);
        for (const r of data || []) {
          const item: CustomerIdHistoryRecord = {
            id: String(r.id),
            customerDbId: r.customer_db_id ? String(r.customer_db_id) : null,
            authUserId: r.auth_user_id ? String(r.auth_user_id) : null,
            email: cleanEmailStr(r.email),
            previousCustomerId: r.previous_customer_id ? String(r.previous_customer_id) : null,
            newCustomerId: String(r.new_customer_id || ''),
            previousAccountStatus: String(r.previous_account_status || ''),
            newAccountStatus: String(r.new_account_status || ''),
            operationType: String(r.operation_type || 'initial_registration'),
            reason: String(r.reason || ''),
            changedBy: String(r.changed_by || 'system'),
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
          };
          const sig = `${item.previousCustomerId || ''}|${item.newCustomerId}|${item.operationType}|${item.createdAt.slice(0, 16)}`;
          if (!seenKeys.has(sig)) {
            seenKeys.add(sig);
            results.push(item);
          }
        }
      }
    } catch {
      // fall through to local
    }
  }

  try {
    const conds = [];
    if (dbIdStr) conds.push(eq(customerIdHistory.customerDbId, dbIdStr));
    if (authUid) conds.push(eq(customerIdHistory.authUserId, authUid));
    if (cleanEmail) conds.push(sql`lower(${customerIdHistory.email}) = ${cleanEmail}`);
    if (conds.length > 0) {
      const rows = await db
        .select()
        .from(customerIdHistory)
        .where(or(...conds))
        .orderBy(desc(customerIdHistory.createdAt))
        .limit(100);
      for (const r of rows) {
        const createdAt = r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString();
        const sig = `${r.previousCustomerId || ''}|${r.newCustomerId}|${r.operationType}|${createdAt.slice(0, 16)}`;
        if (!seenKeys.has(sig)) {
          seenKeys.add(sig);
          results.push({
            id: r.id,
            customerDbId: r.customerDbId || null,
            authUserId: r.authUserId || null,
            email: cleanEmailStr(r.email),
            previousCustomerId: r.previousCustomerId ?? null,
            newCustomerId: r.newCustomerId,
            previousAccountStatus: r.previousAccountStatus || '',
            newAccountStatus: r.newAccountStatus || '',
            operationType: r.operationType || 'initial_registration',
            reason: r.reason || '',
            changedBy: r.changedBy || 'system',
            createdAt,
          });
        }
      }
    }
  } catch {
    // non-fatal
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function regeneratePublicCustomerId(opts: {
  publicCustomerId: string;
  operationType?: string;
  reason: string;
  changedBy: string;
  newAccountStatus?: string;
}): Promise<{ previousCustomerId: string; newCustomerId: string; record: PublicCustomerRecord | null }> {
  const client = getPublicCustomersClient();
  if (!client || !(await isPublicCustomersSchemaReady())) {
    throw new Error('Supabase public.customers is not initialized.');
  }

  const { data: rpcData, error: rpcErr } = await client.rpc('regenerate_public_customer_id', {
    p_customer_uuid: opts.publicCustomerId,
    p_operation_type: opts.operationType || 'account_restoration',
    p_reason: opts.reason,
    p_changed_by: opts.changedBy,
    p_new_account_status: opts.newAccountStatus || null,
  });

  if (!rpcErr && Array.isArray(rpcData) && rpcData[0]?.new_customer_id) {
    const row = rpcData[0];
    const { data: refreshed } = await client
      .from('customers')
      .select('*')
      .eq('id', opts.publicCustomerId)
      .single();
    const mapped = refreshed ? mapSupabaseRow(refreshed) : null;
    if (mapped) {
      await db.insert(customerIdHistory).values({
        customerDbId: mapped.id,
        authUserId: mapped.authUserId,
        email: mapped.email,
        previousCustomerId: row.previous_customer_id || null,
        newCustomerId: row.new_customer_id,
        previousAccountStatus: '',
        newAccountStatus: mapped.accountStatus,
        operationType: opts.operationType || 'account_restoration',
        reason: opts.reason,
        changedBy: opts.changedBy,
      }).catch(() => {});
      emitCustomerStreamEvent({
        type: 'UPDATE',
        id: mapped.id,
        customerId: mapped.customerId,
        email: mapped.email,
      });
    }
    return {
      previousCustomerId: String(row.previous_customer_id || ''),
      newCustomerId: String(row.new_customer_id),
      record: mapped,
    };
  }

  // Fallback if RPC not yet installed: fetch current, generate monotonic code via DB seq, update & record history
  const { data: current, error: fetchErr } = await client
    .from('customers')
    .select('*')
    .eq('id', opts.publicCustomerId)
    .single();
  if (fetchErr || !current) {
    throw new Error(fetchErr?.message || 'Customer record not found in public.customers.');
  }
  const curMapped = mapSupabaseRow(current);
  const nextCode = await generateNextCustomerCodeFromDb();
  const updated = await updatePublicCustomerRecord(curMapped.id, {
    customerId: nextCode,
    userUid: curMapped.authUserId || nextCode,
    accountStatus: opts.newAccountStatus || curMapped.accountStatus || 'Active',
    deletedAt: opts.newAccountStatus === 'Active' ? null : curMapped.deletedAt,
    deletedReason: opts.newAccountStatus === 'Active' ? '' : curMapped.deletedReason,
  });

  await recordCustomerIdHistory({
    customerDbId: curMapped.id,
    authUserId: curMapped.authUserId,
    email: curMapped.email,
    previousCustomerId: curMapped.customerId,
    newCustomerId: nextCode,
    previousAccountStatus: curMapped.accountStatus,
    newAccountStatus: updated?.accountStatus || opts.newAccountStatus || curMapped.accountStatus,
    operationType: opts.operationType || 'account_restoration',
    reason: opts.reason,
    changedBy: opts.changedBy,
  });

  return {
    previousCustomerId: curMapped.customerId,
    newCustomerId: nextCode,
    record: updated,
  };
}

export async function recordPasswordActivity(entry: {
  customerId?: string;
  customerDbId?: string | number | null;
  email: string;
  authUserId?: string | null;
  actionType: 'registration' | 'reset' | 'change' | 'recovery';
  actionStatus: 'requested' | 'verified' | 'completed' | 'failed';
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  const cleanEmail = cleanEmailStr(entry.email);
  const authUid = entry.authUserId && isUuidStr(entry.authUserId) ? entry.authUserId : null;
  const dbIdStr = entry.customerDbId ? String(entry.customerDbId) : '';
  const ip = String(entry.ipAddress || '').slice(0, 120);
  const ua = String(entry.userAgent || '').slice(0, 240);
  const now = new Date();

  try {
    await db.insert(customerPasswordHistory).values({
      customerId: entry.customerId || '',
      customerDbId: dbIdStr,
      email: cleanEmail,
      authUserId: authUid,
      actionType: entry.actionType,
      actionStatus: entry.actionStatus,
      ipAddress: ip,
      userAgent: ua,
    });
  } catch {
    // non-fatal local mirror
  }

  // Update password metadata timestamps/status when applicable (never storing passwords/tokens!)
  if (entry.actionStatus === 'completed' || (entry.actionType === 'recovery' && entry.actionStatus === 'requested')) {
    const statusLabel =
      entry.actionStatus === 'requested'
        ? 'Recovery Requested'
        : entry.actionType === 'reset' || entry.actionType === 'recovery'
          ? 'Reset Completed'
          : entry.actionType === 'change'
            ? 'Password Changed'
            : 'Active';

    const localCustPatch: Record<string, any> = {
      passwordResetStatus: statusLabel,
      updatedAt: now,
    };
    if (entry.actionStatus === 'completed' && (entry.actionType === 'reset' || entry.actionType === 'recovery')) {
      localCustPatch.lastPasswordResetAt = now;
    }
    if (entry.actionStatus === 'completed' && entry.actionType === 'change') {
      localCustPatch.lastPasswordChangeAt = now;
    }
    if (cleanEmail) {
      await db
        .update(webCustomers)
        .set(localCustPatch)
        .where(sql`lower(${webCustomers.email}) = ${cleanEmail}`)
        .catch(() => {});
    }

    const client = getPublicCustomersClient();
    if (client && (await isPublicCustomersSchemaReady()) && schemaReadyCache?.hasExtendedCols && cleanEmail) {
      try {
        const pubPatch: Record<string, any> = {
          password_reset_status: statusLabel,
          updated_at: now.toISOString(),
        };
        if (entry.actionStatus === 'completed' && (entry.actionType === 'reset' || entry.actionType === 'recovery')) {
          pubPatch.last_password_reset_at = now.toISOString();
        }
        if (entry.actionStatus === 'completed' && entry.actionType === 'change') {
          pubPatch.last_password_change_at = now.toISOString();
        }
        await client.from('customers').update(pubPatch).ilike('email', cleanEmail);
      } catch {
        // non-fatal
      }
    }
  }

  const client = getPublicCustomersClient();
  if (client && (await isPublicCustomersSchemaReady()) && schemaReadyCache?.hasHistoryTables) {
    try {
      await client.from('customer_password_history').insert({
        customer_id: entry.customerId || '',
        customer_db_id: isUuidStr(dbIdStr) ? dbIdStr : null,
        email: cleanEmail,
        auth_user_id: authUid,
        action_type: entry.actionType,
        action_status: entry.actionStatus,
        ip_address: ip,
        user_agent: ua,
      });
    } catch {
      // non-fatal
    }
  }
}

export async function listPasswordActivity(opts: {
  customerId?: string | null;
  customerDbId?: string | number | null;
  email?: string | null;
  authUserId?: string | null;
}): Promise<PasswordActivityRecord[]> {
  const cleanEmail = cleanEmailStr(opts.email);
  const authUid = opts.authUserId && isUuidStr(opts.authUserId) ? opts.authUserId : null;
  const dbIdStr = opts.customerDbId ? String(opts.customerDbId) : '';
  const results: PasswordActivityRecord[] = [];
  const seenKeys = new Set<string>();

  const client = getPublicCustomersClient();
  if (client && (await isPublicCustomersSchemaReady()) && schemaReadyCache?.hasHistoryTables) {
    try {
      const filters: string[] = [];
      if (isUuidStr(dbIdStr)) filters.push(`customer_db_id.eq.${dbIdStr}`);
      if (authUid) filters.push(`auth_user_id.eq.${authUid}`);
      if (cleanEmail) filters.push(`email.ilike.${cleanEmail}`);
      if (opts.customerId) filters.push(`customer_id.eq.${opts.customerId}`);

      if (filters.length > 0) {
        const { data } = await client
          .from('customer_password_history')
          .select('id, customer_id, customer_db_id, email, auth_user_id, action_type, action_status, ip_address, user_agent, created_at')
          .or(filters.join(','))
          .order('created_at', { ascending: false })
          .limit(100);
        for (const r of data || []) {
          const createdAt = r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString();
          const sig = `${r.action_type}|${r.action_status}|${createdAt.slice(0, 16)}`;
          if (!seenKeys.has(sig)) {
            seenKeys.add(sig);
            results.push({
              id: String(r.id),
              customerId: String(r.customer_id || ''),
              customerDbId: r.customer_db_id ? String(r.customer_db_id) : null,
              email: cleanEmailStr(r.email),
              authUserId: r.auth_user_id ? String(r.auth_user_id) : null,
              actionType: String(r.action_type || 'registration'),
              actionStatus: String(r.action_status || 'completed'),
              ipAddress: String(r.ip_address || ''),
              userAgent: String(r.user_agent || ''),
              createdAt,
            });
          }
        }
      }
    } catch {
      // fall through
    }
  }

  try {
    const conds = [];
    if (dbIdStr) conds.push(eq(customerPasswordHistory.customerDbId, dbIdStr));
    if (authUid) conds.push(eq(customerPasswordHistory.authUserId, authUid));
    if (cleanEmail) conds.push(sql`lower(${customerPasswordHistory.email}) = ${cleanEmail}`);
    if (opts.customerId) conds.push(eq(customerPasswordHistory.customerId, opts.customerId));

    if (conds.length > 0) {
      const rows = await db
        .select()
        .from(customerPasswordHistory)
        .where(or(...conds))
        .orderBy(desc(customerPasswordHistory.createdAt))
        .limit(100);
      for (const r of rows) {
        const createdAt = r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString();
        const sig = `${r.actionType}|${r.actionStatus}|${createdAt.slice(0, 16)}`;
        if (!seenKeys.has(sig)) {
          seenKeys.add(sig);
          results.push({
            id: r.id,
            customerId: r.customerId || '',
            customerDbId: r.customerDbId || null,
            email: cleanEmailStr(r.email),
            authUserId: r.authUserId || null,
            actionType: r.actionType,
            actionStatus: r.actionStatus,
            ipAddress: r.ipAddress || '',
            userAgent: r.userAgent || '',
            createdAt,
          });
        }
      }
    }
  } catch {
    // non-fatal
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function findSupabaseAuthUserIdByEmail(email: string): Promise<string | null> {
  const serviceClient = getServiceRoleSupabaseClient();
  const cleanEmail = cleanEmailStr(email);
  if (!serviceClient || !cleanEmail) return null;

  try {
    let page = 1;
    const perPage = 200;
    while (page <= 10) {
      const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
      if (error || !data?.users?.length) break;
      const found = data.users.find((u) => cleanEmailStr(u.email) === cleanEmail);
      if (found) return found.id;
      if (data.users.length < perPage) break;
      page++;
    }
  } catch {
    // non-fatal
  }
  return null;
}

function isProtectedStaffEmail(email: string): boolean {
  const clean = cleanEmailStr(email);
  if (!clean) return false;
  const envAdmins = new Set(
    [
      'info.nexustekfusion@gmail.com',
      'info@nexustekfusion.in',
      process.env.INITIAL_ADMIN_EMAIL || '',
      ...(process.env.ADMIN_EMAILS || '').split(','),
    ]
      .map((e) => cleanEmailStr(e))
      .filter(Boolean)
  );
  return envAdmins.has(clean);
}

export async function deleteSupabaseAuthAccountSafely(opts: {
  authUserId?: string | null;
  email?: string | null;
}): Promise<void> {
  const serviceClient = getServiceRoleSupabaseClient();
  if (!serviceClient) return;

  const cleanEmail = cleanEmailStr(opts.email);
  let targetId = opts.authUserId && isUuidStr(opts.authUserId) ? opts.authUserId : null;
  if (!targetId && cleanEmail) {
    targetId = await findSupabaseAuthUserIdByEmail(cleanEmail);
  }
  if (!targetId) return;

  try {
    // Safety guard: never delete super_admin, admin, or employee auth accounts
    const { data: userLookup } = await serviceClient.auth.admin.getUserById(targetId);
    const metaRole = String(userLookup?.user?.app_metadata?.role || '').toLowerCase();
    const userEmail = cleanEmailStr(userLookup?.user?.email || cleanEmail);
    if (STAFF_ROLES_SET.has(metaRole) || isProtectedStaffEmail(userEmail)) {
      return;
    }

    const staffCheckConds = [eq(users.authUserId, targetId), eq(users.uid, targetId)];
    if (userEmail) staffCheckConds.push(sql`lower(${users.email}) = ${userEmail}`);
    const matchedLocal = await db.select().from(users).where(or(...staffCheckConds));
    if (matchedLocal.some((u) => STAFF_ROLES_SET.has(u.role))) {
      return;
    }

    await serviceClient.auth.admin.deleteUser(targetId);
  } catch (err) {
    console.warn('[Supabase Auth Cleanup] deleteUser warning:', (err as Error)?.message);
  }
}

export async function syncLocalWebUserFromPublicCustomer(
  record: PublicCustomerRecord
): Promise<typeof users.$inferSelect | null> {
  const emailLower = cleanEmailStr(record.email);
  if (!emailLower) return null;

  const matches: Array<typeof users.$inferSelect> = [];
  if (record.webUserId) {
    const byId = await db.select().from(users).where(eq(users.id, record.webUserId)).limit(1);
    if (byId[0]) matches.push(byId[0]);
  }
  if (matches.length === 0 && record.authUserId) {
    const byAuth = await db
      .select()
      .from(users)
      .where(or(eq(users.authUserId, record.authUserId), eq(users.uid, record.authUserId)))
      .limit(1);
    if (byAuth[0]) matches.push(byAuth[0]);
  }
  if (matches.length === 0) {
    const byEmail = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${emailLower}`)
      .limit(1);
    if (byEmail[0]) matches.push(byEmail[0]);
  }

  const existing = matches[0];
  const isActive = record.accountStatus === 'Active';

  if (existing) {
    // Never overwrite or deactivate staff/employee/admin accounts via customer table sync
    if (STAFF_ROLES_SET.has(existing.role)) {
      return existing;
    }

    const [updated] = await db
      .update(users)
      .set({
        authUserId: record.authUserId || existing.authUserId,
        email: emailLower,
        fullName: record.fullName || existing.fullName,
        mobile: record.phoneNumber || existing.mobile,
        companyOrCollege: record.companyOrCollege || existing.companyOrCollege,
        fullAddress: record.fullAddress || existing.fullAddress,
        city: record.city || existing.city,
        state: record.state || existing.state,
        pinCode: record.pinCode || existing.pinCode,
        accountStatus: record.accountStatus,
        statusReason: isActive ? '' : record.statusReason,
        isActive,
        deletedAt: null,
        lastLoginAt: record.lastLoginAt ? new Date(record.lastLoginAt) : existing.lastLoginAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();

    if (!isActive) {
      await db.delete(adminSessions).where(eq(adminSessions.userId, existing.id)).catch(() => {});
    }

    const resolved = updated || existing;
    if (!record.webUserId && resolved.id) {
      const client = getPublicCustomersClient();
      if (client) {
        try {
          await client
            .from('customers')
            .update({ web_user_id: resolved.id })
            .eq('id', record.id)
            .is('web_user_id', null);
        } catch {
          // non-fatal
        }
      }
    }
    return resolved;
  }

  // Do NOT generate fake login accounts (`web_platform.users`) for manually inserted
  // Supabase Table Editor rows that have no linked Supabase Auth user (`auth_user_id IS NULL`).
  // They remain visible in the Admin Dashboard cleanly and can be linked later on registration.
  if (!record.authUserId) {
    return null;
  }

  // Only create a local relational `users` record when a real Supabase Auth account already exists
  const [inserted] = await db
    .insert(users)
    .values({
      uid: record.authUserId,
      authUserId: record.authUserId,
      email: emailLower,
      fullName: record.fullName,
      mobile: record.phoneNumber,
      companyOrCollege: record.companyOrCollege,
      fullAddress: record.fullAddress,
      city: record.city,
      state: record.state,
      pinCode: record.pinCode,
      role: 'customer',
      passwordHash: null,
      accountStatus: record.accountStatus,
      statusReason: isActive ? '' : record.statusReason,
      isActive,
      lastLoginAt: record.lastLoginAt ? new Date(record.lastLoginAt) : null,
      createdAt: new Date(record.registrationDate),
    })
    .onConflictDoNothing()
    .returning();

  if (inserted && !record.webUserId) {
    const client = getPublicCustomersClient();
    if (client) {
      try {
        await client
          .from('customers')
          .update({ web_user_id: inserted.id })
          .eq('id', record.id)
          .is('web_user_id', null);
      } catch {
        // non-fatal
      }
    }
  }

  return inserted || null;
}

export async function handleDeletedCustomerCleanup(opts: {
  id?: string | null;
  customerId?: string | null;
  authUserId?: string | null;
  userUid?: string | null;
  webUserId?: number | null;
  email?: string | null;
  reason?: string;
}): Promise<void> {
  const cleanEmail = cleanEmailStr(opts.email);
  const reason = opts.reason || 'Deleted from Supabase public.customers';
  const now = new Date();

  // 1. Find linked web_platform.users rows (customer roles only — never staff/admins)
  const conditions = [];
  if (opts.webUserId) conditions.push(eq(users.id, opts.webUserId));
  if (opts.authUserId && isUuidStr(opts.authUserId)) {
    conditions.push(eq(users.authUserId, opts.authUserId));
    conditions.push(eq(users.uid, opts.authUserId));
  }
  if (opts.userUid) conditions.push(eq(users.uid, opts.userUid));
  if (opts.customerId) conditions.push(eq(users.uid, opts.customerId));
  if (cleanEmail) conditions.push(sql`lower(${users.email}) = ${cleanEmail}`);

  let resolvedAuthUid = opts.authUserId && isUuidStr(opts.authUserId) ? opts.authUserId : null;
  let resolvedEmail = cleanEmail;
  let matchedStaff = isProtectedStaffEmail(cleanEmail);

  if (conditions.length > 0) {
    const matchedUsers = await db
      .select()
      .from(users)
      .where(or(...conditions));

    for (const u of matchedUsers) {
      if (STAFF_ROLES_SET.has(u.role) || isProtectedStaffEmail(u.email)) {
        matchedStaff = true;
        continue;
      }
      if (!resolvedAuthUid && u.authUserId) resolvedAuthUid = u.authUserId;
      if (!resolvedEmail && u.email) resolvedEmail = cleanEmailStr(u.email);

      await db.delete(adminSessions).where(eq(adminSessions.userId, u.id)).catch(() => {});
      await db
        .update(users)
        .set({
          deletedAt: now,
          isActive: false,
          accountStatus: 'Deactivated',
          statusReason: reason,
          updatedAt: now,
        })
        .where(eq(users.id, u.id))
        .catch(() => {});
    }
  }

  // 2. Clean up any legacy web_platform.customers shadow row
  try {
    const legacyConds = [];
    if (opts.webUserId) legacyConds.push(eq(webCustomers.userId, opts.webUserId));
    if (opts.customerId) legacyConds.push(eq(webCustomers.customerId, opts.customerId));
    if (resolvedEmail) legacyConds.push(sql`lower(${webCustomers.email}) = ${resolvedEmail}`);
    if (legacyConds.length > 0) {
      await db.delete(webCustomers).where(or(...legacyConds));
    }
  } catch {
    // non-fatal
  }

  // 3. Clean up public.customer_profiles & Supabase Auth user (no orphaned accounts, never touch staff/admins)
  if (!matchedStaff) {
    const client = getPublicCustomersClient();
    if (client && resolvedAuthUid) {
      try {
        await client
          .from('customer_profiles')
          .delete()
          .eq('id', resolvedAuthUid)
          .in('role', ['customer', 'buyer', 'farmer', 'drone_pilot']);
      } catch {
        // non-fatal
      }
    } else if (client && resolvedEmail) {
      try {
        await client
          .from('customer_profiles')
          .delete()
          .ilike('email', resolvedEmail)
          .in('role', ['customer', 'buyer', 'farmer', 'drone_pilot']);
      } catch {
        // non-fatal
      }
    }

    await deleteSupabaseAuthAccountSafely({
      authUserId: resolvedAuthUid,
      email: resolvedEmail,
    });
  }
}

export async function deletePublicCustomerAndAuthAccount(
  target: PublicCustomerRecord,
  reason = 'Deleted from Customer Management Dashboard'
): Promise<void> {
  const client = getPublicCustomersClient();
  if (client) {
    const { error } = await client.from('customers').delete().eq('id', target.id);
    if (error) {
      throw new Error(error.message || 'Failed to delete customer from Supabase public.customers.');
    }
  }

  await handleDeletedCustomerCleanup({
    id: target.id,
    customerId: target.customerId,
    authUserId: target.authUserId,
    userUid: target.userUid,
    webUserId: target.webUserId,
    email: target.email,
    reason,
  });

  emitCustomerStreamEvent({
    type: 'DELETE',
    id: target.id,
    customerId: target.customerId,
    email: target.email,
  });
}

export async function reconcileDeletedCustomersFromPublic(): Promise<number> {
  const publicList = await listPublicCustomers(true);
  if (!publicList) return 0;

  // Non-destructive forward sync from public.customers -> web_platform.users.
  // Never automatically delete, reset, or deactivate existing customers, Supabase Auth
  // accounts, admin accounts, or employee accounts when the server boots or page loads.
  let synced = 0;
  for (const pub of publicList) {
    if (pub.deletedAt) continue;
    const updated = await syncLocalWebUserFromPublicCustomer(pub).catch(() => null);
    if (updated) synced++;
  }

  return synced;
}

let realtimeChannel: RealtimeChannel | null = null;
let realtimeStarted = false;

export function startPublicCustomersRealtimeSync(): void {
  if (realtimeStarted) return;
  const serviceClient = getServiceRoleSupabaseClient();
  const client = serviceClient || getServerSupabaseClient();
  if (!client) return;

  realtimeStarted = true;
  try {
    realtimeChannel = client
      .channel('server-public-customers-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customers' },
        async (payload) => {
          try {
            if (payload.eventType === 'DELETE') {
              const oldRow = (payload.old || {}) as Record<string, any>;
              await handleDeletedCustomerCleanup({
                id: oldRow.id ? String(oldRow.id) : null,
                customerId: oldRow.customer_id ? String(oldRow.customer_id) : null,
                authUserId: oldRow.auth_user_id ? String(oldRow.auth_user_id) : null,
                userUid: oldRow.user_uid ? String(oldRow.user_uid) : null,
                webUserId: oldRow.web_user_id ? Number(oldRow.web_user_id) : null,
                email: oldRow.email ? String(oldRow.email) : null,
                reason: 'Deleted from Supabase Table Editor',
              });
              emitCustomerStreamEvent({
                type: 'DELETE',
                id: oldRow.id ? String(oldRow.id) : undefined,
                customerId: oldRow.customer_id ? String(oldRow.customer_id) : undefined,
                email: oldRow.email ? String(oldRow.email) : undefined,
              });
            } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const newRow = (payload.new || {}) as Record<string, any>;
              if (newRow.email) {
                const mapped = mapSupabaseRow(newRow);
                await syncLocalWebUserFromPublicCustomer(mapped);
                emitCustomerStreamEvent({
                  type: payload.eventType,
                  id: mapped.id,
                  customerId: mapped.customerId,
                  email: mapped.email,
                });
              }
            }
          } catch (err) {
            console.warn('[Realtime public.customers] Handler warning:', (err as Error)?.message);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Supabase Realtime] Synchronized with public.customers');
        }
      });

    // Run non-blocking initial reconciliation on boot
    reconcileDeletedCustomersFromPublic().catch(() => {});
  } catch (err) {
    console.warn('[Realtime public.customers] Subscription skipped:', (err as Error)?.message);
  }
}

export function stopPublicCustomersRealtimeSync(): void {
  if (realtimeChannel) {
    realtimeChannel.unsubscribe().catch(() => {});
    realtimeChannel = null;
  }
  realtimeStarted = false;
}
