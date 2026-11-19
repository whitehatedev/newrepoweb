import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';
import { getSupabaseClient, getSupabaseOrigin } from '../lib/supabase';
import { DbUser } from '../types/platform';

interface OAuthStatusResponse {
  supabaseConfigured: boolean;
  supabaseUrlOrigin: string | null;
  supabaseCallbackUrl: string | null;
  googleProviderReady?: boolean | null;
  googleProviderError?: string | null;
  recommendedRedirectUrls: string[];
}

const GoogleMark: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const AuthCallbackPage: React.FC = () => {
  const { navigate, startGuestSession, refreshMe, consumePostAuthRedirect, notify } = usePlatform();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing Google sign-in and syncing your customer profile...');

  useEffect(() => {
    let active = true;
    const runCallback = async () => {
      try {
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const oauthErrorParam =
          searchParams.get('error_description') ||
          searchParams.get('error') ||
          hashParams.get('error_description') ||
          hashParams.get('error');

        if (oauthErrorParam) {
          throw new Error(decodeURIComponent(oauthErrorParam.replace(/\+/g, ' ')));
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error(
            'Supabase Auth client is not initialized. Ensure SUPABASE_URL and SUPABASE_ANON_KEY are configured.'
          );
        }

        const code = searchParams.get('code');
        if (code) {
          const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exchErr) throw exchErr;
        }

        const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
        if (sessErr) throw sessErr;

        let accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          await new Promise((r) => setTimeout(r, 450));
          const retry = await supabase.auth.getSession();
          accessToken = retry.data.session?.access_token;
        }

        if (!accessToken) {
          throw new Error(
            'No authenticated OAuth session was returned. Verify that the callback URL is authorized in Supabase Authentication settings.'
          );
        }

        const syncRes = await fetch('/api/auth/sync-profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'same-origin',
        });
        const syncJson = (await syncRes.json().catch(() => ({}))) as {
          user?: DbUser;
          sessionToken?: string;
          error?: string;
        };

        if (!syncRes.ok || !syncJson.user) {
          throw new Error(syncJson.error || 'Failed to synchronize customer profile.');
        }

        if (syncJson.sessionToken) {
          startGuestSession(syncJson.sessionToken, syncJson.user);
        }
        await refreshMe();

        if (!active) return;
        const payload = {
          type: 'OAUTH_AUTH_SUCCESS',
          sessionToken: syncJson.sessionToken || null,
          user: syncJson.user,
        };
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, '*');
        }
        try {
          const bc = new BroadcastChannel('ntf_oauth_channel');
          bc.postMessage(payload);
          bc.close();
        } catch {
          // ignore BroadcastChannel errors
        }

        const destination = consumePostAuthRedirect() || '/my-account';
        setStatus('success');
        setMessage(
          window.opener && !window.opener.closed
            ? `Welcome, ${syncJson.user.fullName || syncJson.user.email}! Returning to NexusTekFusion...`
            : `Welcome, ${syncJson.user.fullName || syncJson.user.email}! Redirecting...`
        );
        notify(`Signed in with Google as ${syncJson.user.fullName || syncJson.user.email}.`, 'success');
        setTimeout(() => {
          if (!active) return;
          if (window.opener && !window.opener.closed) {
            window.close();
          } else {
            navigate(destination);
          }
        }, 400);
      } catch (err: any) {
        if (!active) return;
        setStatus('error');
        setMessage(err?.message || 'Google authentication callback failed.');
      }
    };

    runCallback();
    return () => {
      active = false;
    };
  }, [consumePostAuthRedirect, navigate, notify, refreshMe, startGuestSession]);

  return (
    <div className="max-w-lg mx-auto px-4 py-20">
      <div className="rounded-2xl border border-[#DCEAF5] bg-white p-8 shadow-sm space-y-5 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-10 h-10 text-[#64B5F6] animate-spin mx-auto" />
            <h1 className="font-display text-2xl font-bold text-[#123B5D]">Signing You In</h1>
            <p className="text-sm text-[#263746]">{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="w-10 h-10 text-[#64B5F6] mx-auto" />
            <h1 className="font-display text-2xl font-bold text-[#123B5D]">Authentication Complete</h1>
            <p className="text-sm text-[#263746]">{message}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="w-10 h-10 text-red-600 mx-auto" />
            <h1 className="font-display text-2xl font-bold text-[#123B5D]">Google Sign-In Could Not Complete</h1>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-left text-xs text-red-900 space-y-1.5">
              <div className="font-semibold">Authentication Diagnostic</div>
              <p className="leading-relaxed">{message}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                onClick={() => navigate('/login')}
                className="px-5 py-2.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Return to Login
              </button>
              <button
                onClick={() => navigate('/')}
                className="px-5 py-2.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] text-xs font-semibold rounded-lg transition-colors"
              >
                Back to Home
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const AuthStandaloneView: React.FC<{ initialMode: 'login' | 'register' }> = ({ initialMode }) => {
  const {
    isSignedIn,
    dbUser,
    navigate,
    signInWithEmail,
    registerWithEmail,
    signInWithSupabaseOAuth,
    oauthError,
    oauthRedirectUrl,
    clearOauthError,
    setPostAuthRedirect,
    consumePostAuthRedirect,
  } = usePlatform();

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [companyOrCollege, setCompanyOrCollege] = useState('');
  const [fullAddress, setFullAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [oauthStatus, setOauthStatus] = useState<OAuthStatusResponse | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setFormError('');
    clearOauthError();
  }, [initialMode, clearOauthError]);

  useEffect(() => {
    const redirectParam = new URLSearchParams(window.location.search).get('redirect');
    if (redirectParam && redirectParam.startsWith('/')) {
      setPostAuthRedirect(redirectParam);
    }
    if (initialMode === 'login') {
      fetch('/api/auth/oauth-status?probe=google')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setOauthStatus(d);
        })
        .catch(() => {});
    }
  }, [initialMode, setPostAuthRedirect]);

  if (isSignedIn) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20">
        <div className="rounded-2xl border border-[#DCEAF5] bg-white p-8 text-center space-y-4 shadow-sm">
          <CheckCircle2 className="w-10 h-10 text-[#42A5F5] mx-auto" />
          <h1 className="font-display text-2xl font-bold text-[#123B5D]">
            Signed in as {dbUser?.fullName || dbUser?.email}
          </h1>
          {dbUser?.customerId && (
            <div className="font-mono text-xs text-[#263746]/75">
              Customer ID: <span className="font-bold text-[#123B5D]">{dbUser.customerId}</span>
            </div>
          )}
          <p className="text-sm text-[#263746]">
            Access your orders, project registrations, GST invoices, and saved addresses inside My Account.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <button
              onClick={() => navigate('/my-account')}
              className="px-5 py-2.5 bg-[#42A5F5] hover:bg-[#1E88E5] text-white text-sm font-semibold rounded-lg inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              Open My Account <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate('/register-project')}
              className="px-5 py-2.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              Register a Project
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    try {
      const dest =
        new URLSearchParams(window.location.search).get('redirect') || consumePostAuthRedirect() || '/my-account';
      if (mode === 'login') {
        await signInWithEmail(email.trim(), password);
      } else {
        const cleanName = fullName.trim();
        const cleanEmail = email.trim();
        const cleanMobile = mobile.trim();
        const cleanPin = pinCode.trim();

        if (!cleanName || cleanName.length < 2) {
          throw new Error('Full Name is required (minimum 2 characters).');
        }
        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw new Error('Please enter a valid Email Address.');
        }
        if (!cleanMobile) {
          throw new Error('Phone Number is required.');
        }
        if (cleanPin && !/^[0-9]{4,10}$/.test(cleanPin)) {
          throw new Error('PIN Code must be 4 to 10 numeric digits.');
        }
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters long.');
        }

        await registerWithEmail({
          fullName: cleanName,
          email: cleanEmail,
          mobile: cleanMobile,
          companyOrCollege: companyOrCollege.trim(),
          fullAddress: fullAddress.trim(),
          city: city.trim(),
          state: stateName.trim(),
          pinCode: cleanPin,
          password,
        });
      }
      navigate(dest);
    } catch (err: any) {
      setFormError(err?.message || 'Unable to complete request.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleClick = async () => {
    setFormError('');
    const redirectParam = new URLSearchParams(window.location.search).get('redirect');
    await signInWithSupabaseOAuth(redirectParam || '/my-account');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left Context Panel */}
      <div className="lg:col-span-5 rounded-2xl bg-gradient-to-br from-[#FFFFFF] via-[#F0F8FF] to-[#E3F2FD] text-[#263746] p-8 space-y-5 border border-[#DCEAF5] shadow-sm">
        <div className="text-xs font-mono font-semibold uppercase tracking-wider text-[#1E88E5]">
          NEXUSTEKFUSION CUSTOMER PORTAL
        </div>
        <h1 className="font-display text-3xl font-bold leading-tight text-[#123B5D]">
          {mode === 'login' ? 'Sign In to Your Account' : 'Create Customer Account'}
        </h1>
        <p className="text-sm text-[#263746] leading-relaxed">
          {mode === 'login'
            ? 'Sign in with your registered email and password to track orders, 3D printing jobs, engineering projects, and GST invoices.'
            : 'Register once in under a minute. You receive an instant Customer ID, saved delivery address, and access to hardware orders, 3D printing, and engineering services.'}
        </p>

        <ul className="space-y-3 text-xs text-[#263746] pt-3 border-t border-[#DCEAF5]">
          <li className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#42A5F5] shrink-0 mt-0.5" />
            <span>Automatic Customer ID generation and instant account activation</span>
          </li>
          <li className="flex items-start gap-2.5">
            <MapPin className="w-4 h-4 text-[#42A5F5] shrink-0 mt-0.5" />
            <span>Your address and contact details auto-fill across Store Checkout &amp; Bookings</span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-[#42A5F5] shrink-0 mt-0.5" />
            <span>Direct access to KRASHIVANTRI services, Project Registration &amp; GST Invoices</span>
          </li>
        </ul>

        <div className="pt-2 border-t border-[#DCEAF5] text-xs text-[#263746]/80">
          {mode === 'register' ? (
            <>
              Already registered?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  navigate('/login');
                }}
                className="font-semibold text-[#123B5D] hover:text-[#1E88E5] underline"
              >
                Sign in here
              </button>
            </>
          ) : (
            <>
              New to NexusTekFusion?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  navigate('/register');
                }}
                className="font-semibold text-[#123B5D] hover:text-[#1E88E5] underline"
              >
                Register your account
              </button>
            </>
          )}
        </div>
      </div>

      {/* Right Form Container */}
      <div className="lg:col-span-7 rounded-2xl border border-[#DCEAF5] bg-white p-6 sm:p-8 shadow-sm space-y-5">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F0F8FF] border border-[#DCEAF5]">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              navigate('/login');
            }}
            className={`py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              mode === 'login'
                ? 'bg-[#42A5F5] text-white shadow-sm'
                : 'text-[#263746] hover:text-[#123B5D]'
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              navigate('/register');
            }}
            className={`py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              mode === 'register'
                ? 'bg-[#42A5F5] text-white shadow-sm'
                : 'text-[#263746] hover:text-[#123B5D]'
            }`}
          >
            Customer Registration
          </button>
        </div>

        {(formError || (mode === 'login' && oauthError)) && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
              Please check the details below
            </div>
            <p className="leading-relaxed">{formError || oauthError}</p>
          </div>
        )}

        {/* Google Sign-In shown only on Login tab for legacy/OAuth accounts */}
        {mode === 'login' && (
          <>
            <div className="space-y-2.5">
              {oauthRedirectUrl ? (
                <a
                  href={oauthRedirectUrl}
                  target="_blank"
                  onClick={(e) => {
                    const popup = window.open(
                      oauthRedirectUrl,
                      'ntf_google_oauth',
                      'width=560,height=680,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes'
                    );
                    if (popup) {
                      e.preventDefault();
                    }
                  }}
                  className="w-full py-3 bg-[#42A5F5] hover:bg-[#1E88E5] text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <GoogleMark />
                  Open Google Sign-In Popup
                </a>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGoogleClick}
                  className="w-full py-3 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2.5 disabled:opacity-50 transition-colors"
                >
                  <GoogleMark />
                  Continue with Google
                </button>
              )}

              {oauthStatus && (!oauthStatus.supabaseConfigured || oauthStatus.googleProviderReady === false) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] text-amber-950 leading-relaxed space-y-1">
                  <div>
                    <strong>Google OAuth Note:</strong>{' '}
                    {oauthStatus.googleProviderError
                      ? `Supabase returned "${oauthStatus.googleProviderError}". `
                      : ''}
                    Sign in with your Email &amp; Password below, or configure Google OAuth in Supabase Settings (Callback:{' '}
                    <span className="font-mono break-all">
                      {oauthStatus.supabaseCallbackUrl ||
                        (getSupabaseOrigin() ? `${getSupabaseOrigin()}/auth/v1/callback` : '/auth/v1/callback')}
                    </span>
                    ).
                  </div>
                </div>
              )}
            </div>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#DCEAF5]" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase">
                <span className="bg-white px-2.5 text-[#263746]/60 font-medium">Or sign in with Email</span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="reg-full-name" className="block text-xs font-semibold text-[#123B5D]">
                    Full Name *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#42A5F5] absolute left-3 top-3" />
                    <input
                      id="reg-full-name"
                      required
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Aarav Deshmukh"
                      className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] pl-9 pr-3 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="reg-email" className="block text-xs font-semibold text-[#123B5D]">
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#42A5F5] absolute left-3 top-3" />
                    <input
                      id="reg-email"
                      required
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] pl-9 pr-3 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="reg-mobile" className="block text-xs font-semibold text-[#123B5D]">
                    Phone Number *
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#42A5F5] absolute left-3 top-3" />
                    <input
                      id="reg-mobile"
                      required
                      type="tel"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="10-digit mobile number"
                      className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] pl-9 pr-3 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                    />
                  </div>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="reg-company" className="block text-xs font-semibold text-[#123B5D]">
                    Company / College Name
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-[#42A5F5] absolute left-3 top-3" />
                    <input
                      id="reg-company"
                      type="text"
                      value={companyOrCollege}
                      onChange={(e) => setCompanyOrCollege(e.target.value)}
                      placeholder="Organization, College, or Farm (Optional)"
                      className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] pl-9 pr-3 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                    />
                  </div>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="reg-address" className="block text-xs font-semibold text-[#123B5D]">
                    Full Address
                  </label>
                  <textarea
                    id="reg-address"
                    rows={2}
                    value={fullAddress}
                    onChange={(e) => setFullAddress(e.target.value)}
                    placeholder="House / Flat No., Building, Street, Locality"
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] px-3 py-2 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="reg-city" className="block text-xs font-semibold text-[#123B5D]">
                    City
                  </label>
                  <input
                    id="reg-city"
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Nagpur"
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] px-3 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="reg-state" className="block text-xs font-semibold text-[#123B5D]">
                    State
                  </label>
                  <input
                    id="reg-state"
                    type="text"
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                    placeholder="e.g. Maharashtra"
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] px-3 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="reg-pin" className="block text-xs font-semibold text-[#123B5D]">
                    PIN Code
                  </label>
                  <input
                    id="reg-pin"
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    value={pinCode}
                    onChange={(e) => setPinCode(e.target.value)}
                    placeholder="e.g. 440018"
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] px-3 py-2.5 font-mono text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="reg-password" className="block text-xs font-semibold text-[#123B5D]">
                    Password (min 8 chars) *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#42A5F5] absolute left-3 top-3" />
                    <input
                      id="reg-password"
                      required
                      type={showPassword ? 'text' : 'password'}
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a password"
                      className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] pl-9 pr-10 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-2.5 p-0.5 text-[#263746]/60 hover:text-[#123B5D]"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {mode === 'login' && (
            <>
              <div className="space-y-1">
                <label htmlFor="login-email" className="block text-xs font-semibold text-[#123B5D]">
                  Email Address *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#42A5F5] absolute left-3 top-3" />
                  <input
                    id="login-email"
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] pl-9 pr-3 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="login-password" className="block text-xs font-semibold text-[#123B5D]">
                  Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#42A5F5] absolute left-3 top-3" />
                  <input
                    id="login-password"
                    required
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white text-[#263746] pl-9 pr-10 py-2.5 text-sm focus:border-[#42A5F5] focus:outline-none focus:ring-2 focus:ring-[#64B5F6]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-2.5 p-0.5 text-[#263746]/60 hover:text-[#123B5D]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 bg-[#42A5F5] hover:bg-[#1E88E5] text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
          >
            {busy
              ? mode === 'login'
                ? 'Signing In...'
                : 'Creating Customer Account...'
              : mode === 'login'
                ? 'Sign In'
                : 'Register Account'}
          </button>
        </form>
      </div>
    </div>
  );
};

export const LoginPage: React.FC = () => <AuthStandaloneView initialMode="login" />;
export const RegisterPage: React.FC = () => <AuthStandaloneView initialMode="register" />;
