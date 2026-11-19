import crypto from 'crypto';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { createPool, db } from './index.ts';
import { adminSessions, customerAddresses, customers, users } from './schema.ts';
import { ensureCustomerManagementSchema } from './ensure-customer-mgmt.ts';
import { hashPassword, verifyPassword } from '../server/utils.ts';
import {
  createAnonServerSupabaseClient,
  getServiceRoleSupabaseClient,
} from '../lib/supabase-admin.ts';
import {
  createPublicCustomerRecord,
  deleteSupabaseAuthAccountSafely,
  findPublicCustomerByEmail,
  findPublicCustomerByPhone,
  findPublicCustomerForUser,
  findSupabaseAuthUserIdByEmail,
  isPublicCustomersSchemaReady,
  syncLocalWebUserFromPublicCustomer,
  updatePublicCustomerRecord,
} from '../server/supabase-customers.ts';

const DEFAULT_ADMIN_EMAILS = ['info.nexustekfusion@gmail.com', 'info@nexustekfusion.in'];

export const ADMIN_ROLES_SET = new Set([
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

export class AuthActionError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'AuthActionError';
    this.statusCode = statusCode;
  }
}

export function isUuid(value?: string | null): boolean {
  return Boolean(
    value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

export function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

export function normalizeMobile(mobile?: string | null): string {
  let cleaned = String(mobile || '').trim().replace(/[\s()-]+/g, '');
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) {
    cleaned = cleaned.slice(3);
  } else if (/^91[6-9]\d{9}$/.test(cleaned)) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

const FALLBACK_SESSION_SECRET = crypto
  .createHash('sha256')
  .update(
    `ntf-session-v1-${
      process.env.DATABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.SQL_HOST ||
      'nexustekfusion-local'
    }`
  )
  .digest('hex');

function getSessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    FALLBACK_SESSION_SECRET
  );
}

function signSessionToken(rawToken: string): string {
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(rawToken)
    .digest('hex');
  return `${rawToken}.${sig}`;
}

function verifySignedSessionToken(signed: string): string | null {
  const parts = signed.split('.');
  if (parts.length !== 2) return null;
  const [rawToken, providedSig] = parts;
  if (!rawToken || !providedSig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(rawToken)
    .digest('hex');
  try {
    const a = Buffer.from(providedSig, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return rawToken;
  } catch {
    return null;
  }
}

export function isBootstrapAdminEmail(email: string): boolean {
  const configured = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const envInitial = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  if (envInitial) configured.push(envInitial);
  const allAdmins = new Set([...DEFAULT_ADMIN_EMAILS, ...configured]);
  return allAdmins.has(email.trim().toLowerCase());
}

export async function ensureInitialAdminUser(): Promise<void> {
  const email = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD || '';
  const name = (process.env.INITIAL_ADMIN_NAME || 'Super Admin').trim();

  if (!email || !password) return;

  try {
    const existing = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      const current = existing[0];
      if (!current.passwordHash && !current.authUserId) {
        const serviceClient = getServiceRoleSupabaseClient();
        if (serviceClient) {
          const { data: created } = await serviceClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: current.fullName || name },
          });
          if (created?.user?.id) {
            await db
              .update(users)
              .set({
                authUserId: created.user.id,
                fullName: current.fullName || name,
                role: 'super_admin',
                isActive: true,
                accountStatus: 'Active',
                emailVerified: true,
                emailConfirmedAt: created.user.email_confirmed_at || new Date().toISOString(),
                updatedAt: new Date(),
              })
              .where(eq(users.id, current.id));
            return;
          }
        }
        await db
          .update(users)
          .set({
            fullName: current.fullName || name,
            role: 'super_admin',
            passwordHash: hashPassword(password),
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(users.id, current.id));
      } else if (current.role === 'customer') {
        await db
          .update(users)
          .set({ role: 'super_admin', updatedAt: new Date() })
          .where(eq(users.id, current.id));
      }
      return;
    }

    const serviceClient = getServiceRoleSupabaseClient();
    if (serviceClient) {
      const { data: created } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (created?.user?.id) {
        await db
          .insert(users)
          .values({
            uid: created.user.id,
            authUserId: created.user.id,
            email,
            fullName: name,
            role: 'super_admin',
            passwordHash: null,
            emailVerified: true,
            emailConfirmedAt: created.user.email_confirmed_at || new Date().toISOString(),
            accountStatus: 'Active',
            isActive: true,
          })
          .onConflictDoUpdate({
            target: users.uid,
            set: {
              authUserId: created.user.id,
              role: 'super_admin',
              fullName: name,
              accountStatus: 'Active',
              isActive: true,
              updatedAt: new Date(),
            },
          });
        return;
      }
    }

    await db.insert(users).values({
      uid: `admin_${crypto.randomBytes(6).toString('hex')}`,
      email,
      fullName: name,
      role: 'super_admin',
      passwordHash: hashPassword(password),
      isActive: true,
    });
  } catch (error) {
    console.error('Failed to ensure initial admin user:', error);
  }
}

export async function getAdminSetupStatus() {
  const activeAdmins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), isNull(users.deletedAt), sql`${users.role} <> 'customer'`));
  const hasPasswordAdmin = activeAdmins.length > 0;
  const envConfigured = Boolean(process.env.INITIAL_ADMIN_EMAIL && process.env.INITIAL_ADMIN_PASSWORD);
  return {
    configured: hasPasswordAdmin || envConfigured,
    hasPasswordAdmin,
    envConfigured,
  };
}

async function migrateLegacyUserToSupabaseAuth(
  user: typeof users.$inferSelect,
  plainPassword: string
): Promise<typeof users.$inferSelect> {
  if (user.authUserId) return user;
  const serviceClient = getServiceRoleSupabaseClient();
  if (!serviceClient) return user;

  try {
    const cleanEmail = normalizeEmail(user.email);
    const { data, error } = await serviceClient.auth.admin.createUser({
      email: cleanEmail,
      password: plainPassword,
      email_confirm: true,
      user_metadata: {
        full_name: user.fullName || '',
        phone: user.mobile || '',
        company_or_college: user.companyOrCollege || '',
      },
    });

    if (error || !data?.user?.id) {
      return user;
    }

    const authId = data.user.id;
    const shouldUpgradeUid = !isUuid(user.uid) && (user.uid.startsWith('usr_') || user.uid.startsWith('guest_'));
    const [updated] = await db
      .update(users)
      .set({
        authUserId: authId,
        uid: shouldUpgradeUid ? authId : user.uid,
        passwordHash: null,
        emailVerified: true,
        emailConfirmedAt: user.emailConfirmedAt || data.user.email_confirmed_at || new Date().toISOString(),
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    return updated || user;
  } catch {
    return user;
  }
}

export async function verifyAdminCredentials(email: string, password: string) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !password) return null;

  // 1. Try Supabase Auth first if the admin exists in Supabase Auth
  const anonClient = createAnonServerSupabaseClient();
  if (anonClient) {
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (!error && data?.user?.id) {
      const [dbRow] = await db
        .select()
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            or(
              eq(users.authUserId, data.user.id),
              eq(users.uid, data.user.id),
              sql`lower(${users.email}) = ${cleanEmail}`
            )
          )
        )
        .limit(1);

      if (dbRow && dbRow.isActive && dbRow.accountStatus === 'Active' && ADMIN_ROLES_SET.has(dbRow.role)) {
        const [updated] = await db
          .update(users)
          .set({ authUserId: data.user.id, lastLoginAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, dbRow.id))
          .returning();
        return updated || dbRow;
      }
      return null;
    }
  }

  // 2. Fallback to legacy pre-migration passwordHash for existing admin accounts (e.g. info@nexustekfusion.in)
  const rows = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${cleanEmail}`, isNull(users.deletedAt)))
    .limit(1);

  const user = rows[0];
  if (!user || !user.isActive || user.accountStatus !== 'Active' || !ADMIN_ROLES_SET.has(user.role)) {
    return null;
  }
  if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  return await migrateLegacyUserToSupabaseAuth(user, password);
}

export interface RegisteredCustomerSummary {
  id: string | number;
  customerId: string;
  authUserId: string | null;
  email: string;
  fullName: string;
}

export async function signInCustomerWithSupabaseAuth(email: string, password: string): Promise<{
  user: typeof users.$inferSelect;
  supabaseSession: { access_token: string; refresh_token: string } | null;
}> {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !password) {
    throw new AuthActionError('Email and password are required.', 400);
  }

  await ensureCustomerManagementSchema();

  const publicReady = await isPublicCustomersSchemaReady();
  const publicCustAny = publicReady
    ? await findPublicCustomerByEmail(cleanEmail, { includeDeleted: true })
    : null;
  const publicCust = publicCustAny && !publicCustAny.deletedAt ? publicCustAny : null;

  const [custRow] = await db
    .select()
    .from(customers)
    .where(and(sql`lower(${customers.email}) = ${cleanEmail}`, isNull(customers.deletedAt)))
    .limit(1);

  const userRows = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${cleanEmail}`, isNull(users.deletedAt)))
    .limit(1);
  const localUser = userRows[0];
  const isStaffAccount = Boolean(localUser && ADMIN_ROLES_SET.has(localUser.role));

  if (publicReady && !isStaffAccount && publicCustAny?.deletedAt) {
    throw new AuthActionError('Invalid email or password.', 401);
  }

  if (publicReady && publicCust && !isStaffAccount && publicCust.accountStatus !== 'Active') {
    if (localUser?.id) {
      await db.delete(adminSessions).where(eq(adminSessions.userId, localUser.id)).catch(() => {});
    }
    throw new AuthActionError(
      `Your account is currently ${publicCust.accountStatus || 'inactive'}. Please contact support.`,
      403
    );
  }

  const now = new Date();
  let credentialsVerified = false;
  let supabaseSession: { access_token: string; refresh_token: string } | null = null;
  let supabaseAuthUser: {
    id: string;
    email?: string;
    phone?: string;
    email_confirmed_at?: string;
    phone_confirmed_at?: string;
    user_metadata?: Record<string, any>;
  } | null = null;

  // 1. Preserve existing local credentials (web_platform.customers or web_platform.users scrypt hash)
  if (custRow?.passwordHash && verifyPassword(password, custRow.passwordHash)) {
    credentialsVerified = true;
  } else if (localUser?.passwordHash && verifyPassword(password, localUser.passwordHash)) {
    credentialsVerified = true;
  }

  // 2. Fallback / verify against Supabase Auth if not matched via local hash
  if (!credentialsVerified) {
    const anonClient = createAnonServerSupabaseClient();
    if (anonClient) {
      const { data, error } = await anonClient.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (!error && data?.user) {
        credentialsVerified = true;
        supabaseAuthUser = data.user;
        supabaseSession = data.session
          ? {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
            }
          : null;
      }
    }
  }

  if (!credentialsVerified) {
    throw new AuthActionError('Invalid email or password.', 401);
  }

  // Check active status on local records when Supabase public.customers isn't overriding
  if (custRow && custRow.accountStatus !== 'Active' && (!publicReady || !publicCust)) {
    throw new AuthActionError(
      `Your account is currently ${custRow.accountStatus || 'inactive'}. Please contact support.`,
      403
    );
  }
  if (localUser && (!localUser.isActive || localUser.accountStatus !== 'Active') && (!publicReady || !publicCust)) {
    throw new AuthActionError(
      `Your account is currently ${localUser.accountStatus || 'inactive'}. Please contact support.`,
      403
    );
  }

  // Resolve and connect Supabase Auth user ID without altering existing credentials
  let resolvedAuthUid =
    supabaseAuthUser?.id ||
    publicCust?.authUserId ||
    localUser?.authUserId ||
    (isUuid(localUser?.uid) ? localUser!.uid : null);

  if (!resolvedAuthUid && publicReady) {
    resolvedAuthUid = await findSupabaseAuthUserIdByEmail(cleanEmail);
  }

  // Sync local web_platform.users record (preserving passwordHash & role)
  let linkedUser = localUser;
  if (publicReady && publicCust) {
    const updatedPub = await updatePublicCustomerRecord(publicCust.id, {
      ...(resolvedAuthUid && publicCust.authUserId !== resolvedAuthUid ? { authUserId: resolvedAuthUid } : {}),
      ...(linkedUser?.id && publicCust.webUserId !== linkedUser.id ? { webUserId: linkedUser.id } : {}),
      lastLoginAt: now,
    }).catch(() => publicCust);

    const syncedLocal = await syncLocalWebUserFromPublicCustomer(updatedPub || publicCust);
    if (syncedLocal) {
      linkedUser = syncedLocal;
      if (updatedPub && updatedPub.webUserId !== syncedLocal.id) {
        await updatePublicCustomerRecord(updatedPub.id, { webUserId: syncedLocal.id }).catch(() => {});
      }
    }
  }

  if (!linkedUser) {
    if (custRow) {
      const [createdLink] = await db
        .insert(users)
        .values({
          uid: resolvedAuthUid || custRow.customerId,
          authUserId: resolvedAuthUid,
          email: cleanEmail,
          fullName: custRow.fullName,
          mobile: custRow.phoneNumber,
          companyOrCollege: custRow.companyOrCollege,
          fullAddress: custRow.fullAddress,
          city: custRow.city,
          state: custRow.state,
          pinCode: custRow.pinCode,
          role: 'customer',
          passwordHash: custRow.passwordHash || null,
          accountStatus: custRow.accountStatus || 'Active',
          isActive: (custRow.accountStatus || 'Active') === 'Active',
          lastLoginAt: now,
        })
        .returning();
      linkedUser = createdLink;
      await db
        .update(customers)
        .set({ userId: createdLink.id, lastLoginAt: now, updatedAt: now })
        .where(eq(customers.id, custRow.id));
    } else if (supabaseAuthUser) {
      const meta = supabaseAuthUser.user_metadata || {};
      linkedUser = await getOrCreateUser(
        supabaseAuthUser.id,
        supabaseAuthUser.email || cleanEmail,
        String(meta.full_name || meta.name || '').trim(),
        {
          phone: String(supabaseAuthUser.phone || meta.phone || '').trim(),
          companyOrCollege: String(meta.company_or_college || '').trim(),
          emailConfirmedAt: supabaseAuthUser.email_confirmed_at
            ? String(supabaseAuthUser.email_confirmed_at)
            : '',
          phoneConfirmedAt: supabaseAuthUser.phone_confirmed_at
            ? String(supabaseAuthUser.phone_confirmed_at)
            : '',
        }
      );
    }
  } else {
    const [updatedUser] = await db
      .update(users)
      .set({
        ...(resolvedAuthUid && !linkedUser.authUserId ? { authUserId: resolvedAuthUid } : {}),
        ...(supabaseAuthUser?.email_confirmed_at ? { emailVerified: true, emailConfirmedAt: String(supabaseAuthUser.email_confirmed_at) } : {}),
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, linkedUser.id))
      .returning();
    linkedUser = updatedUser || linkedUser;
  }

  if (custRow) {
    await db
      .update(customers)
      .set({
        ...(linkedUser?.id && !custRow.userId ? { userId: linkedUser.id } : {}),
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(customers.id, custRow.id))
      .catch(() => {});
  }

  if (!linkedUser) {
    throw new AuthActionError('Unable to resolve customer account session.', 500);
  }

  return { user: linkedUser, supabaseSession };
}

export async function verifyUserCredentials(email: string, password: string) {
  try {
    const result = await signInCustomerWithSupabaseAuth(email, password);
    return result.user;
  } catch {
    return null;
  }
}

export async function registerCustomerWithSupabaseAuth(input: {
  email: string;
  password: string;
  fullName: string;
  mobile?: string;
  companyOrCollege?: string;
  fullAddress?: string;
  city?: string;
  state?: string;
  pinCode?: string;
}): Promise<{
  customer: RegisteredCustomerSummary;
  user: typeof users.$inferSelect;
  supabaseSession: null;
}> {
  await ensureCustomerManagementSchema();

  const cleanEmail = normalizeEmail(input.email);
  const cleanFullName = String(input.fullName || '').trim();
  const cleanMobile = normalizeMobile(input.mobile);
  const cleanCompany = String(input.companyOrCollege || '').trim();
  const cleanAddress = String(input.fullAddress || '').trim();
  const cleanCity = String(input.city || '').trim();
  const cleanState = String(input.state || '').trim();
  const cleanPinCode = String(input.pinCode || '').trim();

  if (!cleanFullName || cleanFullName.length < 2) {
    throw new AuthActionError('Full name is required.', 400);
  }
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new AuthActionError('Please enter a valid email address.', 400);
  }
  if (!input.password || input.password.length < 8) {
    throw new AuthActionError('Password must be at least 8 characters long.', 400);
  }
  if (cleanMobile && !/^\+?\d{10,15}$/.test(cleanMobile)) {
    throw new AuthActionError('Please enter a valid 10-digit phone number.', 400);
  }
  if (cleanPinCode && !/^[0-9]{4,10}$/.test(cleanPinCode)) {
    throw new AuthActionError('PIN Code must be 4 to 10 numeric digits.', 400);
  }

  const publicReady = await isPublicCustomersSchemaReady();

  // 1. Check duplicate active email & phone across public.customers (authoritative), web_platform.users, and web_platform.customers
  const [existingPublicEmail, existingCustomerEmailRows, existingUserEmailRows] = await Promise.all([
    publicReady ? findPublicCustomerByEmail(cleanEmail) : Promise.resolve(null),
    db
      .select()
      .from(customers)
      .where(and(sql`lower(${customers.email}) = ${cleanEmail}`, isNull(customers.deletedAt)))
      .limit(1),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${cleanEmail}`, isNull(users.deletedAt)))
      .limit(1),
  ]);

  const unlinkedPublicRow =
    existingPublicEmail &&
    !existingPublicEmail.authUserId &&
    !existingPublicEmail.webUserId &&
    existingCustomerEmailRows.length === 0 &&
    existingUserEmailRows.length === 0
      ? existingPublicEmail
      : null;

  const existingLocalCust = existingCustomerEmailRows[0] || null;
  const unlinkedLocalCustRow =
    !publicReady &&
    existingLocalCust &&
    !existingLocalCust.userId &&
    !existingLocalCust.passwordHash &&
    existingUserEmailRows.length === 0
      ? existingLocalCust
      : null;

  if (unlinkedPublicRow && unlinkedPublicRow.accountStatus !== 'Active') {
    throw new AuthActionError(
      `Your account is currently ${unlinkedPublicRow.accountStatus}. Please contact support.`,
      403
    );
  }
  if (unlinkedLocalCustRow && unlinkedLocalCustRow.accountStatus !== 'Active') {
    throw new AuthActionError(
      `Your account is currently ${unlinkedLocalCustRow.accountStatus}. Please contact support.`,
      403
    );
  }

  if (
    existingUserEmailRows.length > 0 ||
    (existingPublicEmail && !unlinkedPublicRow) ||
    (existingLocalCust && !unlinkedLocalCustRow)
  ) {
    throw new AuthActionError('An account with this email already exists. Please sign in instead.', 409);
  }

  if (cleanMobile) {
    const [existingPublicPhone, existingCustomerMobileRows, existingUserMobileRows] = await Promise.all([
      publicReady ? findPublicCustomerByPhone(cleanMobile) : Promise.resolve(null),
      db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.phoneNumber, cleanMobile), isNull(customers.deletedAt)))
        .limit(1),
      db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.mobile, cleanMobile), isNull(users.deletedAt)))
        .limit(1),
    ]);

    const phoneOwnedByUnlinkedPublic =
      Boolean(existingPublicPhone && unlinkedPublicRow && existingPublicPhone.id === unlinkedPublicRow.id);
    const phoneOwnedByUnlinkedLocal =
      Boolean(
        existingCustomerMobileRows[0] &&
          unlinkedLocalCustRow &&
          existingCustomerMobileRows[0].id === unlinkedLocalCustRow.id
      );

    if (
      (existingPublicPhone && !phoneOwnedByUnlinkedPublic) ||
      (existingCustomerMobileRows.length > 0 && !phoneOwnedByUnlinkedLocal) ||
      existingUserMobileRows.length > 0
    ) {
      throw new AuthActionError(
        'This phone number is already registered with an existing account. Please use a different number or sign in.',
        409
      );
    }
  }

  // 2. Hash password locally (preserving compatibility) AND provision Supabase Auth user ID securely
  const hashed = hashPassword(input.password);
  const now = new Date();
  const role = isBootstrapAdminEmail(cleanEmail) ? 'super_admin' : 'customer';

  let authUserId: string | null = null;
  let createdFreshAuthUser = false;
  const serviceClient = getServiceRoleSupabaseClient();
  if (serviceClient) {
    const { data: createdAuth, error: authErr } = await serviceClient.auth.admin.createUser({
      email: cleanEmail,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: cleanFullName,
        phone: cleanMobile,
        company_or_college: cleanCompany,
      },
    });
    if (!authErr && createdAuth?.user?.id) {
      authUserId = createdAuth.user.id;
      createdFreshAuthUser = true;
    } else if (authErr && /already|exists|registered/i.test(authErr.message)) {
      // Recover only if it's an orphaned auth.users account not belonging to any active user/customer
      const orphanId = await findSupabaseAuthUserIdByEmail(cleanEmail);
      if (orphanId) {
        const { data: updatedAuth } = await serviceClient.auth.admin.updateUserById(orphanId, {
          password: input.password,
          email_confirm: true,
          user_metadata: {
            full_name: cleanFullName,
            phone: cleanMobile,
            company_or_college: cleanCompany,
          },
        });
        if (updatedAuth?.user?.id) {
          authUserId = updatedAuth.user.id;
        }
      }
    }
  }

  // 3. Create linked web_platform.users record (required FK for orders/projects/cart/addresses)
  let linkedUser: typeof users.$inferSelect;
  const tempUid = authUserId || `ntf_${crypto.randomBytes(6).toString('hex')}`;
  try {
    const [insertedUser] = await db
      .insert(users)
      .values({
        uid: tempUid,
        authUserId,
        email: cleanEmail,
        fullName: cleanFullName,
        mobile: cleanMobile || unlinkedPublicRow?.phoneNumber || unlinkedLocalCustRow?.phoneNumber || '',
        companyOrCollege:
          cleanCompany || unlinkedPublicRow?.companyOrCollege || unlinkedLocalCustRow?.companyOrCollege || '',
        fullAddress: cleanAddress || unlinkedPublicRow?.fullAddress || unlinkedLocalCustRow?.fullAddress || '',
        city: cleanCity || unlinkedPublicRow?.city || unlinkedLocalCustRow?.city || '',
        state: cleanState || unlinkedPublicRow?.state || unlinkedLocalCustRow?.state || '',
        pinCode: cleanPinCode || unlinkedPublicRow?.pinCode || unlinkedLocalCustRow?.pinCode || '',
        role,
        passwordHash: hashed,
        emailVerified: Boolean(authUserId),
        phoneVerified: false,
        emailConfirmedAt: authUserId ? now.toISOString() : '',
        phoneConfirmedAt: '',
        accountStatus: 'Active',
        isActive: true,
        lastLoginAt: now,
      })
      .returning();

    linkedUser = insertedUser;
  } catch (userErr: any) {
    if (createdFreshAuthUser && authUserId) {
      await deleteSupabaseAuthAccountSafely({ authUserId, email: cleanEmail }).catch(() => {});
    }
    throw new AuthActionError(userErr?.message || 'Failed to initialize customer account session.', 500);
  }

  // 4. Insert or link authoritative Supabase public.customers table (preserving existing Customer ID when linking!)
  let customerSummary: RegisteredCustomerSummary;
  try {
    if (publicReady) {
      const hasRealPostgres = Boolean(createPool());
      const publicRecord = unlinkedPublicRow
        ? await updatePublicCustomerRecord(unlinkedPublicRow.id, {
            authUserId,
            userUid: authUserId || unlinkedPublicRow.customerId,
            ...(hasRealPostgres ? { webUserId: linkedUser.id } : {}),
            fullName: cleanFullName || unlinkedPublicRow.fullName,
            ...(cleanMobile ? { phoneNumber: cleanMobile } : {}),
            ...(cleanCompany ? { companyOrCollege: cleanCompany } : {}),
            ...(cleanAddress ? { fullAddress: cleanAddress } : {}),
            ...(cleanCity ? { city: cleanCity } : {}),
            ...(cleanState ? { state: cleanState } : {}),
            ...(cleanPinCode ? { pinCode: cleanPinCode } : {}),
            lastLoginAt: now,
          })
        : await createPublicCustomerRecord({
            authUserId,
            userUid: authUserId || undefined,
            ...(hasRealPostgres ? { webUserId: linkedUser.id } : {}),
            fullName: cleanFullName,
            email: cleanEmail,
            phoneNumber: cleanMobile,
            companyOrCollege: cleanCompany,
            fullAddress: cleanAddress,
            city: cleanCity,
            state: cleanState,
            pinCode: cleanPinCode,
            accountStatus: 'Active',
            registrationDate: now,
            lastLoginAt: now,
          });

      if (!publicRecord) {
        throw new Error('Failed to persist customer record in Supabase public.customers.');
      }

      if (!authUserId && linkedUser.uid !== publicRecord.customerId) {
        const [updatedUidUser] = await db
          .update(users)
          .set({ uid: publicRecord.customerId, updatedAt: now })
          .where(eq(users.id, linkedUser.id))
          .returning();
        if (updatedUidUser) linkedUser = updatedUidUser;
      }

      customerSummary = {
        id: publicRecord.id,
        customerId: publicRecord.customerId,
        authUserId: publicRecord.authUserId,
        email: publicRecord.email,
        fullName: publicRecord.fullName,
      };
    } else if (unlinkedLocalCustRow) {
      const [linkedCust] = await db
        .update(customers)
        .set({
          userId: linkedUser.id,
          fullName: cleanFullName || unlinkedLocalCustRow.fullName,
          phoneNumber: cleanMobile || unlinkedLocalCustRow.phoneNumber,
          companyOrCollege: cleanCompany || unlinkedLocalCustRow.companyOrCollege,
          fullAddress: cleanAddress || unlinkedLocalCustRow.fullAddress,
          city: cleanCity || unlinkedLocalCustRow.city,
          state: cleanState || unlinkedLocalCustRow.state,
          pinCode: cleanPinCode || unlinkedLocalCustRow.pinCode,
          passwordHash: hashed,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(customers.id, unlinkedLocalCustRow.id))
        .returning();

      if (!authUserId) {
        const [updatedUidUser] = await db
          .update(users)
          .set({ uid: linkedCust.customerId, updatedAt: now })
          .where(eq(users.id, linkedUser.id))
          .returning();
        if (updatedUidUser) linkedUser = updatedUidUser;
      }

      customerSummary = {
        id: linkedCust.id,
        customerId: linkedCust.customerId,
        authUserId,
        email: linkedCust.email,
        fullName: linkedCust.fullName,
      };
    } else {
      const [insertedCust] = await db
        .insert(customers)
        .values({
          userId: linkedUser.id,
          fullName: cleanFullName,
          email: cleanEmail,
          phoneNumber: cleanMobile,
          companyOrCollege: cleanCompany,
          fullAddress: cleanAddress,
          city: cleanCity,
          state: cleanState,
          pinCode: cleanPinCode,
          passwordHash: hashed,
          accountStatus: 'Active',
          registrationDate: now,
          lastLoginAt: now,
        })
        .returning();

      if (!authUserId) {
        const [updatedUidUser] = await db
          .update(users)
          .set({ uid: insertedCust.customerId, updatedAt: now })
          .where(eq(users.id, linkedUser.id))
          .returning();
        if (updatedUidUser) linkedUser = updatedUidUser;
      }

      customerSummary = {
        id: insertedCust.id,
        customerId: insertedCust.customerId,
        authUserId,
        email: insertedCust.email,
        fullName: insertedCust.fullName,
      };
    }

    if (cleanAddress || cleanCity || cleanState || cleanPinCode) {
      await db.insert(customerAddresses).values({
        userId: linkedUser.id,
        label: 'Primary',
        addressType: 'both',
        fullName: cleanFullName,
        mobile: cleanMobile,
        houseFlat: cleanAddress || cleanCity || 'Primary Address',
        streetArea: '',
        landmark: '',
        city: cleanCity,
        district: cleanCity,
        state: cleanState,
        pinCode: cleanPinCode,
        country: 'India',
        isDefault: true,
      });
    }
  } catch (custErr: any) {
    await db.delete(customerAddresses).where(eq(customerAddresses.userId, linkedUser.id)).catch(() => {});
    await db.delete(users).where(eq(users.id, linkedUser.id)).catch(() => {});
    if (createdFreshAuthUser && authUserId) {
      await deleteSupabaseAuthAccountSafely({ authUserId, email: cleanEmail }).catch(() => {});
    }
    if (custErr instanceof AuthActionError) throw custErr;
    const msg = String(custErr?.message || '');
    if (/already exists|already registered|duplicate|unique/i.test(msg)) {
      throw new AuthActionError(msg, 409);
    }
    throw new AuthActionError(msg || 'Failed to save customer registration record.', 500);
  }

  return { customer: customerSummary, user: linkedUser, supabaseSession: null };
}

export async function createAdminSession(userId: number, userAgent = '') {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(adminSessions).values({
    tokenHash,
    userId,
    userAgent: userAgent.slice(0, 240),
    expiresAt,
  });

  return {
    cookieValue: signSessionToken(rawToken),
    expiresAt,
  };
}

export async function getUserBySessionToken(signedToken: string) {
  const rawToken = verifySignedSessionToken(signedToken);
  if (!rawToken) return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const rows = await db
    .select({ user: users })
    .from(adminSessions)
    .innerJoin(users, eq(adminSessions.userId, users.id))
    .where(
      and(
        eq(adminSessions.tokenHash, tokenHash),
        gt(adminSessions.expiresAt, new Date()),
        isNull(users.deletedAt)
      )
    )
    .limit(1);

  const found = rows[0]?.user;
  if (!found || !found.isActive || found.accountStatus !== 'Active') return null;
  return found;
}

export async function deleteAdminSession(signedToken: string) {
  const rawToken = verifySignedSessionToken(signedToken);
  if (!rawToken) return;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
}

export async function updateUserPassword(userId: number, newPassword: string) {
  const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userRow) throw new AuthActionError('User not found.', 404);

  const serviceClient = getServiceRoleSupabaseClient();
  if (serviceClient) {
    let targetAuthId = userRow.authUserId || (isUuid(userRow.uid) ? userRow.uid : null);
    if (targetAuthId) {
      const { error } = await serviceClient.auth.admin.updateUserById(targetAuthId, {
        password: newPassword,
      });
      if (error) {
        throw new AuthActionError(error.message || 'Failed to update password in Supabase Auth.', 400);
      }
    } else {
      const { data: created, error } = await serviceClient.auth.admin.createUser({
        email: normalizeEmail(userRow.email),
        password: newPassword,
        email_confirm: true,
        user_metadata: {
          full_name: userRow.fullName || '',
          phone: userRow.mobile || '',
          company_or_college: userRow.companyOrCollege || '',
        },
      });
      if (error || !created?.user?.id) {
        throw new AuthActionError(error?.message || 'Failed to sync password with Supabase Auth.', 400);
      }
      targetAuthId = created.user.id;
    }

    await db
      .update(users)
      .set({
        authUserId: targetAuthId,
        passwordHash: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    return;
  }

  await db
    .update(users)
    .set({
      passwordHash: hashPassword(newPassword),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  fullName?: string,
  extra?: {
    phone?: string;
    companyOrCollege?: string;
    emailConfirmedAt?: string;
    phoneConfirmedAt?: string;
  }
) {
  try {
    const cleanEmail = normalizeEmail(email);
    const authUuid = isUuid(uid) ? uid : null;
    const incomingPhone = normalizeMobile(extra?.phone);
    const incomingCompany = String(extra?.companyOrCollege || '').trim();
    const shouldBeSuperAdmin = cleanEmail ? isBootstrapAdminEmail(cleanEmail) : false;
    const emailVerified = Boolean(extra?.emailConfirmedAt);
    const phoneVerified = Boolean(extra?.phoneConfirmedAt);

    const publicReady = await isPublicCustomersSchemaReady();
    const publicCust =
      publicReady && !shouldBeSuperAdmin
        ? await findPublicCustomerForUser({ authUserId: authUuid, uid, email: cleanEmail })
        : null;

    // Guard against deleted Supabase auth tokens trying to re-authenticate after deletion in public.customers
    if (publicReady && !shouldBeSuperAdmin && !publicCust && authUuid) {
      const [deletedByAuth] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(and(or(eq(users.authUserId, authUuid), eq(users.uid, uid)), sql`${users.deletedAt} IS NOT NULL`))
        .limit(1);
      if (deletedByAuth && !ADMIN_ROLES_SET.has(deletedByAuth.role)) {
        await deleteSupabaseAuthAccountSafely({ authUserId: authUuid, email: cleanEmail }).catch(() => {});
        throw new AuthActionError('Your customer account has been removed.', 401);
      }
    }

    // Avoid colliding with another user's unique mobile
    let safeIncomingPhone = incomingPhone;
    if (safeIncomingPhone) {
      const phoneConflict = await db
        .select({ id: users.id, uid: users.uid, authUserId: users.authUserId, email: users.email })
        .from(users)
        .where(and(eq(users.mobile, safeIncomingPhone), isNull(users.deletedAt)))
        .limit(1);
      if (
        phoneConflict.length > 0 &&
        phoneConflict[0].uid !== uid &&
        phoneConflict[0].authUserId !== authUuid &&
        normalizeEmail(phoneConflict[0].email) !== cleanEmail
      ) {
        safeIncomingPhone = '';
      }
    }

    const existing = await db
      .select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          authUuid ? or(eq(users.authUserId, authUuid), eq(users.uid, uid)) : eq(users.uid, uid)
        )
      )
      .limit(1);

    let resultUser: typeof users.$inferSelect;

    if (existing.length > 0) {
      const current = existing[0];
      const nextRole = shouldBeSuperAdmin && current.role === 'customer' ? 'super_admin' : current.role;
      const shouldUpgradeUid = Boolean(
        authUuid && !isUuid(current.uid) && (current.uid.startsWith('usr_') || current.uid.startsWith('guest_'))
      );
      const [updated] = await db
        .update(users)
        .set({
          authUserId: authUuid || current.authUserId,
          uid: shouldUpgradeUid && authUuid ? authUuid : current.uid,
          email: cleanEmail || current.email,
          fullName: publicCust?.fullName || current.fullName || fullName || '',
          mobile: publicCust?.phoneNumber || current.mobile || safeIncomingPhone,
          companyOrCollege: publicCust?.companyOrCollege || current.companyOrCollege || incomingCompany,
          accountStatus: publicCust ? publicCust.accountStatus : current.accountStatus,
          isActive: publicCust ? publicCust.accountStatus === 'Active' : current.isActive,
          emailVerified: current.emailVerified || emailVerified,
          phoneVerified: current.phoneVerified || phoneVerified,
          emailConfirmedAt: extra?.emailConfirmedAt || current.emailConfirmedAt,
          phoneConfirmedAt: extra?.phoneConfirmedAt || current.phoneConfirmedAt,
          role: nextRole,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, current.id))
        .returning();
      resultUser = updated;
    } else if (cleanEmail) {
      const byEmail = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = ${cleanEmail}`, isNull(users.deletedAt)))
        .limit(1);

      if (byEmail.length > 0) {
        const current = byEmail[0];
        const nextRole = shouldBeSuperAdmin && current.role === 'customer' ? 'super_admin' : current.role;
        const shouldUpgradeUid = Boolean(
          authUuid && (!isUuid(current.uid) && (current.uid.startsWith('usr_') || current.uid.startsWith('guest_')))
        );
        const [linked] = await db
          .update(users)
          .set({
            uid: shouldUpgradeUid && authUuid ? authUuid : current.uid,
            authUserId: authUuid || current.authUserId,
            fullName: publicCust?.fullName || current.fullName || fullName || '',
            mobile: publicCust?.phoneNumber || current.mobile || safeIncomingPhone,
            companyOrCollege: publicCust?.companyOrCollege || current.companyOrCollege || incomingCompany,
            accountStatus: publicCust ? publicCust.accountStatus : current.accountStatus,
            isActive: publicCust ? publicCust.accountStatus === 'Active' : current.isActive,
            emailVerified: current.emailVerified || emailVerified,
            phoneVerified: current.phoneVerified || phoneVerified,
            emailConfirmedAt: extra?.emailConfirmedAt || current.emailConfirmedAt,
            phoneConfirmedAt: extra?.phoneConfirmedAt || current.phoneConfirmedAt,
            role: nextRole,
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, current.id))
          .returning();
        resultUser = linked;
      } else {
        const [inserted] = await db
          .insert(users)
          .values({
            uid,
            authUserId: authUuid,
            email: cleanEmail,
            fullName: publicCust?.fullName || fullName || '',
            mobile: publicCust?.phoneNumber || safeIncomingPhone,
            companyOrCollege: publicCust?.companyOrCollege || incomingCompany,
            fullAddress: publicCust?.fullAddress || '',
            city: publicCust?.city || '',
            state: publicCust?.state || '',
            pinCode: publicCust?.pinCode || '',
            passwordHash: null,
            emailVerified,
            phoneVerified,
            emailConfirmedAt: extra?.emailConfirmedAt || '',
            phoneConfirmedAt: extra?.phoneConfirmedAt || '',
            role: shouldBeSuperAdmin ? 'super_admin' : 'customer',
            accountStatus: publicCust ? publicCust.accountStatus : 'Active',
            isActive: publicCust ? publicCust.accountStatus === 'Active' : true,
            lastLoginAt: new Date(),
          })
          .onConflictDoUpdate({
            target: users.uid,
            set: {
              authUserId: authUuid,
              email: cleanEmail,
              mobile: publicCust?.phoneNumber || safeIncomingPhone,
              companyOrCollege: publicCust?.companyOrCollege || incomingCompany,
              emailVerified,
              phoneVerified,
              lastLoginAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();
        resultUser = inserted;
      }
    } else {
      const [inserted] = await db
        .insert(users)
        .values({
          uid,
          authUserId: authUuid,
          email: cleanEmail,
          fullName: fullName || '',
          mobile: safeIncomingPhone,
          companyOrCollege: incomingCompany,
          passwordHash: null,
          emailVerified,
          phoneVerified,
          emailConfirmedAt: extra?.emailConfirmedAt || '',
          phoneConfirmedAt: extra?.phoneConfirmedAt || '',
          role: 'customer',
          accountStatus: 'Active',
          isActive: true,
          lastLoginAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { authUserId: authUuid, email: cleanEmail, lastLoginAt: new Date(), updatedAt: new Date() },
        })
        .returning();
      resultUser = inserted;
    }

    // Enforce Supabase public.customers synchronization for non-staff customer accounts
    if (publicReady && !ADMIN_ROLES_SET.has(resultUser.role)) {
      const hasRealPostgres = Boolean(createPool());
      if (publicCust) {
        if (publicCust.deletedAt) {
          throw new AuthActionError('Your customer account has been removed.', 401);
        }
        await updatePublicCustomerRecord(publicCust.id, {
          ...(authUuid && publicCust.authUserId !== authUuid ? { authUserId: authUuid } : {}),
          ...(hasRealPostgres && publicCust.webUserId !== resultUser.id ? { webUserId: resultUser.id } : {}),
          lastLoginAt: new Date(),
        }).catch(() => {});
      } else if (cleanEmail) {
        // Ensure existing/new customer profile is persisted cleanly into public.customers
        await createPublicCustomerRecord({
          authUserId: authUuid,
          userUid: authUuid || resultUser.uid,
          ...(hasRealPostgres ? { webUserId: resultUser.id } : {}),
          fullName: resultUser.fullName || cleanEmail.split('@')[0],
          email: cleanEmail,
          phoneNumber: resultUser.mobile || safeIncomingPhone,
          companyOrCollege: resultUser.companyOrCollege || incomingCompany,
          accountStatus: resultUser.accountStatus || 'Active',
          lastLoginAt: new Date(),
        }).catch(() => {});
      }
    }

    import('../server/supabase-ecommerce.ts')
      .then(({ syncCustomerProfileToSupabase }) =>
        syncCustomerProfileToSupabase({
          uid: resultUser.uid,
          email: resultUser.email,
          fullName: resultUser.fullName,
          mobile: resultUser.mobile,
          companyOrCollege: resultUser.companyOrCollege,
          role: resultUser.role,
          emailVerified: resultUser.emailVerified,
          phoneVerified: resultUser.phoneVerified,
          emailConfirmedAt: resultUser.emailConfirmedAt,
          phoneConfirmedAt: resultUser.phoneConfirmedAt,
        })
      )
      .catch(() => {});

    return resultUser;
  } catch (error) {
    if (error instanceof AuthActionError) throw error;
    console.error('Failed to upsert user:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.uid, uid), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to retrieve user record.', { cause: error });
  }
}
