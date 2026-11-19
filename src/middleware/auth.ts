import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { adminSessions } from '../db/schema.ts';
import { verifySupabaseAccessToken } from '../lib/supabase-admin.ts';
import {
  ADMIN_ROLES_SET,
  getOrCreateUser,
  getUserBySessionToken,
} from '../db/users.ts';
import {
  findPublicCustomerForUser,
  isPublicCustomersSchemaReady,
} from '../server/supabase-customers.ts';
import { parseCookies } from '../server/utils.ts';

export const ADMIN_SESSION_COOKIE = 'ntf_admin_session';
export const USER_SESSION_COOKIE = 'ntf_session';

export const ADMIN_ROLES = ADMIN_ROLES_SET;

export interface DbUser {
  id: number;
  uid: string;
  authUserId?: string | null;
  email: string;
  fullName: string;
  mobile: string;
  companyOrCollege: string;
  role: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  emailConfirmedAt?: string;
  phoneConfirmedAt?: string;
  isActive?: boolean;
}

export interface AuthUserClaims {
  uid: string;
  email?: string;
  name?: string;
}

export interface AuthRequest extends Request {
  user?: AuthUserClaims;
  dbUser?: DbUser;
}

async function enforcePublicCustomerActive(dbUser: DbUser): Promise<DbUser | null> {
  if (ADMIN_ROLES_SET.has(dbUser.role)) return dbUser;
  if (!(await isPublicCustomersSchemaReady())) return dbUser;

  const publicCust = await findPublicCustomerForUser({
    authUserId: dbUser.authUserId,
    uid: dbUser.uid,
    id: dbUser.id,
    email: dbUser.email,
  });

  if (!publicCust) {
    return dbUser;
  }

  if (publicCust.deletedAt) {
    await db.delete(adminSessions).where(eq(adminSessions.userId, dbUser.id)).catch(() => {});
    return null;
  }

  if (publicCust.accountStatus !== 'Active') {
    await db.delete(adminSessions).where(eq(adminSessions.userId, dbUser.id)).catch(() => {});
    const disabledErr = new Error(
      `Your account is currently ${publicCust.accountStatus}. Please contact support.`
    );
    (disabledErr as any).statusCode = 403;
    throw disabledErr;
  }

  return {
    ...dbUser,
    fullName: publicCust.fullName || dbUser.fullName,
    mobile: publicCust.phoneNumber || dbUser.mobile,
    companyOrCollege: publicCust.companyOrCollege || dbUser.companyOrCollege,
  };
}

async function resolveUserFromRequest(
  req: Request
): Promise<{ dbUser: DbUser; authUser?: AuthUserClaims } | null> {
  // 1. Check signed HTTP-only Admin or User Session cookie
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[ADMIN_SESSION_COOKIE] || cookies[USER_SESSION_COOKIE];
  if (sessionToken) {
    const cookieUser = await getUserBySessionToken(sessionToken);
    if (cookieUser && cookieUser.isActive !== false) {
      const checkedUser = await enforcePublicCustomerActive(cookieUser);
      if (!checkedUser) return null;
      return {
        dbUser: checkedUser,
        authUser: { uid: checkedUser.uid, email: checkedUser.email, name: checkedUser.fullName },
      };
    }
  }

  // 2. Fall back to Bearer header (signed session token or Supabase Access Token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token || token === 'null' || token === 'undefined') {
      return null;
    }

    const sessionUser = await getUserBySessionToken(token);
    if (sessionUser && sessionUser.isActive !== false) {
      const checkedUser = await enforcePublicCustomerActive(sessionUser);
      if (!checkedUser) return null;
      return {
        dbUser: checkedUser,
        authUser: { uid: checkedUser.uid, email: checkedUser.email, name: checkedUser.fullName },
      };
    }

    const verified = await verifySupabaseAccessToken(token);
    if (!verified) {
      return null;
    }
    const dbUser = await getOrCreateUser(verified.uid, verified.email, verified.fullName, {
      phone: verified.phone,
      emailConfirmedAt: verified.emailConfirmedAt,
      phoneConfirmedAt: verified.phoneConfirmedAt,
    });
    if (dbUser.isActive === false) {
      const disabledErr = new Error('Account is disabled.');
      (disabledErr as any).statusCode = 403;
      throw disabledErr;
    }
    const checkedUser = await enforcePublicCustomerActive(dbUser);
    if (!checkedUser) return null;
    return {
      dbUser: checkedUser,
      authUser: { uid: verified.uid, email: verified.email, name: verified.fullName },
    };
  }

  return null;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const resolved = await resolveUserFromRequest(req);
    if (!resolved) {
      const hasBearer = Boolean(
        req.headers.authorization &&
          req.headers.authorization.startsWith('Bearer ') &&
          !['', 'null', 'undefined'].includes(req.headers.authorization.slice('Bearer '.length).trim())
      );
      return res.status(401).json({
        error: hasBearer
          ? 'Invalid or expired authentication token.'
          : 'Authentication required. Please sign in.',
        code: hasBearer ? 'TOKEN_INVALID' : 'UNAUTHENTICATED',
      });
    }
    req.user = resolved.authUser;
    req.dbUser = resolved.dbUser;
    next();
  } catch (error: any) {
    const status = Number(error?.statusCode) || 401;
    if (status >= 500) {
      console.error('Auth verification system error:', error);
    }
    return res.status(status).json({ error: error?.message || 'Invalid or expired authentication token.' });
  }
};

export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const resolved = await resolveUserFromRequest(req);
    if (resolved) {
      req.user = resolved.authUser;
      req.dbUser = resolved.dbUser;
    }
  } catch {
    // Ignore optional auth failures on public routes
  }
  next();
};

export const requireAdmin = (allowedRoles?: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.dbUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.dbUser.isActive === false) {
      return res.status(403).json({ error: 'This staff account has been deactivated.' });
    }
    const role = req.dbUser.role;
    if (!ADMIN_ROLES.has(role)) {
      return res.status(403).json({ error: 'Admin access denied for your account role.' });
    }
    if (allowedRoles && role !== 'super_admin' && role !== 'admin' && !allowedRoles.includes(role)) {
      return res.status(403).json({ error: `Role '${role}' is not authorized for this action.` });
    }
    next();
  };
};
