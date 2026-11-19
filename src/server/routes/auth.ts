import { Router } from 'express';
import {
  AuthActionError,
  createAdminSession,
  deleteAdminSession,
  ensureInitialAdminUser,
  getAdminSetupStatus,
  registerCustomerWithSupabaseAuth,
  signInCustomerWithSupabaseAuth,
  updateUserPassword,
  verifyAdminCredentials,
} from '../../db/users.ts';
import {
  ADMIN_SESSION_COOKIE,
  AuthRequest,
  optionalAuth,
  requireAdmin,
  requireAuth,
  USER_SESSION_COOKIE,
} from '../../middleware/auth.ts';
import { logAudit, parseCookies, verifyPassword } from '../utils.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema.ts';
import { eq } from 'drizzle-orm';
import { getSupabasePublicConfig } from '../../lib/supabase-admin.ts';

function isHttpsRequest(req: { secure?: boolean; headers: Record<string, any> }): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return Boolean(req.secure || proto === 'https' || (process.env.APP_URL || '').startsWith('https://'));
}

function buildCookieOptions(req: { secure?: boolean; headers: Record<string, any> }, expires?: Date) {
  const isHttps = isHttpsRequest(req);
  return {
    httpOnly: true,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    secure: isHttps,
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

export const authRouter = Router();

authRouter.get('/session', optionalAuth, (req: AuthRequest, res) => {
  if (!req.dbUser) {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[USER_SESSION_COOKIE] || cookies[ADMIN_SESSION_COOKIE]) {
      const clearOpts = buildCookieOptions(req);
      res.clearCookie(USER_SESSION_COOKIE, clearOpts);
      res.clearCookie(ADMIN_SESSION_COOKIE, clearOpts);
    }
    return res.json({ authenticated: false, user: null });
  }
  return res.json({
    authenticated: true,
    user: {
      id: req.dbUser.id,
      uid: req.dbUser.uid,
      email: req.dbUser.email,
      fullName: req.dbUser.fullName,
      mobile: req.dbUser.mobile,
      companyOrCollege: req.dbUser.companyOrCollege,
      role: req.dbUser.role,
      emailVerified: req.dbUser.emailVerified,
      phoneVerified: req.dbUser.phoneVerified,
      isActive: req.dbUser.isActive,
    },
  });
});

authRouter.get('/oauth-status', async (req, res) => {
  const pub = getSupabasePublicConfig();
  const envAppUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const origin = envAppUrl || `${proto}://${req.get('host') || 'localhost:3000'}`;
  const redirectTo = `${origin}/auth/callback`;

  let googleProviderReady: boolean | null = null;
  let googleProviderError: string | null = null;

  if (pub.configured && req.query.probe === 'google') {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const probeRes = await fetch(
        `${pub.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`,
        { redirect: 'manual', signal: controller.signal }
      );
      clearTimeout(timer);

      if (probeRes.status >= 300 && probeRes.status < 400) {
        googleProviderReady = true;
      } else {
        googleProviderReady = false;
        const body = (await probeRes.json().catch(() => ({}))) as { msg?: string; error_code?: string };
        googleProviderError = body?.msg || `HTTP ${probeRes.status}`;
      }
    } catch {
      googleProviderReady = null;
    }
  }

  res.json({
    supabaseConfigured: pub.configured,
    supabaseUrlOrigin: pub.url || null,
    supabaseCallbackUrl: pub.url ? `${pub.url}/auth/v1/callback` : null,
    googleProviderReady,
    googleProviderError,
    recommendedRedirectUrls: Array.from(
      new Set([
        redirectTo,
        `${origin}/auth/callback`,
      ])
    ),
  });
});

authRouter.post('/sync-profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userRow = req.dbUser!;
    const ua = String(req.headers['user-agent'] || '');
    const session = await createAdminSession(userRow.id, ua);
    res.cookie(USER_SESSION_COOKIE, session.cookieValue, buildCookieOptions(req, session.expiresAt));
    res.json({
      sessionToken: session.cookieValue,
      user: {
        id: userRow.id,
        uid: userRow.uid,
        email: userRow.email,
        fullName: userRow.fullName,
        mobile: userRow.mobile,
        companyOrCollege: userRow.companyOrCollege,
        role: userRow.role,
        emailVerified: userRow.emailVerified,
        phoneVerified: userRow.phoneVerified,
        isActive: userRow.isActive,
      },
    });
  } catch (error) {
    console.error('OAuth profile sync error:', error);
    res.status(500).json({ error: 'Failed to synchronize OAuth profile.' });
  }
});

authRouter.post('/register', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const fullName = String(req.body.fullName || '').trim();
    const mobile = String(req.body.mobile || '').trim();
    const companyOrCollege = String(req.body.companyOrCollege || '').trim();
    const fullAddress = String(req.body.fullAddress || '').trim();
    const city = String(req.body.city || '').trim();
    const state = String(req.body.state || '').trim();
    const pinCode = String(req.body.pinCode || '').trim();

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required.' });
    }
    if (!fullName) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const { customer, user } = await registerCustomerWithSupabaseAuth({
      email,
      password,
      fullName,
      mobile,
      companyOrCollege,
      fullAddress,
      city,
      state,
      pinCode,
    });

    const ua = String(req.headers['user-agent'] || '');
    const session = await createAdminSession(user.id, ua);

    res.cookie(USER_SESSION_COOKIE, session.cookieValue, buildCookieOptions(req, session.expiresAt));

    await logAudit({
      actorUid: customer.customerId,
      actorEmail: customer.email,
      action: 'USER_REGISTERED',
      entityType: 'customer',
      entityId: customer.id,
      details: {
        customerId: customer.customerId,
        role: user.role,
        authProvider: 'supabase_customers_table',
      },
    });

    res.status(201).json({
      sessionToken: session.cookieValue,
      customerId: customer.customerId,
      user: {
        id: user.id,
        uid: user.uid,
        customerId: customer.customerId,
        email: user.email,
        fullName: user.fullName,
        mobile: user.mobile,
        companyOrCollege: user.companyOrCollege,
        fullAddress: user.fullAddress,
        city: user.city,
        state: user.state,
        pinCode: user.pinCode,
        role: user.role,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        isActive: user.isActive,
      },
    });
  } catch (error: any) {
    const status = error instanceof AuthActionError ? error.statusCode : 400;
    if (status >= 500) {
      console.error('Customer registration error:', error);
    }
    res.status(status).json({ error: error?.message || 'Registration failed.' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    await ensureInitialAdminUser();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { user, supabaseSession } = await signInCustomerWithSupabaseAuth(email, password);

    const ua = String(req.headers['user-agent'] || '');
    const session = await createAdminSession(user.id, ua);

    res.cookie(USER_SESSION_COOKIE, session.cookieValue, buildCookieOptions(req, session.expiresAt));

    res.json({
      sessionToken: session.cookieValue,
      supabaseSession,
      user: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        fullName: user.fullName,
        mobile: user.mobile,
        companyOrCollege: user.companyOrCollege,
        role: user.role,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        isActive: user.isActive,
      },
    });
  } catch (error: any) {
    if (error instanceof AuthActionError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

authRouter.post('/logout', async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[USER_SESSION_COOKIE]) await deleteAdminSession(cookies[USER_SESSION_COOKIE]);
    if (cookies[ADMIN_SESSION_COOKIE]) await deleteAdminSession(cookies[ADMIN_SESSION_COOKIE]);
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      await deleteAdminSession(authHeader.split('Bearer ')[1]);
    }
  } catch {
    // ignore
  }
  const clearOpts = buildCookieOptions(req);
  res.clearCookie(USER_SESSION_COOKIE, clearOpts);
  res.clearCookie(ADMIN_SESSION_COOKIE, clearOpts);
  res.json({ ok: true });
});

authRouter.get('/admin-setup-status', async (_req, res) => {
  try {
    await ensureInitialAdminUser();
    const status = await getAdminSetupStatus();
    res.json(status);
  } catch {
    res.status(500).json({ error: 'Failed to inspect admin setup status.' });
  }
});

authRouter.post('/admin-login', async (req, res) => {
  try {
    await ensureInitialAdminUser();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await verifyAdminCredentials(email, password);
    if (!user) {
      await logAudit({
        actorUid: 'anonymous',
        actorEmail: email,
        action: 'ADMIN_LOGIN_FAILED',
        entityType: 'admin_auth',
        details: { reason: 'Invalid credentials or unauthorized role' },
      });
      return res.status(401).json({ error: 'Invalid admin email or password.' });
    }

    const ua = String(req.headers['user-agent'] || '');
    const session = await createAdminSession(user.id, ua);

    res.cookie(ADMIN_SESSION_COOKIE, session.cookieValue, buildCookieOptions(req, session.expiresAt));

    await logAudit({
      actorUid: user.uid,
      actorEmail: user.email,
      action: 'ADMIN_LOGIN_SUCCESS',
      entityType: 'admin_auth',
      entityId: user.id,
      details: { role: user.role },
    });

    res.json({
      sessionToken: session.cookieValue,
      user: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        fullName: user.fullName,
        mobile: user.mobile,
        companyOrCollege: user.companyOrCollege,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

authRouter.post('/admin-logout', async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[ADMIN_SESSION_COOKIE];
    if (token) {
      await deleteAdminSession(token);
    }
    if (cookies[USER_SESSION_COOKIE]) {
      await deleteAdminSession(cookies[USER_SESSION_COOKIE]);
    }
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      await deleteAdminSession(authHeader.split('Bearer ')[1]);
    }
  } catch {
    // ignore
  }
  const clearOpts = buildCookieOptions(req);
  res.clearCookie(ADMIN_SESSION_COOKIE, clearOpts);
  res.clearCookie(USER_SESSION_COOKIE, clearOpts);
  res.json({ ok: true });
});

authRouter.post('/admin-change-password', requireAuth, requireAdmin(), async (req: AuthRequest, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    const [userRow] = await db.select().from(users).where(eq(users.id, req.dbUser!.id)).limit(1);
    if (!userRow) return res.status(404).json({ error: 'User not found.' });

    if (userRow.passwordHash) {
      if (!verifyPassword(currentPassword, userRow.passwordHash)) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
    } else {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required.' });
      }
      const { createAnonServerSupabaseClient } = await import('../../lib/supabase-admin.ts');
      const anonClient = createAnonServerSupabaseClient();
      if (anonClient) {
        const { error: checkErr } = await anonClient.auth.signInWithPassword({
          email: userRow.email,
          password: currentPassword,
        });
        if (checkErr) {
          return res.status(400).json({ error: 'Current password is incorrect.' });
        }
      }
    }

    await updateUserPassword(userRow.id, newPassword);
    await logAudit({
      actorUid: userRow.uid,
      actorEmail: userRow.email,
      action: 'ADMIN_PASSWORD_CHANGED',
      entityType: 'user',
      entityId: userRow.id,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({ error: 'Failed to update password.' });
  }
});

// Admin Forgot / Reset Password (Email-dispatched short-lived token)
const passwordResetTokens = new Map<string, { userId: number; email: string; expiresAt: number }>();

authRouter.post('/admin-forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Admin email is required.' });

    const [userRow] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!userRow || userRow.role === 'customer' || !userRow.isActive) {
      // Return neutral confirmation to avoid account enumeration
      return res.json({ ok: true, message: 'If an active administrator account matches this email, recovery instructions have been dispatched.' });
    }

    const crypto = await import('crypto');
    const token = crypto.randomBytes(24).toString('hex');
    passwordResetTokens.set(token, {
      userId: userRow.id,
      email: userRow.email,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    const { dispatchLifecycleEmail } = await import('../email.ts');
    const delivery = await dispatchLifecycleEmail({
      userId: userRow.id,
      recipientEmail: userRow.email,
      eventType: 'admin_password_reset',
      vars: {
        customerName: userRow.fullName || userRow.email,
        summary: `Use reset token ${token} (valid for 30 minutes) on the Admin Login Reset form.`,
      },
    });

    await logAudit({
      actorUid: userRow.uid,
      actorEmail: userRow.email,
      action: 'ADMIN_PASSWORD_RESET_REQUESTED',
      entityType: 'user',
      entityId: userRow.id,
      details: { deliveryStatus: delivery.deliveryStatus },
    });

    res.json({
      ok: true,
      deliveryStatus: delivery.deliveryStatus,
      message:
        delivery.deliveryStatus === 'sent'
          ? 'Recovery instructions sent to your administrator email.'
          : 'Contact Customer Care (info@nexustekfusion.in) or your Super Admin for password recovery.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process password reset request.' });
  }
});

authRouter.post('/admin-reset-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const newPassword = String(req.body.newPassword || '');
    if (!token || newPassword.length < 8) {
      return res.status(400).json({ error: 'Valid reset token and new password (min 8 chars) are required.' });
    }

    const entry = passwordResetTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      passwordResetTokens.delete(token);
      return res.status(400).json({ error: 'Reset token is invalid or expired.' });
    }

    await updateUserPassword(entry.userId, newPassword);
    passwordResetTokens.delete(token);

    await logAudit({
      actorUid: String(entry.userId),
      actorEmail: entry.email,
      action: 'ADMIN_PASSWORD_RESET_COMPLETED',
      entityType: 'user',
      entityId: entry.userId,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

