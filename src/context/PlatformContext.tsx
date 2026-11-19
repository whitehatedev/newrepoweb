import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getSupabaseClient, getSupabaseOrigin, initSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { AuthModal } from '../components/AuthModal';
import {
  applySeoToDocument,
  DynamicSeoOverride,
  resolveRouteSeo,
} from '../lib/seo';
import {
  BlogPost,
  Brand,
  CartItem,
  CaseStudy,
  DbUser,
  PrintingMachine,
  PrintingMaterial,
  Product,
  ProductCategory,
  SiteSettings,
  WebsiteBannerItem,
} from '../types/platform';

const ADMIN_ROLES = new Set([
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

interface ToastItem {
  id: string;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface PublishedPageSummary {
  id: number;
  title: string;
  slug: string;
  status: string;
}

interface RegisterPayload {
  fullName: string;
  email: string;
  mobile: string;
  companyOrCollege: string;
  fullAddress?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  password: string;
}

interface PlatformContextValue {
  path: string;
  navigate: (to: string) => void;
  dbUser: DbUser | null;
  isSignedIn: boolean;
  authLoading: boolean;
  isAdmin: boolean;
  supabaseConfigured: boolean;
  oauthError: string | null;
  oauthRedirectUrl: string | null;
  clearOauthError: () => void;
  setPostAuthRedirect: (dest: string) => void;
  consumePostAuthRedirect: () => string;
  openAuthModal: (mode?: 'login' | 'register') => void;
  signInWithGoogle: () => Promise<void>;
  signInWithSupabaseOAuth: (redirectPath?: string) => Promise<{ ok: boolean; errorMessage?: string; redirectUrl?: string }>;
  signInWithEmail: (email: string, password: string) => Promise<DbUser>;
  registerWithEmail: (payload: RegisterPayload) => Promise<DbUser>;
  signInWithAdminCredentials: (email: string, password: string) => Promise<DbUser>;
  signOut: () => Promise<void>;
  apiFetch: <T = any>(url: string, options?: RequestInit) => Promise<T>;
  getIdToken: () => Promise<string | null>;
  settings: SiteSettings;
  banners: WebsiteBannerItem[];
  previewDraft: boolean;
  categories: ProductCategory[];
  brands: Brand[];
  featuredProducts: Product[];
  bestsellerProducts: Product[];
  newArrivalProducts: Product[];
  blogs: BlogPost[];
  caseStudies: CaseStudy[];
  printingMaterials: PrintingMaterial[];
  printingMachines: PrintingMachine[];
  publishedPages: PublishedPageSummary[];
  razorpayConfigured: boolean;
  razorpayMode: 'live' | 'test' | 'sandbox';
  refreshBootstrap: () => Promise<void>;
  refreshMe: () => Promise<void>;
  cart: CartItem[];
  cartDrawerOpen: boolean;
  setCartDrawerOpen: (open: boolean) => void;
  addToCart: (product: Product, qty?: number, variant?: string, color?: string) => void;
  updateCartQty: (productId: number, variant: string | undefined, color: string | undefined, qty: number) => void;
  removeFromCart: (productId: number, variant?: string, color?: string) => void;
  clearCart: () => void;
  startGuestSession: (token: string, user: DbUser) => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  setDynamicSeo: (override: DynamicSeoOverride | null) => void;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = useState<string>(() => window.location.pathname || '/');
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(() => isSupabaseConfigured());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [oauthRedirectUrl, setOauthRedirectUrl] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const [settings, setSettings] = useState<SiteSettings>({});
  const [banners, setBanners] = useState<WebsiteBannerItem[]>([]);
  const [previewDraft, setPreviewDraft] = useState(false);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [bestsellerProducts, setBestsellerProducts] = useState<Product[]>([]);
  const [newArrivalProducts, setNewArrivalProducts] = useState<Product[]>([]);
  const [blogs, setBlogs] = useState<BlogPost[]>([]);
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
  const [printingMaterials, setPrintingMaterials] = useState<PrintingMaterial[]>([]);
  const [printingMachines, setPrintingMachines] = useState<PrintingMachine[]>([]);
  const [publishedPages, setPublishedPages] = useState<PublishedPageSummary[]>([]);
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);
  const [razorpayMode, setRazorpayMode] = useState<'live' | 'test' | 'sandbox'>('sandbox');
  const [dynamicSeo, setDynamicSeo] = useState<DynamicSeoOverride | null>(null);

  const [cart, setCart] = useState<CartItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('ntf_cart');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const sessionTokenRef = React.useRef<string | null>(
    typeof window !== 'undefined' ? window.sessionStorage.getItem('ntf_session_token') : null
  );

  const cartHydratedForUserRef = React.useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem('ntf_cart', JSON.stringify(cart));
    } catch {
      // ignore storage quota errors
    }
  }, [cart]);

  const persistSessionToken = useCallback((token: string | null) => {
    sessionTokenRef.current = token;
    try {
      if (token) window.sessionStorage.setItem('ntf_session_token', token);
      else window.sessionStorage.removeItem('ntf_session_token');
    } catch {
      // ignore storage errors
    }
  }, []);

  const startGuestSession = useCallback(
    (token: string, user: DbUser) => {
      persistSessionToken(token);
      setDbUser(user);
    },
    [persistSessionToken]
  );

  const notify = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const scrollToHashIfPresent = useCallback((hash: string) => {
    const clean = hash.replace(/^#/, '').trim();
    if (!clean) return;
    setTimeout(() => {
      const el = document.getElementById(clean);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 90);
  }, []);

  const navigate = useCallback(
    (to: string) => {
      const [pathAndQuery, hashPart] = to.split('#');
      const nextPath = (pathAndQuery || '/').split('?')[0] || '/';
      const currentFull = window.location.pathname + window.location.search + window.location.hash;

      if (to !== currentFull) {
        window.history.pushState({}, '', to);
      }
      setDynamicSeo(null);
      setPath(nextPath);

      if (hashPart) {
        scrollToHashIfPresent(hashPart);
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    },
    [scrollToHashIfPresent]
  );

  useEffect(() => {
    if (window.location.hash) {
      scrollToHashIfPresent(window.location.hash);
    }
    const onPop = () => {
      setDynamicSeo(null);
      setPath(window.location.pathname || '/');
      if (window.location.hash) {
        scrollToHashIfPresent(window.location.hash);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [scrollToHashIfPresent]);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (sessionTokenRef.current) {
      return sessionTokenRef.current;
    }
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (session?.access_token) {
          const expiresAtMs = (session.expires_at ?? 0) * 1000;
          if (!expiresAtMs || expiresAtMs > Date.now() + 60_000) {
            return session.access_token;
          }
          const { data: refreshed, error: refErr } = await supabase.auth.refreshSession();
          if (!refErr && refreshed?.session?.access_token) {
            return refreshed.session.access_token;
          }
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        }
      } catch {
        // fall through cleanly
      }
    }
    return null;
  }, []);

  const apiFetch = useCallback(
    async <T = any>(url: string, options: RequestInit = {}): Promise<T> => {
      const buildHeaders = (token: string | null) => {
        const h = new Headers(options.headers || {});
        if (token) {
          h.set('Authorization', `Bearer ${token}`);
        }
        if (!(options.body instanceof FormData) && !h.has('Content-Type')) {
          h.set('Content-Type', 'application/json');
        }
        return h;
      };

      const token = await getIdToken();
      let res = await fetch(url, {
        ...options,
        headers: buildHeaders(token),
        credentials: 'same-origin',
      });

      // If a stale token triggered 401, clear or refresh once cleanly
      if (res.status === 401 && token) {
        if (sessionTokenRef.current === token) {
          persistSessionToken(null);
        }
        const supabase = getSupabaseClient();
        if (supabase) {
          const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: { session: null } }));
          const freshToken = refreshed?.session?.access_token || null;
          if (freshToken && freshToken !== token) {
            res = await fetch(url, {
              ...options,
              headers: buildHeaders(freshToken),
              credentials: 'same-origin',
            });
          } else if (!freshToken) {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          }
        }
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data as T;
    },
    [getIdToken, persistSessionToken]
  );

  const syncMe = useCallback(async () => {
    try {
      const data = await apiFetch<{ authenticated: boolean; user: DbUser | null }>('/api/auth/session');
      if (data.authenticated && data.user) {
        setDbUser(data.user);
      } else {
        if (sessionTokenRef.current) persistSessionToken(null);
        setDbUser(null);
      }
    } catch {
      if (sessionTokenRef.current) persistSessionToken(null);
      setDbUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, [apiFetch, persistSessionToken]);

  const refreshBootstrap = useCallback(async () => {
    try {
      const wantsDraft = new URLSearchParams(window.location.search).get('previewDraft') === 'true';
      const data = await apiFetch(`/api/bootstrap${wantsDraft ? '?previewDraft=true' : ''}`);
      setSettings(data.settings || {});
      setBanners(data.banners || []);
      setPreviewDraft(Boolean(data.previewDraft));
      setCategories(data.categories || []);
      setBrands(data.brands || []);
      setFeaturedProducts(data.featuredProducts || []);
      setBestsellerProducts(data.bestsellerProducts || []);
      setNewArrivalProducts(data.newArrivalProducts || []);
      setBlogs(data.blogs || []);
      setCaseStudies(data.caseStudies || []);
      setPrintingMaterials(data.printingMaterials || []);
      setPrintingMachines(data.printingMachines || []);
      setPublishedPages(data.publishedPages || []);
      setRazorpayConfigured(Boolean(data.razorpayConfigured));
      setRazorpayMode(
        data.razorpayMode === 'live' || data.razorpayMode === 'test' || data.razorpayMode === 'sandbox'
          ? data.razorpayMode
          : data.razorpayConfigured
          ? 'test'
          : 'sandbox'
      );

      if (data.supabaseConfig?.url && data.supabaseConfig?.anonKey) {
        initSupabaseClient(data.supabaseConfig.url, data.supabaseConfig.anonKey);
        setSupabaseConfigured(true);
      }
    } catch (err) {
      console.error('Bootstrap fetch failed:', err);
    }
  }, [apiFetch]);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const resolved = resolveRouteSeo({
      pathname: path,
      search,
      seoConfig: settings.seoConfig,
      companyInfo: settings.companyInfo,
      override: dynamicSeo,
    });
    applySeoToDocument(resolved);
  }, [path, settings.seoConfig, settings.companyInfo, dynamicSeo]);

  useEffect(() => {
    syncMe();
    const supabase = getSupabaseClient();

    let handledOAuthToken = '';
    const applyOAuthSuccess = async (payload: {
      sessionToken?: string | null;
      user?: DbUser | null;
      accessToken?: string;
      refreshToken?: string;
    }) => {
      const tokenKey = payload.sessionToken || payload.accessToken || payload.user?.uid || '';
      if (!tokenKey || handledOAuthToken === tokenKey) return;
      handledOAuthToken = tokenKey;

      if (payload.sessionToken) {
        persistSessionToken(payload.sessionToken);
      }
      if (payload.user) {
        setDbUser(payload.user);
      }
      if (supabase && payload.accessToken && payload.refreshToken) {
        await supabase.auth
          .setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken })
          .catch(() => {});
      }
      setOauthRedirectUrl(null);
      setOauthError(null);
      setAuthModalOpen(false);
      await syncMe();
      await refreshBootstrap();

      if (payload.user) {
        notify(`Signed in with Google as ${payload.user.fullName || payload.user.email}.`, 'success');
      }

      if (
        typeof window !== 'undefined' &&
        (window.location.pathname === '/login' || window.location.pathname === '/register')
      ) {
        let dest = '/my-account';
        try {
          const saved =
            window.sessionStorage.getItem('ntf_post_auth_redirect') ||
            window.localStorage.getItem('ntf_post_auth_redirect');
          window.sessionStorage.removeItem('ntf_post_auth_redirect');
          window.localStorage.removeItem('ntf_post_auth_redirect');
          if (
            saved &&
            saved.startsWith('/') &&
            !saved.startsWith('/auth/callback') &&
            saved !== '/login' &&
            saved !== '/register'
          ) {
            dest = saved;
          }
        } catch {
          // ignore
        }
        navigate(dest);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      const isTrusted =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.includes('localhost') ||
        origin.endsWith('nexustekfusion.in');
      if (!isTrusted) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        void applyOAuthSuccess(event.data);
      }
    };
    window.addEventListener('message', handleMessage);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('ntf_oauth_channel');
      bc.onmessage = (event) => {
        if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
          void applyOAuthSuccess(event.data);
        }
      };
    } catch {
      // BroadcastChannel optional fallback
    }

    let listener: { subscription: { unsubscribe: () => void } } | null = null;
    if (supabase) {
      const sub = supabase.auth.onAuthStateChange(async (event) => {
        if (event === 'SIGNED_OUT') {
          persistSessionToken(null);
          setDbUser(null);
          setAuthLoading(false);
          return;
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          await syncMe();
        }
      });
      listener = sub.data;
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      try {
        bc?.close();
      } catch {
        // ignore
      }
      listener?.subscription.unsubscribe();
    };
  }, [syncMe, supabaseConfigured, persistSessionToken, refreshBootstrap, notify, navigate]);

  useEffect(() => {
    if (!dbUser?.id) {
      cartHydratedForUserRef.current = null;
      return;
    }
    if (cartHydratedForUserRef.current === dbUser.id) return;
    let active = true;
    (async () => {
      try {
        const res = await apiFetch<{ items: CartItem[] }>('/api/cart');
        if (!active) return;
        const remoteItems = Array.isArray(res.items) ? res.items : [];
        if (remoteItems.length > 0) {
          setCart((localItems) => {
            if (localItems.length === 0) return remoteItems;
            const merged = [...localItems];
            for (const r of remoteItems) {
              const idx = merged.findIndex(
                (l) => l.product.id === r.product.id && l.variant === r.variant && l.color === r.color
              );
              if (idx >= 0) {
                merged[idx] = {
                  ...merged[idx],
                  qty: Math.min(merged[idx].product.stockQty || 999, Math.max(merged[idx].qty, r.qty)),
                };
              } else {
                merged.push(r);
              }
            }
            return merged;
          });
        }
        cartHydratedForUserRef.current = dbUser.id;
      } catch {
        cartHydratedForUserRef.current = dbUser.id;
      }
    })();
    return () => {
      active = false;
    };
  }, [dbUser?.id, apiFetch]);

  useEffect(() => {
    if (!dbUser?.id || cartHydratedForUserRef.current !== dbUser.id) return;
    const timer = setTimeout(() => {
      apiFetch('/api/cart', {
        method: 'PUT',
        body: JSON.stringify({
          items: cart.map((i) => ({
            productId: i.product.id,
            qty: i.qty,
            variant: i.variant,
            color: i.color,
          })),
        }),
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [cart, dbUser?.id, apiFetch]);

  const clearOauthError = useCallback(() => setOauthError(null), []);

  const setPostAuthRedirect = useCallback((dest: string) => {
    if (typeof window === 'undefined') return;
    const clean = dest && !dest.startsWith('/auth/callback') && dest !== '/login' && dest !== '/register'
      ? dest
      : '/my-account';
    try {
      window.localStorage.setItem('ntf_post_auth_redirect', clean);
      window.sessionStorage.setItem('ntf_post_auth_redirect', clean);
    } catch {
      // ignore storage errors
    }
  }, []);

  const consumePostAuthRedirect = useCallback((): string => {
    if (typeof window === 'undefined') return '/my-account';
    try {
      const saved =
        window.sessionStorage.getItem('ntf_post_auth_redirect') ||
        window.localStorage.getItem('ntf_post_auth_redirect');
      window.sessionStorage.removeItem('ntf_post_auth_redirect');
      window.localStorage.removeItem('ntf_post_auth_redirect');
      if (saved && saved.startsWith('/') && !saved.startsWith('/auth/callback') && saved !== '/login' && saved !== '/register') {
        return saved;
      }
    } catch {
      // ignore
    }
    return '/my-account';
  }, []);

  const openAuthModal = useCallback((mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setOauthRedirectUrl(null);
    setOauthError(null);
    setAuthModalOpen(true);
  }, []);

  const signInWithSupabaseOAuth = useCallback(
    async (redirectPath?: string): Promise<{ ok: boolean; errorMessage?: string; redirectUrl?: string }> => {
      setOauthError(null);
      setOauthRedirectUrl(null);

      const currentPath =
        typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/my-account';
      const targetDest = redirectPath || currentPath;
      setPostAuthRedirect(targetDest);

      const supabase = getSupabaseClient();
      if (!supabase) {
        const msg =
          'Google Sign-In requires Supabase Auth configuration (SUPABASE_URL and SUPABASE_ANON_KEY) with the Google provider enabled in Supabase Authentication settings.';
        setOauthError(msg);
        notify(msg, 'error');
        return { ok: false, errorMessage: msg };
      }

      const callbackUrl = `${window.location.origin}/auth/callback`;

      try {
        const statusRes = await fetch('/api/auth/oauth-status?probe=google');
        if (statusRes.ok) {
          const statusJson = (await statusRes.json()) as {
            googleProviderReady?: boolean | null;
            googleProviderError?: string | null;
            supabaseCallbackUrl?: string | null;
          };
          if (statusJson.googleProviderReady === false) {
            const rawMsg = statusJson.googleProviderError || 'Unsupported provider: missing OAuth secret';
            const sbOrigin = getSupabaseOrigin();
            const fallbackCb = sbOrigin ? `${sbOrigin}/auth/v1/callback` : '<YOUR_SUPABASE_URL>/auth/v1/callback';
            const friendly = /missing OAuth secret/i.test(rawMsg)
              ? `Google OAuth secret is not configured in Supabase (${rawMsg}). Open Supabase Dashboard -> Authentication -> Sign In / Providers -> Google, paste your Google OAuth Client ID and Client Secret, and save. Authorized redirect URI for Google Cloud Console: ${
                  statusJson.supabaseCallbackUrl || fallbackCb
                }`
              : `Google Sign-In is not ready in Supabase (${rawMsg}). Verify Google Provider settings in Supabase Authentication -> Providers -> Google.`;
            setOauthError(friendly);
            notify(friendly, 'error');
            return { ok: false, errorMessage: friendly };
          }
        }
      } catch {
        // Proceed cleanly if preflight probe could not reach server
      }

      const isIframe = typeof window !== 'undefined' && window.self !== window.top;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl,
          ...(isIframe ? { skipBrowserRedirect: true } : {}),
        },
      });

      if (error) {
        console.error('Google Sign-In Error:', error.message);
        const isDisabledProvider = /unsupported provider|provider is not enabled|validation_failed/i.test(error.message || '');
        const msg = isDisabledProvider
          ? `Google provider is not enabled in Supabase Authentication (400: ${error.message}). Enable Google under Supabase Auth -> Providers -> Google, configure Google OAuth Client ID & Secret, and add ${callbackUrl} to Authorized Redirect URLs.`
          : error.message || 'Google Sign-In failed.';
        setOauthError(msg);
        notify(msg, 'error');
        return { ok: false, errorMessage: msg };
      }

      if (isIframe && data?.url) {
        setOauthRedirectUrl(data.url);
        const popup = window.open(
          data.url,
          'ntf_google_oauth',
          'width=560,height=680,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes'
        );
        if (popup) {
          notify('Complete Google Sign-In in the popup window.', 'info');
        }
        return { ok: true, redirectUrl: data.url };
      }

      return { ok: true, redirectUrl: data?.url };
    },
    [notify, setPostAuthRedirect]
  );

  const signInWithGoogle = useCallback(async () => {
    if (typeof window !== 'undefined') {
      setPostAuthRedirect(`${window.location.pathname}${window.location.search}`);
    }
    openAuthModal('login');
  }, [openAuthModal, setPostAuthRedirect]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await apiFetch<{
          user: DbUser;
          sessionToken?: string;
          supabaseSession?: { access_token: string; refresh_token: string } | null;
        }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        const supabase = getSupabaseClient();
        if (supabase && res.supabaseSession?.access_token && res.supabaseSession?.refresh_token) {
          await supabase.auth.setSession(res.supabaseSession).catch(() => {});
        }
        if (res.sessionToken) persistSessionToken(res.sessionToken);
        setDbUser(res.user);
        await refreshBootstrap();
        notify(`Signed in as ${res.user.fullName || res.user.email}.`, 'success');
        return res.user;
      } catch (localErr: any) {
        const supabase = getSupabaseClient();
        if (supabase) {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (!error && data.session) {
            const me = await apiFetch<{ user: DbUser }>('/api/me');
            setDbUser(me.user);
            await refreshBootstrap();
            notify(`Signed in as ${me.user.fullName || me.user.email}.`, 'success');
            return me.user;
          }
        }
        throw localErr;
      }
    },
    [apiFetch, notify, persistSessionToken, refreshBootstrap]
  );

  const registerWithEmail = useCallback(
    async (payload: RegisterPayload) => {
      const res = await apiFetch<{
        user: DbUser;
        sessionToken?: string;
        supabaseSession?: { access_token: string; refresh_token: string } | null;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const supabase = getSupabaseClient();
      if (supabase && res.supabaseSession?.access_token && res.supabaseSession?.refresh_token) {
        await supabase.auth.setSession(res.supabaseSession).catch(() => {});
      }
      if (res.sessionToken) persistSessionToken(res.sessionToken);
      setDbUser(res.user);
      await refreshBootstrap();
      notify(`Welcome, ${res.user.fullName || res.user.email}!`, 'success');
      return res.user;
    },
    [apiFetch, notify, persistSessionToken, refreshBootstrap]
  );

  const signInWithAdminCredentials = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch<{ user: DbUser; sessionToken?: string }>('/api/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.sessionToken) persistSessionToken(res.sessionToken);
      setDbUser(res.user);
      await refreshBootstrap();
      notify(`Signed in as ${res.user.fullName || res.user.email}.`, 'success');
      return res.user;
    },
    [apiFetch, notify, persistSessionToken, refreshBootstrap]
  );

  const signOut = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    persistSessionToken(null);
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    setDbUser(null);
    notify('Signed out.', 'info');
  }, [apiFetch, notify, persistSessionToken]);

  const addToCart = useCallback(
    (product: Product, qty = 1, variant?: string, color?: string) => {
      if (product.productType === 'quote_only' || product.priceInr <= 0) {
        notify(`"${product.name}" requires a quotation request.`, 'info');
        return;
      }
      setCart((prev) => {
        const idx = prev.findIndex(
          (i) => i.product.id === product.id && i.variant === variant && i.color === color
        );
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], qty: Math.min(product.stockQty, copy[idx].qty + qty) };
          return copy;
        }
        return [...prev, { product, qty: Math.min(product.stockQty, qty), variant, color }];
      });
      setCartDrawerOpen(true);
      notify(`Added "${product.name}" to cart.`, 'success');
    },
    [notify]
  );

  const updateCartQty = useCallback(
    (productId: number, variant: string | undefined, color: string | undefined, qty: number) => {
      setCart((prev) =>
        qty <= 0
          ? prev.filter((i) => !(i.product.id === productId && i.variant === variant && i.color === color))
          : prev.map((i) =>
              i.product.id === productId && i.variant === variant && i.color === color
                ? { ...i, qty: Math.min(i.product.stockQty, qty) }
                : i
            )
      );
    },
    []
  );

  const removeFromCart = useCallback((productId: number, variant?: string, color?: string) => {
    setCart((prev) =>
      prev.filter((i) => !(i.product.id === productId && i.variant === variant && i.color === color))
    );
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const isSignedIn = Boolean(dbUser);
  const isAdmin = Boolean(dbUser && ADMIN_ROLES.has(dbUser.role));

  return (
    <PlatformContext.Provider
      value={{
        path,
        navigate,
        dbUser,
        isSignedIn,
        authLoading,
        isAdmin,
        supabaseConfigured,
        oauthError,
        oauthRedirectUrl,
        clearOauthError,
        setPostAuthRedirect,
        consumePostAuthRedirect,
        openAuthModal,
        signInWithGoogle,
        signInWithSupabaseOAuth,
        signInWithEmail,
        registerWithEmail,
        signInWithAdminCredentials,
        signOut,
        apiFetch,
        getIdToken,
        settings,
        banners,
        previewDraft,
        categories,
        brands,
        featuredProducts,
        bestsellerProducts,
        newArrivalProducts,
        blogs,
        caseStudies,
        printingMaterials,
        printingMachines,
        publishedPages,
        razorpayConfigured,
        razorpayMode,
        refreshBootstrap,
        refreshMe: syncMe,
        cart,
        cartDrawerOpen,
        setCartDrawerOpen,
        addToCart,
        updateCartQty,
        removeFromCart,
        clearCart,
        startGuestSession,
        notify,
        setDynamicSeo,
      }}
    >
      {children}
      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        supabaseConfigured={supabaseConfigured}
        oauthRedirectUrl={oauthRedirectUrl}
        oauthError={oauthError}
        onClose={() => {
          setAuthModalOpen(false);
          setOauthRedirectUrl(null);
          setOauthError(null);
        }}
        onLogin={async (em, pw) => {
          await signInWithEmail(em, pw);
        }}
        onRegister={async (payload) => {
          await registerWithEmail(payload);
        }}
        onSupabaseOAuth={() => signInWithSupabaseOAuth()}
      />
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-transform ${
              t.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : t.tone === 'success'
                ? 'border-[#90CAF9] bg-[#F0F8FF] text-[#123B5D]'
                : 'border-[#DCEAF5] bg-white text-[#263746]'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </PlatformContext.Provider>
  );
};

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used within PlatformProvider');
  return ctx;
}
