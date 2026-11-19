import React, { useEffect, useState } from 'react';
import {
  Award,
  Bell,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  FileCheck2,
  Heart,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  ShoppingBag,
  Sprout,
  Star,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';
import { AddressSelector } from '../components/AddressSelector';
import { RazorpayCheckoutModal } from '../components/RazorpayCheckoutModal';
import {
  downloadClearanceCertificatePdf,
  downloadCompleteProjectInvoicePdf,
  downloadCompletionCertificatePdf,
  downloadInvoicePdf,
  downloadPaymentHistoryStatementPdf,
  downloadPaymentReceiptPdf,
  downloadQuotationPdf,
  downloadWorkOrderPdf,
} from '../lib/pdf';
import { AddressData } from '../types/platform';

type TabKey =
  | 'overview'
  | 'orders'
  | 'tracking'
  | 'invoices'
  | 'addresses'
  | 'cart'
  | 'wishlist'
  | 'reviews'
  | 'enquiries'
  | 'profile'
  | 'projects'
  | 'printing'
  | 'pcb_b2b'
  | 'finance'
  | 'support';

const STORE_ORDER_STAGES = [
  'Order Placed',
  'Payment Confirmed',
  'Order Processing',
  'Quality Inspection',
  'Ready for Dispatch',
  'Shipped',
  'Out for Delivery',
  'Delivered',
] as const;

function resolveStoreOrderStageIndex(status: string): number {
  const s = String(status || '').trim().toLowerCase();
  if (!s || s === 'pending payment' || s === 'order placed') return 0;
  if (s === 'completed') return 7;
  const idx = STORE_ORDER_TRACKING_LIST.findIndex((st) => st.toLowerCase() === s);
  return idx >= 0 ? idx : 0;
}
const STORE_ORDER_TRACKING_LIST = [...STORE_ORDER_STAGES];

const PROJECT_STAGES = [
  'Submitted – Under Review',
  'Additional Information Required',
  'Under Technical Evaluation',
  'Quotation Prepared',
  'Quotation Approved by Customer',
  'Advance Payment Pending',
  'Advance Payment Received',
  'Project Development Started',
  'In Progress',
  'Testing and Quality Assurance',
  'Project Completed',
  'Final Payment Pending',
  'Ready for Handover',
  'Delivered / Handed Over',
  'Closed',
] as const;

function resolveProjectStageIndex(enquiryStatus: string, projectStatus?: string): number {
  const s = (projectStatus || enquiryStatus || 'Submitted – Under Review').toLowerCase();
  if (s === 'closed') return 14;
  if (s.includes('delivered / handed over') || s === 'delivered' || s === 'handover acknowledged') return 13;
  if (s.includes('ready for handover') || s.includes('cleared') || s === 'dispatched' || s === 'ready for delivery') return 12;
  if (s.includes('final payment pending') || s.includes('awaiting final payment')) return 11;
  if (s === 'project completed' || s === 'completed') return 10;
  if (s.includes('testing and quality assurance') || s === 'testing') return 9;
  if (s === 'in progress') return 8;
  if (s.includes('project development started') || s === 'project started') return 7;
  if (s.includes('advance payment received') || s.includes('advance paid') || s.includes('payment confirmed')) return 6;
  if (s.includes('advance payment pending') || s.includes('awaiting payment')) return 5;
  if (s.includes('quotation approved by customer') || s === 'accepted') return 4;
  if (s.includes('quotation prepared') || s === 'quotation sent') return 3;
  if (s.includes('under technical evaluation') || s === 'technical review') return 2;
  if (s.includes('additional information required') || s.includes('clarification')) return 1;
  return 0;
}

export const CustomerDashboardPage: React.FC<{ initialTab?: TabKey }> = ({ initialTab }) => {
  const {
    dbUser,
    isSignedIn,
    openAuthModal,
    signInWithSupabaseOAuth,
    oauthError,
    oauthRedirectUrl,
    signOut,
    apiFetch,
    notify,
    navigate,
    settings,
    isAdmin,
    getIdToken,
    cart,
    updateCartQty,
    removeFromCart,
  } = usePlatform();
  const [tab, setTab] = useState<TabKey>(initialTab || 'overview');

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [profileForm, setProfileForm] = useState({ fullName: '', mobile: '', companyOrCollege: '' });
  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [enqReplyMap, setEnqReplyMap] = useState<Record<number, string>>({});
  const [enqReplyFiles, setEnqReplyFiles] = useState<Record<number, File[]>>({});
  const [enqExpandedDetails, setEnqExpandedDetails] = useState<Record<number, boolean>>({});
  const [modifyQuoteId, setModifyQuoteId] = useState<number | null>(null);
  const [modifyFeedback, setModifyFeedback] = useState('');
  const [orderDetailModal, setOrderDetailModal] = useState<any | null>(null);
  const [cancelOrderModal, setCancelOrderModal] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('Changed mind / ordering different configuration');
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<Record<number, { rating: number; comment: string; busy?: boolean }>>({});
  const [payModal, setPayModal] = useState<{
    open: boolean;
    entityType: 'store_order' | 'printing_order' | 'project_quotation' | 'pcb_enquiry' | 'b2b_enquiry';
    entityId: number;
    paymentMode?: 'advance' | 'full' | 'balance';
    title: string;
    amountInr: number;
  } | null>(null);

  const loadDashboard = async () => {
    if (!isSignedIn) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/me');
      setData(res);
      setProfileForm({
        fullName: res.user?.fullName || '',
        mobile: res.user?.mobile || '',
        companyOrCollege: res.user?.companyOrCollege || '',
      });
    } catch (err: any) {
      notify(err?.message || 'Failed to load account.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [isSignedIn]);

  if (!isSignedIn) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-5">
        <div className="text-xs font-mono font-semibold uppercase tracking-wider text-[#42A5F5]">
          Customer Account Portal
        </div>
        <h1 className="font-display text-3xl font-bold text-[#123B5D]">Sign In to Your Account</h1>
        <p className="text-sm text-[#263746]">
          Manage your Store orders, custom 3D prints, project registrations, GST invoices, and saved delivery addresses.
        </p>

        {oauthError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-left text-xs text-red-900">
            {oauthError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          {oauthRedirectUrl ? (
            <a
              href={oauthRedirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Open Google Sign-In in New Tab
            </a>
          ) : (
            <button
              type="button"
              onClick={() => signInWithSupabaseOAuth('/my-account')}
              className="px-5 py-3 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] text-sm font-semibold rounded-lg transition-colors"
            >
              Continue with Google
            </button>
          )}
          <button
            type="button"
            onClick={() => openAuthModal('login')}
            className="px-5 py-3 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Sign In with Email
          </button>
          <button
            type="button"
            onClick={() => navigate('/register')}
            className="px-5 py-3 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] text-sm font-semibold rounded-lg transition-colors"
          >
            Register
          </button>
        </div>
      </div>
    );
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/me', { method: 'PUT', body: JSON.stringify(profileForm) });
      notify('Profile updated.', 'success');
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Update failed.', 'error');
    }
  };

  const respondQuotation = async (
    quotationId: number,
    action: 'accept' | 'modify' | 'reject',
    customFeedback?: string
  ) => {
    try {
      await apiFetch(`/api/quotations/${quotationId}/respond`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          feedback: customFeedback || (action === 'modify' ? 'Requested revision' : ''),
        }),
      });
      setModifyQuoteId(null);
      setModifyFeedback('');
      notify(
        `Quotation ${
          action === 'accept' ? 'accepted' : action === 'modify' ? 'marked for modification' : 'rejected'
        }.`,
        'success'
      );
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Failed to update quotation.', 'error');
    }
  };

  const deleteAddress = async (id: number) => {
    try {
      await apiFetch(`/api/addresses/${id}`, { method: 'DELETE' });
      notify('Address removed.', 'info');
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Failed to delete address.', 'error');
    }
  };

  const sendTicketReply = async (ticketId: number) => {
    const msg = replyText[ticketId];
    if (!msg?.trim()) return;
    try {
      await apiFetch(`/api/support-tickets/${ticketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: msg }),
      });
      setReplyText((prev) => ({ ...prev, [ticketId]: '' }));
      notify('Reply sent.', 'success');
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Failed to reply.', 'error');
    }
  };

  const downloadPrivateHandover = async (projectId: number, docId: number, token: string, fileName: string) => {
    try {
      const idToken = await getIdToken();
      const headers: Record<string, string> = {};
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
      const resp = await fetch(
        `/api/projects/${projectId}/handover-documents/${docId}/download?token=${encodeURIComponent(token)}`,
        { headers, credentials: 'same-origin' }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Download blocked or expired.' }));
        throw new Error(err.error || 'Download failed.');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Failed to download deliverable.', 'error');
    }
  };

  const downloadOriginal3DFile = async (po: any) => {
    try {
      const idToken = await getIdToken();
      const headers: Record<string, string> = {};
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
      const resp = await fetch(`/api/3d-printing/orders/${po.id}/download-original?format=json`, {
        headers,
        credentials: 'same-origin',
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Original 3D file download is locked until full payment is verified.' }));
        throw new Error(err.error || 'Download locked.');
      }
      const ctype = resp.headers.get('content-type') || '';
      let blob: Blob;
      if (ctype.includes('application/json')) {
        const payload = await resp.json();
        if (!payload?.signedUrl) throw new Error('Failed to obtain signed download URL.');
        const fileResp = await fetch(payload.signedUrl);
        if (!fileResp.ok) throw new Error('Failed to fetch signed 3D file.');
        blob = await fileResp.blob();
      } else {
        blob = await resp.blob();
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = po.fileName || `3d-model-${po.orderNumber}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Downloaded original design file: ${po.fileName}`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Original 3D file download locked.', 'error');
    }
  };

  const downloadProtectedFile = async (storagePath: string, fileName: string) => {
    try {
      const idToken = await getIdToken();
      const headers: Record<string, string> = {};
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
      const resp = await fetch(`/api/files/download?path=${encodeURIComponent(storagePath)}`, {
        headers,
        credentials: 'same-origin',
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Download failed.' }));
        throw new Error(err.error || 'Download failed.');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      notify(err?.message || 'Failed to download file.', 'error');
    }
  };

  const sendEnquiryMessage = async (enquiryId: number) => {
    const message = (enqReplyMap[enquiryId] || '').trim();
    const attached = enqReplyFiles[enquiryId] || [];
    if (!message && attached.length === 0) {
      notify('Enter a response message or attach supporting documents.', 'error');
      return;
    }
    try {
      const fd = new FormData();
      fd.append('message', message || 'Additional documents uploaded.');
      attached.forEach((f) => fd.append('attachments', f));
      await apiFetch(`/api/project-enquiries/${enquiryId}/messages`, {
        method: 'POST',
        body: fd,
      });
      setEnqReplyMap((prev) => ({ ...prev, [enquiryId]: '' }));
      setEnqReplyFiles((prev) => ({ ...prev, [enquiryId]: [] }));
      notify('Response and documents submitted to engineering team.', 'success');
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Failed to submit response.', 'error');
    }
  };

  const acknowledgeHandover = async (projectId: number) => {
    try {
      const res = await apiFetch<{ completionCertificateNumber: string }>(
        `/api/projects/${projectId}/acknowledge-handover`,
        { method: 'POST' }
      );
      notify(`Handover acknowledged. Completion Certificate ${res.completionCertificateNumber} generated.`, 'success');
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Failed to acknowledge handover.', 'error');
    }
  };

  const handleCancelStoreOrder = async () => {
    if (!cancelOrderModal) return;
    setCancellingOrder(true);
    try {
      await apiFetch(`/api/store-orders/${cancelOrderModal.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason.trim() || 'Cancelled by customer' }),
      });
      notify(`Order ${cancelOrderModal.orderNumber} cancelled.`, 'info');
      setCancelOrderModal(null);
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Unable to cancel order.', 'error');
    } finally {
      setCancellingOrder(false);
    }
  };

  const handleSubmitProductReview = async (productId: number) => {
    const draft = reviewDrafts[productId] || { rating: 5, comment: '' };
    if (!draft.comment?.trim()) {
      notify('Please enter your product review comment.', 'error');
      return;
    }
    setReviewDrafts((prev) => ({ ...prev, [productId]: { ...draft, busy: true } }));
    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ productId, rating: draft.rating || 5, comment: draft.comment.trim() }),
      });
      notify('Verified purchase review published.', 'success');
      setReviewDrafts((prev) => ({ ...prev, [productId]: { rating: 5, comment: '', busy: false } }));
      loadDashboard();
    } catch (err: any) {
      notify(err?.message || 'Failed to publish review.', 'error');
      setReviewDrafts((prev) => ({ ...prev, [productId]: { ...draft, busy: false } }));
    }
  };

  const unreadCount = (data?.notifications || []).filter((n: any) => !n.isRead).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCEAF5] pb-6">
        <div>
          <div className="text-xs font-semibold text-[#42A5F5]">Customer My Account Portal</div>
          <h1 className="font-display text-3xl font-bold text-[#123B5D]">
            {dbUser?.fullName || dbUser?.email || 'Account'}
          </h1>
          <div className="text-xs text-[#263746]/70 font-mono">
            {dbUser?.email} · Role: {dbUser?.role || 'customer'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              onClick={() => navigate('/admin/dashboard')}
              className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors"
            >
              Open Admin Console
            </button>
          )}
          <button
            onClick={signOut}
            className="px-4 py-2 border border-[#90CAF9] bg-white text-[#123B5D] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 hover:bg-[#F0F8FF] whitespace-nowrap shrink-0 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-[#F0F8FF] rounded-xl border border-[#DCEAF5]">
        {[
          ['overview', 'Overview'],
          ['orders', 'My Orders'],
          ['tracking', 'Track Orders'],
          ['invoices', 'My Invoices'],
          ['addresses', 'My Addresses'],
          ['cart', `My Cart${cart.length > 0 ? ` (${cart.length})` : ''}`],
          ['wishlist', 'Wishlist'],
          ['reviews', 'My Reviews'],
          ['enquiries', 'Enquiries'],
          ['profile', 'Profile Settings'],
          ['projects', 'My Projects'],
          ['printing', '3D Printing'],
          ['pcb_b2b', 'PCB & B2B'],
          ['support', 'Support'],
        ].map(([k, label]) => {
          const isActive = tab === k || (k === 'invoices' && tab === 'finance');
          return (
            <button
              key={k}
              onClick={() => setTab(k as TabKey)}
              className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                isActive ? 'bg-[#64B5F6] text-white shadow-sm' : 'text-[#263746] hover:bg-white hover:text-[#123B5D]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading || !data ? (
        <div className="py-12 text-sm text-[#263746]/70">Loading your dashboard...</div>
      ) : (
        <div className="space-y-8">
          {/* OVERVIEW */}
          {tab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                  ['Store Orders', data.storeOrders.length, 'orders'],
                  ['Drone Enquiries', (data.productEnquiries || []).length, 'enquiries'],
                  ['Project Enquiries', data.projectEnquiries.length, 'projects'],
                  ['Active Projects', data.projects.length, 'projects'],
                  ['3D Print Orders', data.printingOrders.length, 'printing'],
                ].map(([label, val, targetTab]) => (
                  <button
                    key={String(label)}
                    type="button"
                    onClick={() => setTab(targetTab as TabKey)}
                    className="text-left rounded-xl border border-[#DCEAF5] bg-white p-5 space-y-1 hover:border-[#64B5F6] hover:bg-[#F0F8FF]/40 transition-colors shadow-sm"
                  >
                    <div className="text-xs text-[#263746]/70">{label}</div>
                    <div className="font-mono text-2xl font-bold text-[#123B5D] tabular-nums">{val}</div>
                  </button>
                ))}
              </div>

              {/* KRASHIVANTRI Spraying & Pilot Portal Shortcuts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-[#DCEAF5] bg-[#F0F8FF]/60 p-5 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[#123B5D] flex items-center gap-1.5">
                      <Sprout className="w-4 h-4 text-[#42A5F5]" /> KRASHIVANTRI Farmer Portal
                    </div>
                    <div className="text-xs text-[#263746]/80">
                      {data.farmerProfile
                        ? `${data.farmerProfile.farmerCode} · KYC: ${data.farmerProfile.kycStatus}`
                        : 'Register farm plots, draw boundaries & book spraying drones.'}
                    </div>
                  </div>
                  <button
                    onClick={() => navigate('/krashivantri/farmer-portal')}
                    className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors"
                  >
                    Open Farmer Portal
                  </button>
                </div>

                <div className="rounded-xl border border-[#DCEAF5] bg-[#F0F8FF]/60 p-5 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[#123B5D] flex items-center gap-1.5">
                      <Navigation className="w-4 h-4 text-[#42A5F5]" /> KRASHIVANTRI Drone Pilot Portal
                    </div>
                    <div className="text-xs text-[#263746]/80">
                      {data.pilotProfile
                        ? `${data.pilotProfile.pilotCode} · KYC: ${data.pilotProfile.kycStatus}`
                        : 'Enroll DGCA RPC credentials, go online & manage spraying ops.'}
                    </div>
                  </div>
                  <button
                    onClick={() => navigate('/krashivantri/pilot-portal')}
                    className="px-4 py-2 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors"
                  >
                    Open Pilot Portal
                  </button>
                </div>
              </div>

              {(data.droneRepairs || []).length > 0 && (
                <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-3 shadow-sm">
                  <h2 className="font-display font-bold text-[#123B5D]">
                    Drone Repair &amp; Diagnostics Bookings ({data.droneRepairs.length})
                  </h2>
                  <div className="divide-y divide-[#DCEAF5] text-xs">
                    {data.droneRepairs.map((dr: any) => (
                      <div key={dr.id} className="py-2.5 flex flex-wrap justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-[#123B5D]">{dr.referenceNumber}</span> · {dr.droneBrandModel} ({dr.serviceMode})
                          <div className="text-[#263746]/70">{dr.problemDescription}</div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="font-semibold text-[#42A5F5]">{dr.status}</div>
                          {dr.repairQuotationInr && <div>Quote: ₹{dr.repairQuotationInr.toLocaleString('en-IN')}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-bold text-[#123B5D] flex items-center gap-2">
                    <Bell className="w-4 h-4 text-[#42A5F5]" />
                    Notifications &amp; Activity ({unreadCount} unread)
                  </h2>
                </div>
                {data.notifications.length === 0 ? (
                  <p className="text-sm text-[#263746]/70">No recent notifications.</p>
                ) : (
                  <div className="divide-y divide-[#DCEAF5]">
                    {data.notifications.map((n: any) => (
                      <div key={n.id} className="py-3 flex items-start justify-between gap-4 text-sm">
                        <div>
                          <div className="font-semibold text-[#123B5D]">{n.title}</div>
                          <div className="text-[#263746]/80 text-xs">{n.message}</div>
                        </div>
                        <span className="text-xs text-[#263746]/60 font-mono shrink-0">
                          {new Date(n.createdAt).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PROFILE SETTINGS */}
          {tab === 'profile' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <form
                onSubmit={handleSaveProfile}
                className="lg:col-span-6 rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4 h-fit shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display font-bold text-lg text-[#123B5D]">Profile Settings</h2>
                  {(!dbUser?.emailVerified || !dbUser?.phoneVerified) && (
                    <button
                      type="button"
                      onClick={() => openAuthModal('register')}
                      className="text-[11px] font-semibold text-[#42A5F5] hover:underline"
                    >
                      Complete OTP Verification
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[#123B5D]">Full Name</label>
                  <input
                    placeholder="Full Name"
                    value={profileForm.fullName}
                    onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white px-3.5 py-2.5 text-sm text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[#123B5D]">Mobile Number</label>
                  <input
                    placeholder="Mobile Number"
                    value={profileForm.mobile}
                    onChange={(e) => setProfileForm({ ...profileForm, mobile: e.target.value })}
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white px-3.5 py-2.5 text-sm text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[#123B5D]">Organization / Farm / College Name</label>
                  <input
                    placeholder="Company, FPO, or College Name"
                    value={profileForm.companyOrCollege}
                    onChange={(e) => setProfileForm({ ...profileForm, companyOrCollege: e.target.value })}
                    className="w-full rounded-lg border border-[#DCEAF5] bg-white px-3.5 py-2.5 text-sm text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                  />
                </div>
                <button type="submit" className="px-5 py-2.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors">
                  Save Profile Settings
                </button>
              </form>

              <div className="lg:col-span-6 rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4 h-fit shadow-sm">
                <h2 className="font-display font-bold text-lg text-[#123B5D]">Account &amp; Delivery Summary</h2>
                <div className="text-sm text-[#263746] space-y-2">
                  <div>Email: <span className="font-mono text-[#123B5D]">{dbUser?.email}</span></div>
                  <div>Saved Addresses: <span className="font-mono font-bold text-[#123B5D]">{(data.addresses || []).length}</span></div>
                  <div>Verified Orders: <span className="font-mono font-bold text-[#123B5D]">{(data.storeOrders || []).filter((o: any) => o.paymentStatus === 'paid').length}</span></div>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('addresses')}
                  className="px-4 py-2 border border-[#90CAF9] bg-white rounded-lg text-xs font-semibold text-[#123B5D] hover:bg-[#F0F8FF] transition-colors"
                >
                  Manage Delivery &amp; Billing Addresses
                </button>
              </div>
            </div>
          )}

          {/* MY ADDRESSES */}
          {tab === 'addresses' && (
            <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-6 shadow-sm">
              <AddressSelector
                title="Saved Billing & Delivery Addresses"
                addresses={data.addresses}
                selected={null}
                onSelect={() => {}}
                onAddressSaved={loadDashboard}
              />
              {data.addresses.length > 0 && (
                <div className="divide-y divide-[#DCEAF5] text-xs">
                  {data.addresses.map((a: AddressData & { id: number }) => (
                    <div key={a.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-[#123B5D]">
                          {a.fullName} · {a.label} {a.isDefault ? '(Default)' : ''}
                        </div>
                        <div className="text-[#263746]/80">
                          {a.houseFlat}, {a.streetArea}, {a.city}, {a.district ? `${a.district}, ` : ''}{a.state} — {a.pinCode} · Mobile: {a.mobile}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteAddress(a.id)}
                        className="text-[#263746]/50 hover:text-red-600 p-1.5 transition-colors"
                        aria-label="Delete address"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MY PROJECTS */}
          {tab === 'projects' && (
            <div className="space-y-8">
              {/* Active Projects, Progress Updates, Milestones, Final Balance & Handover */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-xl font-bold text-[#123B5D]">
                    Active Projects, Engineering Progress &amp; Handover
                  </h2>
                  <button
                    onClick={() => navigate('/register-project')}
                    className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Register New Project
                  </button>
                </div>

                {data.projects.length === 0 ? (
                  <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 text-sm text-[#263746]/70">
                    No active development projects yet. Projects activate automatically once a published quotation is approved and 50% advance payment is verified.
                  </div>
                ) : (
                  data.projects.map((p: any) => {
                    const workOrder = (data.workOrders || []).find((w: any) => w.projectId === p.id);
                    const clearanceCert = (data.clearanceCertificates || []).find((c: any) => c.projectId === p.id);
                    const handoverDocs = (data.handoverDocuments || []).filter((d: any) => d.projectId === p.id);
                    const deliveries = (data.deliveryRecords || []).filter((d: any) => d.projectId === p.id);
                    const payMilestones = (data.paymentMilestones || []).filter(
                      (m: any) => m.projectId === p.id || (p.quotationId && m.quotationId === p.quotationId)
                    );
                    const linkedEnq = (data.projectEnquiries || []).find((e: any) => e.id === p.enquiryId);
                    const linkedQuot = (data.quotations || []).find((q: any) => q.id === p.quotationId);
                    const projReceipts = (data.receipts || []).filter(
                      (r: any) => r.entityType === 'project_quotation' && r.entityId === p.quotationId
                    );
                    const customerEmail = dbUser?.email || '';
                    const progressPct = Math.min(100, Math.max(0, Number(p.progressPercent || 0)));

                    return (
                      <div key={p.id} className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-5 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCEAF5] pb-3">
                          <div>
                            <div className="font-mono text-xs text-[#42A5F5] font-semibold">
                              {p.projectCode} {linkedEnq ? `· Reg ${linkedEnq.enquiryNumber}` : ''}
                            </div>
                            <h3 className="font-display text-lg font-bold text-[#123B5D]">{p.title}</h3>
                          </div>
                          <div className="text-right text-xs">
                            <div className="font-semibold text-[#123B5D]">
                              Status: {p.status} · Engineer: {p.assignedEngineer}
                            </div>
                            <div className="font-mono text-[#263746]/80 tabular-nums mt-0.5">
                              Total ₹{Number(p.totalAmountInr || 0).toLocaleString('en-IN')} · Paid ₹
                              {Number(p.paidAmountInr || 0).toLocaleString('en-IN')} · Balance ₹
                              {Number(p.balanceAmountInr || 0).toLocaleString('en-IN')}
                            </div>
                          </div>
                        </div>

                        {/* Overall Development Progress Bar */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs font-mono">
                            <span className="text-[#263746]/70">Overall Project Progress</span>
                            <span className="font-bold text-[#42A5F5]">{progressPct}%</span>
                          </div>
                          <div className="w-full h-2.5 bg-[#F0F8FF] rounded-full overflow-hidden border border-[#DCEAF5]">
                            <div
                              className="h-full bg-[#64B5F6] transition-all duration-300"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>

                        {/* Balance Due Banner */}
                        {Number(p.balanceAmountInr || 0) > 0 && p.quotationId && (
                          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-xs text-amber-950 space-y-0.5">
                              <div className="font-bold">
                                Remaining 50% Final Balance Pending: ₹{Number(p.balanceAmountInr).toLocaleString('en-IN')}
                              </div>
                              <div>
                                {p.handoverExceptionAuthorized
                                  ? 'Exception authorized by Super Admin. Complete remaining balance per agreed schedule.'
                                  : 'Complete remaining 50% final payment to unlock gated digital deliverable downloads, physical dispatch, and Payment Clearance Certificate.'}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setPayModal({
                                  open: true,
                                  entityType: 'project_quotation',
                                  entityId: p.quotationId,
                                  paymentMode: 'balance',
                                  title: `Final Balance — ${p.projectCode}`,
                                  amountInr: p.balanceAmountInr,
                                })
                              }
                              className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
                            >
                              <CreditCard className="w-3.5 h-3.5" /> Pay Remaining Balance ₹
                              {Number(p.balanceAmountInr).toLocaleString('en-IN')}
                            </button>
                          </div>
                        )}

                        {/* Payment Milestones */}
                        {payMilestones.length > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {payMilestones.map((m: any) => (
                              <div key={m.id} className="rounded-lg border border-[#DCEAF5] bg-[#F0F8FF] p-3 text-xs flex justify-between items-center">
                                <div>
                                  <div className="font-semibold text-[#123B5D]">{m.stageName} ({m.percent}%)</div>
                                  <div className="text-[11px] text-[#263746]/70">{m.dueTrigger}</div>
                                </div>
                                <div className="text-right font-mono tabular-nums">
                                  <div className="font-bold text-[#123B5D]">₹{m.amountInr.toLocaleString('en-IN')}</div>
                                  <div className={m.status === 'paid' ? 'text-[#42A5F5] font-semibold' : 'text-amber-700 font-semibold'}>
                                    {m.status}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Structured Engineering Progress Updates Timeline */}
                        {(p.updates || []).length > 0 && (
                          <div className="rounded-xl border border-[#DCEAF5] bg-[#F0F8FF] p-4 space-y-3 text-xs">
                            <div className="font-semibold text-[#123B5D]">
                              Engineering Progress Updates ({p.updates.length})
                            </div>
                            <div className="space-y-3">
                              {[...p.updates].reverse().map((upd: any, uIdx: number) => (
                                <div key={upd.id || uIdx} className="rounded-lg border border-[#DCEAF5] bg-white p-3.5 space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      {upd.category && (
                                        <span className="inline-block px-2 py-0.5 rounded bg-[#F0F8FF] border border-[#90CAF9] text-[#123B5D] font-semibold text-[10px] mr-2">
                                          {upd.category}
                                        </span>
                                      )}
                                      <span className="font-semibold text-[#123B5D]">{upd.title || 'Engineering Update'}</span>
                                    </div>
                                    <div className="font-mono text-[11px] text-[#263746]/70">
                                      {typeof upd.progressPercentage === 'number' && (
                                        <span className="text-[#42A5F5] font-bold mr-2">{upd.progressPercentage}%</span>
                                      )}
                                      {upd.timestamp ? new Date(upd.timestamp).toLocaleString('en-IN') : ''}
                                    </div>
                                  </div>
                                  <p className="text-[#263746] leading-relaxed">{upd.description || upd.note}</p>
                                  {upd.adminComments && (
                                    <div className="text-[11px] text-[#263746]/80 bg-[#F0F8FF] rounded p-2 border border-[#DCEAF5]">
                                      <strong className="text-[#123B5D]">Engineer Remarks:</strong> {upd.adminComments}
                                    </div>
                                  )}
                                  {((upd.photos && upd.photos.length > 0) ||
                                    (upd.videos && upd.videos.length > 0) ||
                                    (upd.reports && upd.reports.length > 0)) && (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                      {[...(upd.photos || []), ...(upd.videos || []), ...(upd.reports || [])].map(
                                        (mf: any, mfIdx: number) => (
                                          <button
                                            key={mfIdx}
                                            type="button"
                                            onClick={() => downloadProtectedFile(mf.storagePath, mf.originalName)}
                                            className="px-2.5 py-1 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] rounded text-[#123B5D] font-medium inline-flex items-center gap-1 transition-colors"
                                          >
                                            <Download className="w-3 h-3 text-[#42A5F5]" /> {mf.originalName}
                                          </button>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Completion Proof Files */}
                        {(p.completionProof || []).length > 0 && (
                          <div className="rounded-lg border border-[#90CAF9] bg-[#F0F8FF] p-3.5 text-xs space-y-2">
                            <div className="font-semibold text-[#123B5D]">Completion Verification &amp; Proof</div>
                            <div className="flex flex-wrap gap-2">
                              {p.completionProof.map((cp: any, cpIdx: number) => (
                                <button
                                  key={cpIdx}
                                  type="button"
                                  onClick={() => downloadProtectedFile(cp.storagePath, cp.originalName)}
                                  className="px-2.5 py-1 bg-white border border-[#90CAF9] hover:bg-[#F0F8FF] rounded text-[#123B5D] font-medium inline-flex items-center gap-1 transition-colors"
                                >
                                  <Download className="w-3 h-3 text-[#42A5F5]" /> {cp.originalName}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Engineering Milestones */}
                        {(p.milestones || []).length > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {p.milestones.map((m: any) => (
                              <div key={m.id} className="rounded-lg border border-[#DCEAF5] bg-white p-3 text-xs space-y-1">
                                <div className="font-semibold text-[#123B5D]">{m.title}</div>
                                <div className="text-[#42A5F5] font-medium">{m.status}</div>
                                {m.notes && <div className="text-[#263746]/80">{m.notes}</div>}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Official Project PDFs, Complete Invoice & Payment History Statement */}
                        <div className="flex flex-wrap gap-2">
                          {workOrder && (
                            <button
                              type="button"
                              onClick={() =>
                                downloadWorkOrderPdf({
                                  workOrderNumber: workOrder.workOrderNumber,
                                  projectCode: p.projectCode,
                                  projectTitle: p.title,
                                  assignedEngineer: workOrder.assignedEngineer || p.assignedEngineer,
                                  estimatedCompletionDate: workOrder.estimatedCompletionDate,
                                  scopeSummary: workOrder.scopeSummary,
                                  issuedAt: workOrder.issuedAt,
                                  customerEmail,
                                })
                              }
                              className="px-3 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5 text-[#42A5F5]" /> Work Order ({workOrder.workOrderNumber})
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              downloadCompleteProjectInvoicePdf({
                                projectCode: p.projectCode,
                                enquiryNumber: linkedEnq?.enquiryNumber || p.projectCode,
                                projectTitle: p.title,
                                customerName: linkedEnq?.customerName || dbUser?.fullName || customerEmail,
                                customerEmail,
                                customerPhone: linkedEnq?.customerPhone || dbUser?.mobile,
                                totalAmountInr: Number(p.totalAmountInr || linkedQuot?.totalAmountInr || 0),
                                gstInr: Number(linkedQuot?.gstInr || 0),
                                paidAmountInr: Number(p.paidAmountInr || 0),
                                balanceAmountInr: Number(p.balanceAmountInr || 0),
                                costCategories: linkedQuot?.costCategories,
                                receipts: projReceipts,
                                gstin:
                                  settings.projectSettings?.enableGstTax && settings.companyInfo?.gstin
                                    ? settings.companyInfo.gstin
                                    : undefined,
                              })
                            }
                            className="px-3 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5 text-[#42A5F5]" /> Complete Project Invoice PDF
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              downloadPaymentHistoryStatementPdf({
                                projectCode: p.projectCode,
                                enquiryNumber: linkedEnq?.enquiryNumber || p.projectCode,
                                projectTitle: p.title,
                                customerName: linkedEnq?.customerName || dbUser?.fullName || customerEmail,
                                customerEmail,
                                totalAmountInr: Number(p.totalAmountInr || 0),
                                paidAmountInr: Number(p.paidAmountInr || 0),
                                balanceAmountInr: Number(p.balanceAmountInr || 0),
                                receipts: projReceipts,
                                gstin:
                                  settings.projectSettings?.enableGstTax && settings.companyInfo?.gstin
                                    ? settings.companyInfo.gstin
                                    : undefined,
                              })
                            }
                            className="px-3 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5 text-[#42A5F5]" /> Payment History Statement PDF
                          </button>

                          {clearanceCert && (
                            <button
                              type="button"
                              onClick={() =>
                                downloadClearanceCertificatePdf({
                                  certificateNumber: clearanceCert.certificateNumber,
                                  projectCode: p.projectCode,
                                  projectTitle: p.title,
                                  totalAmountInr: clearanceCert.totalAmountInr,
                                  advancePaidInr: clearanceCert.advancePaidInr,
                                  finalPaidInr: clearanceCert.finalPaidInr,
                                  balanceInr: clearanceCert.balanceInr,
                                  paymentRefs: clearanceCert.paymentRefs || [],
                                  issuedAt: clearanceCert.issuedAt,
                                  issuedBy: clearanceCert.issuedBy,
                                  customerEmail,
                                })
                              }
                              className="px-3 py-1.5 border border-[#90CAF9] bg-[#F0F8FF] text-[#123B5D] rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#E3F2FD] transition-colors"
                            >
                              <Award className="w-3.5 h-3.5 text-[#42A5F5]" /> Clearance Cert ({clearanceCert.certificateNumber})
                            </button>
                          )}

                          {p.completionCertificateNumber && (
                            <button
                              type="button"
                              onClick={() =>
                                downloadCompletionCertificatePdf({
                                  certificateNumber: p.completionCertificateNumber,
                                  projectCode: p.projectCode,
                                  projectTitle: p.title,
                                  acknowledgedBy: p.customerAcknowledgedBy || customerEmail,
                                  acknowledgedAt: p.customerAcknowledgedAt || new Date().toISOString(),
                                  assignedEngineer: p.assignedEngineer || 'NexusTekFusion Engineering',
                                })
                              }
                              className="px-3 py-1.5 border border-[#90CAF9] bg-[#F0F8FF] text-[#123B5D] rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#E3F2FD] transition-colors"
                            >
                              <FileCheck2 className="w-3.5 h-3.5 text-[#42A5F5]" /> Completion Cert ({p.completionCertificateNumber})
                            </button>
                          )}
                        </div>

                        {/* Gated Deliverables Vault */}
                        {handoverDocs.length > 0 && (
                          <div className="rounded-lg border border-[#DCEAF5] bg-[#F0F8FF] p-4 space-y-2 text-xs">
                            <div className="font-semibold text-[#123B5D] flex items-center gap-1.5">
                              {p.handoverUnlocked ? (
                                <CheckCircle2 className="w-4 h-4 text-[#42A5F5]" />
                              ) : (
                                <Lock className="w-4 h-4 text-amber-700" />
                              )}
                              Project Deliverable Vault ({handoverDocs.length} files)
                            </div>
                            <div className="divide-y divide-[#DCEAF5]">
                              {handoverDocs.map((doc: any) => (
                                <div key={doc.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="font-semibold text-[#123B5D]">
                                      {doc.title} ({doc.versionLabel})
                                    </div>
                                    <div className="font-mono text-[11px] text-[#263746]/70">
                                      {doc.fileName} · Category: {doc.category}
                                    </div>
                                  </div>
                                  {doc.unlocked && doc.downloadToken ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        downloadPrivateHandover(p.id, doc.id, doc.downloadToken, doc.fileName)
                                      }
                                      className="px-3 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded font-semibold inline-flex items-center gap-1 transition-colors"
                                    >
                                      <Download className="w-3.5 h-3.5" /> Download
                                    </button>
                                  ) : (
                                    <span className="font-mono text-[11px] text-amber-800 inline-flex items-center gap-1">
                                      <Lock className="w-3 h-3" /> Locked until remaining 50% balance cleared
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Courier Dispatch & Handover Acknowledgment */}
                        {(deliveries.length > 0 || p.trackingId) && (
                          <div className="text-xs text-[#263746] font-mono flex items-center gap-2">
                            <Truck className="w-4 h-4 text-[#42A5F5] shrink-0" />
                            <span>
                              Dispatch:{' '}
                              {deliveries[0]
                                ? `${deliveries[0].courierName} · AWB ${deliveries[0].trackingNumber} (${deliveries[0].dispatchDate})`
                                : `${p.trackingCourier} · ${p.trackingId}`}
                            </span>
                          </div>
                        )}

                        {p.handoverUnlocked && !p.customerAcknowledgedAt && (
                          <button
                            type="button"
                            onClick={() => acknowledgeHandover(p.id)}
                            className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
                          >
                            <CheckCircle2 className="w-4 h-4" /> Acknowledge Deliverable Receipt &amp; Issue Completion Certificate
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Registered Projects, Clarifications & Published Quotations */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold text-[#123B5D]">
                    Registered Projects &amp; Published Quotations
                  </h2>
                  <button
                    onClick={() => navigate('/register-project')}
                    className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Register Your Project
                  </button>
                </div>

                {(data.projectEnquiries || []).length === 0 ? (
                  <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 text-sm text-[#263746]/70">
                    You have not registered any engineering projects yet. Click &ldquo;Register Your Project&rdquo; to get started.
                  </div>
                ) : (
                  data.projectEnquiries.map((enq: any) => {
                    const enqQuotes = (data.quotations || []).filter(
                      (q: any) => q.enquiryId === enq.id && q.status !== 'Draft'
                    );
                    const linkedProject = (data.projects || []).find((p: any) => p.enquiryId === enq.id);
                    const enqMessages = (data.projectMessages || []).filter((m: any) => m.enquiryId === enq.id);
                    const stageIdx = resolveProjectStageIndex(enq.status, linkedProject?.status);
                    const showDetails = Boolean(enqExpandedDetails[enq.id]);

                    return (
                      <div key={enq.id} className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-5 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCEAF5] pb-3">
                          <div>
                            <div className="font-mono text-xs text-[#263746]/70">
                              {enq.enquiryNumber} · {enq.projectCategory} · {enq.projectType}
                              {linkedProject ? ` · Active Project ${linkedProject.projectCode}` : ''}
                            </div>
                            <h3 className="font-display text-lg font-bold text-[#123B5D]">{enq.projectTitle}</h3>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#123B5D] px-2.5 py-1 rounded bg-[#F0F8FF] border border-[#90CAF9]">
                              {linkedProject?.status || enq.status}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setEnqExpandedDetails((prev) => ({ ...prev, [enq.id]: !prev[enq.id] }))
                              }
                              className="px-3 py-1 border border-[#90CAF9] bg-white text-[#123B5D] rounded text-xs font-semibold hover:bg-[#F0F8FF] transition-colors"
                            >
                              {showDetails ? 'Hide Details' : 'Full Submission'}
                            </button>
                          </div>
                        </div>

                        {/* 15-Stage Visual Progress Tracker */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[11px] font-mono text-[#263746]/70">
                            <span>15-Stage Project Lifecycle Tracker</span>
                            <span>
                              Stage {stageIdx + 1} / {PROJECT_STAGES.length}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
                            {PROJECT_STAGES.map((stageName, idx) => {
                              const reached = idx <= stageIdx;
                              const isCurrent = idx === stageIdx;
                              return (
                                <div
                                  key={stageName}
                                  className={`px-2 py-1.5 rounded-lg border text-[10px] leading-tight ${
                                    isCurrent
                                      ? 'border-[#64B5F6] bg-[#F0F8FF] text-[#123B5D] font-semibold'
                                      : reached
                                      ? 'border-[#90CAF9] bg-[#F0F8FF]/50 text-[#123B5D]'
                                      : 'border-[#DCEAF5] bg-white text-[#263746]/45'
                                  }`}
                                >
                                  <div className="font-mono text-[9px]">{idx + 1}.</div>
                                  <div className="truncate" title={stageName}>
                                    {stageName}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <p className="text-sm text-[#263746]/80">{enq.projectDescription}</p>

                        {/* Expandable Full Submission Summary & Uploaded Documents */}
                        {showDetails && (
                          <div className="rounded-lg border border-[#DCEAF5] bg-[#F0F8FF] p-4 text-xs space-y-3 text-[#263746]">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <strong className="text-[#123B5D]">Customer:</strong> {enq.customerName} ({enq.customerCategory || 'Customer'}) · {enq.customerPhone}
                                {enq.whatsappNumber ? ` · WA: ${enq.whatsappNumber}` : ''}
                              </div>
                              <div>
                                <strong className="text-[#123B5D]">Location &amp; Org:</strong> {enq.city || ''} {enq.state || ''} · {enq.companyOrCollege || '—'} ({enq.courseDepartment || '—'})
                              </div>
                              <div>
                                <strong className="text-[#123B5D]">Domain &amp; Complexity:</strong> {enq.engineeringDomain || enq.engineeringBranch} · {enq.projectComplexity || 'Intermediate'}
                              </div>
                              <div>
                                <strong className="text-[#123B5D]">Budget &amp; Target Date:</strong> {enq.estimatedBudget || 'Open'} · {enq.targetCompletionDate || 'Flexible'}
                              </div>
                            </div>
                            {enq.problemStatement && (
                              <div><strong className="text-[#123B5D]">Problem Statement:</strong> {enq.problemStatement}</div>
                            )}
                            {enq.projectObjective && (
                              <div><strong className="text-[#123B5D]">Objective:</strong> {enq.projectObjective}</div>
                            )}
                            {enq.expectedFunctionality && (
                              <div><strong className="text-[#123B5D]">Expected Working:</strong> {enq.expectedFunctionality}</div>
                            )}
                            {enq.requiredFeatures && (
                              <div><strong className="text-[#123B5D]">Required Features:</strong> {enq.requiredFeatures}</div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              {enq.hardwareRequirements && <div><strong className="text-[#123B5D]">Hardware:</strong> {enq.hardwareRequirements}</div>}
                              {enq.softwareRequirements && <div><strong className="text-[#123B5D]">Software:</strong> {enq.softwareRequirements}</div>}
                              {enq.componentsRequired && <div><strong className="text-[#123B5D]">Components:</strong> {enq.componentsRequired}</div>}
                            </div>
                            <div>
                              <strong className="text-[#123B5D]">Deliverables Needed:</strong> Physical Prototype ({enq.flags?.needPrototype ? 'Yes' : 'No'}) · Web/Mobile App ({enq.flags?.needMobileWebApp ? 'Yes' : 'No'}) · Report/Docs ({enq.flags?.needDocumentation ? 'Yes' : 'No'})
                            </div>
                            {enq.attachments?.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {enq.attachments.map((att: any, aIdx: number) => (
                                  <button
                                    key={aIdx}
                                    type="button"
                                    onClick={() => downloadProtectedFile(att.storagePath, att.originalName)}
                                    className="px-2.5 py-1 border border-[#90CAF9] bg-white rounded text-[#123B5D] hover:bg-[#F0F8FF] inline-flex items-center gap-1"
                                  >
                                    <Download className="w-3 h-3 text-[#42A5F5]" /> {att.originalName}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {enq.rejectionReason && (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
                            <span className="font-semibold">Proposal Declined Reason:</span> {enq.rejectionReason}
                          </div>
                        )}
                        {enq.clarificationNotes && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
                            <span className="font-semibold">Additional Information Requested by Engineering Team:</span>{' '}
                            {enq.clarificationNotes}
                          </div>
                        )}

                        {/* Customer-Admin Clarifications & Additional Document Upload Thread */}
                        {(enq.status === 'Additional Information Required' ||
                          enqMessages.length > 0 ||
                          showDetails) && (
                          <div className="rounded-lg border border-[#DCEAF5] bg-[#F0F8FF] p-4 space-y-3 text-xs">
                            <div className="font-semibold text-[#123B5D]">
                              Engineering Communication &amp; Additional Documents ({enqMessages.length})
                            </div>
                            {enqMessages.length > 0 && (
                              <div className="space-y-2 max-h-60 overflow-y-auto">
                                {enqMessages.map((msg: any) => (
                                  <div
                                    key={msg.id}
                                    className={`p-2.5 rounded-lg border ${
                                      msg.senderRole === 'admin'
                                        ? 'bg-amber-50 border-amber-200'
                                        : 'bg-white border-[#DCEAF5]'
                                    }`}
                                  >
                                    <div className="flex justify-between text-[11px] text-[#263746]/70">
                                      <span className="font-semibold text-[#123B5D]">
                                        {msg.senderRole === 'admin' ? 'NexusTekFusion Engineering' : msg.senderName}
                                      </span>
                                      <span className="font-mono">
                                        {new Date(msg.createdAt).toLocaleString('en-IN')}
                                      </span>
                                    </div>
                                    <p className="text-[#263746] mt-1">{msg.message}</p>
                                    {msg.attachments?.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                                        {msg.attachments.map((att: any, idx: number) => (
                                          <button
                                            key={idx}
                                            type="button"
                                            onClick={() => downloadProtectedFile(att.storagePath, att.originalName)}
                                            className="px-2 py-0.5 bg-white border border-[#90CAF9] rounded text-[#123B5D] inline-flex items-center gap-1"
                                          >
                                            <Download className="w-3 h-3 text-[#42A5F5]" /> {att.originalName}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex flex-col sm:flex-row gap-2 pt-1">
                              <input
                                placeholder="Reply with clarification details or technical notes..."
                                value={enqReplyMap[enq.id] || ''}
                                onChange={(e) =>
                                  setEnqReplyMap((prev) => ({ ...prev, [enq.id]: e.target.value }))
                                }
                                className="flex-1 rounded-lg border border-[#DCEAF5] bg-white px-3 py-2 text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                              />
                              <label className="px-3 py-2 border border-[#90CAF9] bg-white rounded-lg cursor-pointer hover:bg-[#F0F8FF] text-[#123B5D] font-medium inline-flex items-center gap-1 transition-colors">
                                <span>
                                  {(enqReplyFiles[enq.id] || []).length > 0
                                    ? `${enqReplyFiles[enq.id].length} file(s)`
                                    : 'Attach Docs'}
                                </span>
                                <input
                                  type="file"
                                  multiple
                                  onChange={(e) =>
                                    setEnqReplyFiles((prev) => ({
                                      ...prev,
                                      [enq.id]: Array.from(e.target.files || []),
                                    }))
                                  }
                                  className="hidden"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => sendEnquiryMessage(enq.id)}
                                className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold transition-colors"
                              >
                                Send Reply
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Published Quotations Only (Draft hidden by server & client) */}
                        {enqQuotes.map((q: any) => {
                          const paidSoFar = Number(q.paidAmountInr || 0);
                          const remainingInr = Math.max(0, q.totalAmountInr - paidSoFar);
                          const canPayAdvanceOrFull =
                            q.status === 'Accepted' || q.status === 'Quotation Approved by Customer';

                          return (
                            <div key={q.id} className="rounded-lg border border-[#DCEAF5] bg-[#F0F8FF] p-4 space-y-3 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-[#123B5D]">
                                  {q.quotationNumber ? `${q.quotationNumber} · ` : ''}Quotation Rev #{q.revisionNumber} · Status: {q.status} · Payment: {q.paymentStatus || 'pending'}
                                </span>
                                <span className="font-mono font-bold text-[#123B5D] tabular-nums">
                                  Total ₹{q.totalAmountInr.toLocaleString('en-IN')} · Paid ₹{paidSoFar.toLocaleString('en-IN')} · Balance ₹{remainingInr.toLocaleString('en-IN')}
                                </span>
                              </div>
                              {(q.estimatedDuration || q.estimatedDeliveryDate || q.paymentTerms) && (
                                <div className="text-[11px] text-[#263746]/70 flex flex-wrap gap-4">
                                  {q.estimatedDuration && <span>Duration: {q.estimatedDuration}</span>}
                                  {q.estimatedDeliveryDate && <span>Est. Delivery: {q.estimatedDeliveryDate}</span>}
                                  {q.validityDays && <span>Validity: {q.validityDays} days</span>}
                                  {q.paymentTerms && <span>Terms: {q.paymentTerms}</span>}
                                </div>
                              )}

                              {/* Cost Breakdown Summary Chips */}
                              {q.costCategories && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-white rounded-lg border border-[#DCEAF5] p-3">
                                  {[
                                    ['Hardware', q.costCategories.hardware],
                                    ['Software Dev', q.costCategories.software],
                                    ['Components', q.costCategories.sensors],
                                    ['PCB / Mfg', q.costCategories.pcb],
                                    ['3D Print / Mech', (q.costCategories.printing3d || 0) + (q.costCategories.mechanical || 0)],
                                    ['Engineering & Dev', q.costCategories.development],
                                    ['Testing & QA', q.costCategories.testing],
                                    ['Documentation', q.costCategories.documentation],
                                    ['Delivery & Other', (q.costCategories.delivery || 0) + (q.costCategories.other || 0)],
                                    ['GST / Taxes', q.gstInr],
                                  ]
                                    .filter(([, v]) => Number(v || 0) > 0)
                                    .map(([lbl, v]) => (
                                      <div key={String(lbl)} className="flex justify-between gap-2 font-mono">
                                        <span className="text-[#263746]/70">{lbl}:</span>
                                        <span className="font-semibold text-[#123B5D]">
                                          ₹{Number(v).toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() =>
                                    downloadQuotationPdf({
                                      enquiryNumber: enq.enquiryNumber,
                                      projectTitle: enq.projectTitle,
                                      customerName: enq.customerName,
                                      customerEmail: enq.customerEmail,
                                      customerPhone: enq.customerPhone,
                                      customerCategory: enq.customerCategory,
                                      quotation: q,
                                      gstin: settings.companyInfo?.gstin,
                                    })
                                  }
                                  className="px-3 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                                >
                                  <Download className="w-3.5 h-3.5" /> Quotation PDF
                                </button>

                                {q.status === 'Sent' && (
                                  <>
                                    <button
                                      onClick={() => respondQuotation(q.id, 'accept')}
                                      className="px-3 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold transition-colors"
                                    >
                                      Accept &amp; Approve Quotation
                                    </button>
                                    <button
                                      onClick={() => {
                                        setModifyQuoteId(modifyQuoteId === q.id ? null : q.id);
                                        setModifyFeedback('');
                                      }}
                                      className="px-3 py-1.5 border border-amber-500 text-amber-800 bg-amber-50 rounded-lg font-semibold"
                                    >
                                      Request Modification
                                    </button>
                                    <button
                                      onClick={() => respondQuotation(q.id, 'reject')}
                                      className="px-3 py-1.5 border border-red-300 text-red-700 rounded-lg font-semibold"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}

                                {canPayAdvanceOrFull && remainingInr > 0 && (
                                  <>
                                    {paidSoFar === 0 ? (
                                      <>
                                        <button
                                          onClick={() =>
                                            setPayModal({
                                              open: true,
                                              entityType: 'project_quotation',
                                              entityId: q.id,
                                              paymentMode: 'advance',
                                              title: `50% Advance Payment — ${enq.enquiryNumber}`,
                                              amountInr: q.advanceAmountInr,
                                            })
                                          }
                                          className="px-4 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                                        >
                                          <CreditCard className="w-3.5 h-3.5" /> Pay 50% Advance ₹
                                          {q.advanceAmountInr.toLocaleString('en-IN')}
                                        </button>
                                        {q.advanceAmountInr < q.totalAmountInr && (
                                          <button
                                            onClick={() =>
                                              setPayModal({
                                                open: true,
                                                entityType: 'project_quotation',
                                                entityId: q.id,
                                                paymentMode: 'full',
                                                title: `Full 100% Payment — ${enq.enquiryNumber}`,
                                                amountInr: q.totalAmountInr,
                                              })
                                            }
                                            className="px-4 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                                          >
                                            <CreditCard className="w-3.5 h-3.5" /> Pay Full ₹
                                            {q.totalAmountInr.toLocaleString('en-IN')}
                                          </button>
                                        )}
                                      </>
                                    ) : (
                                      <button
                                        onClick={() =>
                                          setPayModal({
                                            open: true,
                                            entityType: 'project_quotation',
                                            entityId: q.id,
                                            paymentMode: 'balance',
                                            title: `Remaining 50% Final Payment — ${enq.enquiryNumber}`,
                                            amountInr: remainingInr,
                                          })
                                        }
                                        className="px-4 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                                      >
                                        <CreditCard className="w-3.5 h-3.5" /> Pay Remaining Balance ₹
                                        {remainingInr.toLocaleString('en-IN')}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>

                              {modifyQuoteId === q.id && (
                                <div className="flex flex-wrap gap-2 pt-2 border-t border-[#DCEAF5]">
                                  <input
                                    placeholder="Describe required changes (components, budget, timeline)..."
                                    value={modifyFeedback}
                                    onChange={(e) => setModifyFeedback(e.target.value)}
                                    className="flex-1 min-w-[220px] rounded-lg border border-[#DCEAF5] bg-white px-3 py-1.5 text-xs text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => respondQuotation(q.id, 'modify', modifyFeedback)}
                                    className="px-3 py-1.5 bg-amber-700 text-white rounded-lg font-semibold"
                                  >
                                    Send Revision Request
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* 3D PRINTING ORDERS */}
          {tab === 'printing' && (
            <div className="space-y-4">
              {data.printingOrders.length === 0 ? (
                <div className="rounded-xl border border-[#DCEAF5] bg-white p-8 text-center space-y-3">
                  <p className="text-sm text-[#263746]/70">No 3D printing orders yet.</p>
                  <button
                    onClick={() => navigate('/services/3d-printing')}
                    className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Upload a 3D Model
                  </button>
                </div>
              ) : (
                data.printingOrders.map((po: any) => {
                  const cp = po.customerParameters || {};
                  const dims = po.boundingBoxMm || cp.dimensionsMm || null;
                  const isPaidUnlocked = Boolean(po.downloadUnlocked);
                  return (
                    <div key={po.id} className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#DCEAF5]/60 pb-3">
                        <div>
                          <div className="font-mono text-xs text-[#263746]/70">
                            {po.orderNumber} · {po.fileFormat || 'CAD'} · {po.fileVersion || 'v1'} ·{' '}
                            {po.fileSizeBytes ? `${(po.fileSizeBytes / 1024).toFixed(1)} KB` : 'Saved'} ·{' '}
                            Uploaded {new Date(po.uploadedAt || po.createdAt).toLocaleString('en-IN')}
                          </div>
                          <div className="font-display font-bold text-[#123B5D] text-lg">{po.fileName}</div>
                          <div className="text-xs text-[#263746]/80">
                            {po.technology} ({po.printerName || cp.printerName || 'Industrial Printer'}) · {po.materialName} ({po.colorName})
                          </div>
                        </div>
                        <div className="text-right font-mono space-y-1">
                          <div className="font-bold text-[#123B5D] text-base">
                            ₹{Number(po.totalInr || 0).toLocaleString('en-IN')}
                          </div>
                          <div className="text-xs font-semibold text-[#123B5D]">
                            Order: <span className="text-[#42A5F5]">{po.orderStatus}</span>
                          </div>
                          <div className="text-xs">
                            Payment:{' '}
                            <span
                              className={
                                po.paymentStatus === 'paid' && (!po.refundStatus || po.refundStatus === 'none')
                                  ? 'text-[#123B5D] font-semibold'
                                  : po.paymentStatus === 'refunded' || po.refundStatus === 'refunded'
                                  ? 'text-red-700 font-semibold'
                                  : 'text-amber-700 font-semibold'
                              }
                            >
                              {po.paymentStatus}
                              {po.refundStatus && po.refundStatus !== 'none' ? ` (${po.refundStatus})` : ''}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-[#F0F8FF] border border-[#DCEAF5] p-3.5 text-xs">
                        <div>
                          <span className="text-[#263746]/70 block">Layer / Infill</span>
                          <span className="font-mono font-semibold text-[#123B5D]">
                            {po.layerHeightMm} mm · {po.infillPercent}%
                          </span>
                        </div>
                        <div>
                          <span className="text-[#263746]/70 block">Walls / Nozzle / Speed</span>
                          <span className="font-mono font-semibold text-[#123B5D]">
                            {po.wallCount ?? cp.wallCount ?? 3} walls · {po.nozzleDiameterMm ?? cp.nozzleDiameterMm ?? 0.4}mm · {po.printSpeedMmS ?? cp.printSpeedMmS ?? 60}mm/s
                          </span>
                        </div>
                        <div>
                          <span className="text-[#263746]/70 block">Orientation / Scale</span>
                          <span className="font-mono font-semibold text-[#123B5D]">
                            {po.buildOrientation || cp.buildOrientation || 'Auto Optimal'} ({po.scalePercent ?? cp.scalePercent ?? 100}%)
                          </span>
                        </div>
                        <div>
                          <span className="text-[#263746]/70 block">Qty / Support / Finishing</span>
                          <span className="font-mono font-semibold text-[#123B5D]">
                            Qty {po.quantity} · {po.supportEnabled ? 'Supports On' : 'No Supports'} · {po.finishingOption || 'Standard'}
                          </span>
                        </div>
                        {dims && (
                          <div className="col-span-2">
                            <span className="text-[#263746]/70 block">Dimensions &amp; Estimates</span>
                            <span className="font-mono font-semibold text-[#123B5D]">
                              {dims.x} × {dims.y} × {dims.z} mm · {po.volumeCm3} cm³ · {po.estimatedWeightG} g
                            </span>
                          </div>
                        )}
                        {po.specialInstructions && (
                          <div className="col-span-2">
                            <span className="text-[#263746]/70 block">Special Notes</span>
                            <span className="text-[#263746]">{po.specialInstructions}</span>
                          </div>
                        )}
                      </div>

                      {po.trackingId && (
                        <div className="text-xs font-mono text-[#263746]">
                          Tracking: {po.trackingCourier} ({po.trackingId})
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {po.paymentStatus !== 'paid' && !po.pricingBreakdown?.technicalReviewRequired && (
                          <button
                            onClick={() =>
                              setPayModal({
                                open: true,
                                entityType: 'printing_order',
                                entityId: po.id,
                                title: `3D Print ${po.orderNumber}`,
                                amountInr: po.totalInr,
                              })
                            }
                            className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
                          >
                            <CreditCard className="w-3.5 h-3.5" /> Pay Now
                          </button>
                        )}

                        {isPaidUnlocked ? (
                          <button
                            type="button"
                            onClick={() => downloadOriginal3DFile(po)}
                            className="px-4 py-2 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" /> Download Original 3D File
                          </button>
                        ) : (
                          <div
                            title={po.downloadLockReason || 'Locked until full payment is verified'}
                            className="px-3.5 py-2 rounded-lg border border-[#DCEAF5] bg-[#F0F8FF] text-[#263746]/70 text-xs inline-flex items-center gap-1.5"
                          >
                            <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>
                              Original 3D File Locked ({po.downloadLockReason || 'Awaiting verified payment'})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* MY ORDERS */}
          {tab === 'orders' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#DCEAF5] bg-[#F0F8FF] px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[#263746]">
                  Manage your hardware and KRASHIVANTRI drone orders, view details, cancel prior to dispatch, or download paid GST Tax Invoices.
                </span>
                <a
                  href={`mailto:${settings.companyInfo?.customerCareEmail || 'info@nexustekfusion.in'}?subject=${encodeURIComponent('Store Order Customer Care Support')}`}
                  className="inline-flex items-center gap-1.5 font-mono font-semibold text-[#42A5F5] hover:text-[#123B5D] hover:underline"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Customer Care ({settings.companyInfo?.customerCareEmail || 'info@nexustekfusion.in'})
                </a>
              </div>

              {data.storeOrders.length === 0 ? (
                <div className="rounded-xl border border-[#DCEAF5] bg-white p-10 text-center space-y-3">
                  <p className="text-sm text-[#263746]/70">No store orders placed yet.</p>
                  <button
                    type="button"
                    onClick={() => navigate('/store')}
                    className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Browse Store
                  </button>
                </div>
              ) : (
                data.storeOrders.map((ord: any) => {
                  const ordInvoice = (data.invoices || []).find(
                    (inv: any) => inv.entityType === 'store_order' && inv.entityId === ord.id
                  );
                  const canCancel = ['Order Placed', 'Pending Payment', 'Payment Confirmed', 'Order Processing'].includes(
                    ord.orderStatus
                  );
                  return (
                    <div key={ord.id} className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCEAF5]/60 pb-3">
                        <div className="space-y-0.5">
                          <div className="font-mono text-sm font-bold text-[#123B5D]">{ord.orderNumber}</div>
                          <div className="text-xs text-[#263746]/70">
                            Placed {new Date(ord.createdAt).toLocaleString('en-IN')}
                            {ord.shippingAddress?.city ? ` · To ${ord.shippingAddress.city}, ${ord.shippingAddress.pinCode || ''}` : ''}
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <div className="font-bold text-base text-[#123B5D]">₹{Number(ord.totalInr || 0).toLocaleString('en-IN')}</div>
                          <div className="text-xs font-semibold">
                            <span className={ord.orderStatus === 'Cancelled' ? 'text-red-700' : 'text-[#42A5F5]'}>
                              {ord.orderStatus}
                            </span>
                            {' · '}
                            <span className={ord.paymentStatus === 'paid' ? 'text-[#123B5D]' : 'text-amber-700'}>
                              {ord.paymentStatus}
                            </span>
                            {ord.refundStatus && ord.refundStatus !== 'none' ? ` · Refund: ${ord.refundStatus}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="divide-y divide-[#DCEAF5]/60">
                        {(ord.items || []).map((it: any, idx: number) => (
                          <div key={idx} className="py-2.5 flex items-center gap-3 text-xs">
                            <img
                              src={it.imageUrl || '/assets/aistudio/image_1a5ac752.png'}
                              alt={it.name}
                              referrerPolicy="no-referrer"
                              className="w-14 h-12 rounded-lg object-cover bg-[#F0F8FF] shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-[#123B5D] truncate">{it.name}</div>
                              <div className="text-[#263746]/70 font-mono">
                                {it.sku || 'SKU'} · Qty {it.qty}
                                {it.variant ? ` · ${it.variant}` : ''}
                              </div>
                            </div>
                            <div className="font-mono font-semibold text-[#123B5D] tabular-nums">
                              ₹{Number(it.lineTotalInr || 0).toLocaleString('en-IN')}
                            </div>
                          </div>
                        ))}
                      </div>

                      {ord.trackingId && (
                        <div className="text-xs font-mono text-[#263746] bg-[#F0F8FF] rounded-lg px-3 py-2 border border-[#DCEAF5] flex flex-wrap items-center justify-between gap-2">
                          <span>
                            Courier: {ord.trackingCourier || 'Assigned'} · AWB: {ord.trackingId}
                          </span>
                          {ord.trackingUrl && (
                            <a
                              href={ord.trackingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#42A5F5] hover:text-[#123B5D] hover:underline inline-flex items-center gap-1"
                            >
                              Track Shipment <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setOrderDetailModal(ord)}
                          className="px-3.5 py-2 border border-[#DCEAF5] hover:bg-[#F0F8FF] text-[#263746] text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors"
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => setTab('tracking')}
                          className="px-3.5 py-2 border border-[#90CAF9] bg-[#F0F8FF] hover:bg-[#DCEAF5]/60 text-[#123B5D] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                        >
                          <Truck className="w-3.5 h-3.5 text-[#42A5F5]" /> Track Order
                        </button>
                        {ord.paymentStatus !== 'paid' && ord.orderStatus !== 'Cancelled' && (
                          <button
                            type="button"
                            onClick={() =>
                              setPayModal({
                                open: true,
                                entityType: 'store_order',
                                entityId: ord.id,
                                title: `Order ${ord.orderNumber}`,
                                amountInr: ord.totalInr,
                              })
                            }
                            className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors"
                          >
                            Pay Now
                          </button>
                        )}
                        {ord.paymentStatus === 'paid' && ordInvoice ? (
                          <button
                            type="button"
                            onClick={() =>
                              downloadInvoicePdf({
                                invoiceNumber: ordInvoice.invoiceNumber,
                                docType: ordInvoice.docType,
                                entityType: ordInvoice.entityType,
                                amountInr: ordInvoice.amountInr,
                                gstInr: ordInvoice.gstInr,
                                issuedAt: ordInvoice.issuedAt,
                                customerEmail: dbUser?.email || '',
                                gstin:
                                  settings.projectSettings?.enableGstTax && settings.companyInfo?.gstin
                                    ? settings.companyInfo.gstin
                                    : undefined,
                                payload: ordInvoice.payload || {},
                              })
                            }
                            className="px-3.5 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" /> Download Invoice ({ordInvoice.invoiceNumber})
                          </button>
                        ) : (
                          ord.paymentStatus !== 'paid' &&
                          ord.orderStatus !== 'Cancelled' && (
                            <span className="text-[11px] text-[#263746]/70">
                              Tax Invoice unlocks after verified payment
                            </span>
                          )
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelOrderModal(ord);
                              setCancelReason('Changed mind / ordering different configuration');
                            }}
                            className="px-3.5 py-2 border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0"
                          >
                            Cancel Order
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TRACK ORDERS (8-Stage Stepper + Timeline) */}
          {tab === 'tracking' && (
            <div className="space-y-6">
              {data.storeOrders.length === 0 ? (
                <div className="rounded-xl border border-[#DCEAF5] bg-white p-8 text-sm text-[#263746]/70">
                  No store orders available to track yet.
                </div>
              ) : (
                data.storeOrders.map((ord: any) => {
                  const stageIdx = resolveStoreOrderStageIndex(ord.orderStatus);
                  const isCancelled = /cancel|refund/i.test(ord.orderStatus);
                  const historyList: Array<{ status: string; timestamp: string; note?: string; actor?: string }> =
                    Array.isArray(ord.statusHistory) && ord.statusHistory.length > 0
                      ? ord.statusHistory
                      : [
                          {
                            status: ord.orderStatus,
                            timestamp: ord.updatedAt || ord.createdAt,
                            note: 'Order recorded in fulfilment pipeline.',
                          },
                        ];

                  return (
                    <div key={`trk-${ord.id}`} className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCEAF5]/60 pb-3">
                        <div>
                          <div className="font-mono text-sm font-bold text-[#123B5D]">{ord.orderNumber}</div>
                          <div className="text-xs text-[#263746]/70">
                            Placed {new Date(ord.createdAt).toLocaleDateString('en-IN')} · ₹{Number(ord.totalInr || 0).toLocaleString('en-IN')}
                          </div>
                        </div>
                        <div className="text-right text-xs font-mono">
                          <div className={isCancelled ? 'text-red-700 font-bold' : 'text-[#42A5F5] font-bold'}>
                            Current Stage: {ord.orderStatus}
                          </div>
                          {ord.expectedDeliveryDate && (
                            <div className="text-[#263746]/70">Est. Delivery: {ord.expectedDeliveryDate}</div>
                          )}
                        </div>
                      </div>

                      {isCancelled ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900">
                          <div className="font-bold">Status: {ord.orderStatus}</div>
                          {ord.cancelledReason && <div className="mt-1">Reason: {ord.cancelledReason}</div>}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                          {STORE_ORDER_STAGES.map((stageName, idx) => {
                            const reached = idx <= stageIdx;
                            const isCurrent = idx === stageIdx;
                            return (
                              <div
                                key={stageName}
                                className={`p-2.5 rounded-lg border text-[11px] leading-tight ${
                                  isCurrent
                                    ? 'border-[#64B5F6] bg-[#F0F8FF] text-[#123B5D] font-semibold'
                                    : reached
                                    ? 'border-[#90CAF9] bg-[#F0F8FF]/60 text-[#123B5D]'
                                    : 'border-[#DCEAF5] bg-white text-[#263746]/50'
                                }`}
                              >
                                <div className="font-mono text-[10px] mb-0.5">{idx + 1}.</div>
                                <div>{stageName}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {(ord.trackingCourier || ord.trackingId || ord.trackingUrl) && (
                        <div className="rounded-lg bg-[#F0F8FF] border border-[#DCEAF5] p-3.5 text-xs flex flex-wrap items-center justify-between gap-3">
                          <div className="font-mono text-[#263746]">
                            Courier: <strong>{ord.trackingCourier || 'Assigned'}</strong> · AWB / Tracking ID:{' '}
                            <strong>{ord.trackingId || 'Pending'}</strong>
                            {ord.dispatchDate ? ` · Dispatched: ${ord.dispatchDate}` : ''}
                          </div>
                          {ord.trackingUrl && (
                            <a
                              href={ord.trackingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                            >
                              Open Courier Link <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      )}

                      <div className="space-y-2 border-t border-[#DCEAF5]/60 pt-3">
                        <div className="text-xs font-semibold text-[#123B5D]">Status History &amp; Logistics Log</div>
                        <div className="space-y-2 text-xs">
                          {[...historyList].reverse().map((h, i) => (
                            <div key={i} className="flex flex-wrap justify-between gap-2 bg-[#F0F8FF]/60 rounded-lg px-3 py-2 border border-[#DCEAF5]/70">
                              <div>
                                <span className="font-semibold text-[#123B5D]">{h.status}</span>
                                {h.note && <span className="text-[#263746]"> — {h.note}</span>}
                              </div>
                              <span className="font-mono text-[11px] text-[#263746]/70">
                                {h.timestamp ? new Date(h.timestamp).toLocaleString('en-IN') : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* MY CART */}
          {tab === 'cart' && (
            <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCEAF5]/60 pb-3">
                <h2 className="font-display font-bold text-lg text-[#123B5D] flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-[#42A5F5]" /> My Active Cart ({cart.length})
                </h2>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => navigate('/checkout')}
                    className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Proceed to 6-Step Checkout
                  </button>
                )}
              </div>
              {cart.length === 0 ? (
                <div className="py-8 text-center space-y-3">
                  <p className="text-sm text-[#263746]/70">Your cart is currently empty.</p>
                  <button
                    type="button"
                    onClick={() => navigate('/store')}
                    className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Shop Storefront
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-[#DCEAF5]/60">
                  {cart.map((item) => {
                    const unit = item.product.discountPriceInr ?? item.product.priceInr;
                    return (
                      <div key={`${item.product.id}-${item.variant}-${item.color}`} className="py-3 flex items-center gap-4">
                        <img
                          src={item.product.imageUrl}
                          alt={item.product.name}
                          referrerPolicy="no-referrer"
                          className="w-16 h-14 rounded-lg object-cover bg-[#F0F8FF] shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-[#123B5D] truncate">{item.product.name}</div>
                          <div className="text-xs text-[#263746]/70 font-mono">
                            ₹{unit.toLocaleString('en-IN')} × {item.qty}
                          </div>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={Math.max(1, item.product.stockQty)}
                          value={item.qty}
                          onChange={(e) =>
                            updateCartQty(item.product.id, item.variant, item.color, Number(e.target.value))
                          }
                          className="w-16 rounded-lg border border-[#DCEAF5] bg-white px-2 py-1 text-xs font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                        />
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product.id, item.variant, item.color)}
                          className="p-1.5 text-[#263746]/50 hover:text-red-600"
                          aria-label="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* MY REVIEWS */}
          {tab === 'reviews' && (
            <div className="space-y-6">
              {(() => {
                const reviewedIds = new Set((data.myReviews || []).map((r: any) => Number(r.productId)));
                const eligibleMap = new Map<number, { productId: number; name: string; sku: string; imageUrl?: string }>();
                for (const ord of data.storeOrders || []) {
                  if (ord.paymentStatus === 'paid') {
                    for (const it of ord.items || []) {
                      if (it.productId && !reviewedIds.has(Number(it.productId)) && !eligibleMap.has(Number(it.productId))) {
                        eligibleMap.set(Number(it.productId), {
                          productId: Number(it.productId),
                          name: it.name,
                          sku: it.sku,
                          imageUrl: it.imageUrl,
                        });
                      }
                    }
                  }
                }
                const eligibleItems = Array.from(eligibleMap.values());
                return (
                  <>
                    {eligibleItems.length > 0 && (
                      <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4">
                        <h2 className="font-display font-bold text-lg text-[#123B5D]">
                          Write a Verified Purchase Review
                        </h2>
                        <div className="space-y-4">
                          {eligibleItems.map((el) => {
                            const draft = reviewDrafts[el.productId] || { rating: 5, comment: '' };
                            return (
                              <div key={el.productId} className="rounded-lg border border-[#DCEAF5] bg-[#F0F8FF]/60 p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                  <img
                                    src={el.imageUrl || '/assets/aistudio/image_1a5ac752.png'}
                                    alt={el.name}
                                    referrerPolicy="no-referrer"
                                    className="w-12 h-10 rounded object-cover bg-white shrink-0"
                                  />
                                  <div>
                                    <div className="font-semibold text-sm text-[#123B5D]">{el.name}</div>
                                    <div className="font-mono text-[11px] text-[#263746]/70">{el.sku}</div>
                                  </div>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <select
                                    value={draft.rating}
                                    onChange={(e) =>
                                      setReviewDrafts((prev) => ({
                                        ...prev,
                                        [el.productId]: { ...draft, rating: Number(e.target.value) },
                                      }))
                                    }
                                    className="rounded-lg border border-[#DCEAF5] bg-white px-3 py-2 text-xs text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                                  >
                                    {[5, 4, 3, 2, 1].map((n) => (
                                      <option key={n} value={n}>{n} Stars</option>
                                    ))}
                                  </select>
                                  <input
                                    placeholder="Share your operational experience..."
                                    value={draft.comment}
                                    onChange={(e) =>
                                      setReviewDrafts((prev) => ({
                                        ...prev,
                                        [el.productId]: { ...draft, comment: e.target.value },
                                      }))
                                    }
                                    className="flex-1 rounded-lg border border-[#DCEAF5] bg-white px-3 py-2 text-xs text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                                  />
                                  <button
                                    type="button"
                                    disabled={draft.busy}
                                    onClick={() => handleSubmitProductReview(el.productId)}
                                    className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
                                  >
                                    {draft.busy ? 'Submitting...' : 'Submit Review'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4">
                      <h2 className="font-display font-bold text-lg text-[#123B5D] flex items-center gap-2">
                        <Star className="w-5 h-5 text-amber-500" /> My Published Reviews ({(data.myReviews || []).length})
                      </h2>
                      {(data.myReviews || []).length === 0 ? (
                        <p className="text-sm text-[#263746]/70">
                          You have not submitted any product reviews yet. Paid orders become eligible for verified reviews here.
                        </p>
                      ) : (
                        <div className="divide-y divide-[#DCEAF5]/60 text-sm">
                          {data.myReviews.map((r: any) => (
                            <div key={r.id} className="py-3 space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-amber-700">{r.rating}/5 Stars · Verified Purchase</span>
                                <span className="font-mono text-[#263746]/60">{new Date(r.createdAt).toLocaleDateString('en-IN')}</span>
                              </div>
                              <p className="text-[#263746] text-sm">{r.comment}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* DRONE ENQUIRIES */}
          {tab === 'enquiries' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display font-bold text-xl text-[#123B5D]">
                  KRASHIVANTRI &amp; Hardware Enquiries ({(data.productEnquiries || []).length})
                </h2>
                <button
                  type="button"
                  onClick={() => navigate('/krashivantri/enquiry')}
                  className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors"
                >
                  Submit New Drone Enquiry
                </button>
              </div>
              {(data.productEnquiries || []).length === 0 ? (
                <div className="rounded-xl border border-[#DCEAF5] bg-white p-8 text-sm text-[#263746]/70">
                  No KRASHIVANTRI drone enquiries submitted yet.
                </div>
              ) : (
                data.productEnquiries.map((enq: any) => (
                  <div key={enq.id} className="rounded-xl border border-[#DCEAF5] bg-white p-5 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCEAF5]/60 pb-2">
                      <span className="font-mono font-bold text-[#123B5D]">
                        {enq.referenceNumber || enq.enquiryNumber}
                      </span>
                      <span className="font-semibold text-[#42A5F5]">{enq.status}</span>
                    </div>
                    <div className="font-display font-bold text-sm text-[#123B5D]">
                      {enq.interestedProduct} · Qty {enq.quantity}
                    </div>
                    <div className="text-[#263746]/80">
                      {enq.intendedApplication} · {enq.organizationOrFarmName || enq.fullName} · {enq.district}, {enq.state}
                    </div>
                    {enq.message && <p className="text-[#263746] pt-1">{enq.message}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {/* PCB & B2B */}
          {tab === 'pcb_b2b' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h2 className="font-display font-bold text-lg text-[#123B5D]">PCB Enquiries</h2>
                {data.pcbEnquiries.map((pcb: any) => (
                  <div key={pcb.id} className="rounded-xl border border-[#DCEAF5] bg-white p-5 space-y-2 text-xs">
                    <div className="flex justify-between font-semibold">
                      <span className="font-mono text-[#123B5D]">{pcb.enquiryNumber}</span>
                      <span className="text-[#42A5F5]">{pcb.status}</span>
                    </div>
                    <div className="text-[#263746]/80">
                      {pcb.boardDimensionsMm} · {pcb.layerCount} Layers · Qty {pcb.boardQuantity}
                    </div>
                    {pcb.quotedAmountInr && (
                      <div className="pt-2 flex items-center justify-between">
                        <span className="font-mono font-bold text-sm text-[#123B5D]">Quote: ₹{pcb.quotedAmountInr.toLocaleString('en-IN')}</span>
                        {pcb.paymentStatus !== 'paid' && (
                          <button
                            onClick={() =>
                              setPayModal({
                                open: true,
                                entityType: 'pcb_enquiry',
                                entityId: pcb.id,
                                title: `PCB Order ${pcb.enquiryNumber}`,
                                amountInr: pcb.quotedAmountInr,
                              })
                            }
                            className="px-3 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold transition-colors"
                          >
                            Pay Quote
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <h2 className="font-display font-bold text-lg text-[#123B5D]">B2B Bulk Enquiries</h2>
                {data.b2bEnquiries.map((b2b: any) => (
                  <div key={b2b.id} className="rounded-xl border border-[#DCEAF5] bg-white p-5 space-y-2 text-xs">
                    <div className="flex justify-between font-semibold">
                      <span className="font-mono text-[#123B5D]">{b2b.enquiryNumber}</span>
                      <span className="text-[#42A5F5]">{b2b.status}</span>
                    </div>
                    <div className="text-[#123B5D] font-semibold">{b2b.companyName} · {b2b.requirementCategory} (Qty {b2b.quantity})</div>
                    {b2b.quotedAmountInr && (
                      <div className="pt-2 flex items-center justify-between">
                        <span className="font-mono font-bold text-sm text-[#123B5D]">Quote: ₹{b2b.quotedAmountInr.toLocaleString('en-IN')}</span>
                        {b2b.paymentStatus !== 'paid' && (
                          <button
                            onClick={() =>
                              setPayModal({
                                open: true,
                                entityType: 'b2b_enquiry',
                                entityId: b2b.id,
                                title: `B2B Order ${b2b.enquiryNumber}`,
                                amountInr: b2b.quotedAmountInr,
                              })
                            }
                            className="px-3 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold transition-colors"
                          >
                            Pay Quote
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MY INVOICES & FINANCE */}
          {(tab === 'invoices' || tab === 'finance') && (
            <div className="space-y-6">
              {(data.projects || []).length > 0 && (
                <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-3">
                  <h2 className="font-display font-bold text-lg text-[#123B5D]">
                    Project Consolidated Invoices &amp; Payment Statements
                  </h2>
                  <div className="divide-y divide-[#DCEAF5]/60 text-xs">
                    {data.projects.map((p: any) => {
                      const linkedEnq = (data.projectEnquiries || []).find((e: any) => e.id === p.enquiryId);
                      const linkedQuot = (data.quotations || []).find((q: any) => q.id === p.quotationId);
                      const projReceipts = (data.receipts || []).filter(
                        (r: any) => r.entityType === 'project_quotation' && r.entityId === p.quotationId
                      );
                      return (
                        <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-mono font-bold text-[#123B5D]">{p.projectCode} — {p.title}</div>
                            <div className="text-[#263746]/70 font-mono">
                              Total ₹{Number(p.totalAmountInr || 0).toLocaleString('en-IN')} · Paid ₹
                              {Number(p.paidAmountInr || 0).toLocaleString('en-IN')} · Balance ₹
                              {Number(p.balanceAmountInr || 0).toLocaleString('en-IN')}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                downloadCompleteProjectInvoicePdf({
                                  projectCode: p.projectCode,
                                  enquiryNumber: linkedEnq?.enquiryNumber || p.projectCode,
                                  projectTitle: p.title,
                                  customerName: linkedEnq?.customerName || dbUser?.fullName || dbUser?.email || '',
                                  customerEmail: dbUser?.email || '',
                                  customerPhone: linkedEnq?.customerPhone || dbUser?.mobile,
                                  totalAmountInr: Number(p.totalAmountInr || linkedQuot?.totalAmountInr || 0),
                                  gstInr: Number(linkedQuot?.gstInr || 0),
                                  paidAmountInr: Number(p.paidAmountInr || 0),
                                  balanceAmountInr: Number(p.balanceAmountInr || 0),
                                  costCategories: linkedQuot?.costCategories,
                                  receipts: projReceipts,
                                  gstin:
                                    settings.projectSettings?.enableGstTax && settings.companyInfo?.gstin
                                      ? settings.companyInfo.gstin
                                      : undefined,
                                })
                              }
                              className="px-3 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" /> Complete Project Invoice
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                downloadPaymentHistoryStatementPdf({
                                  projectCode: p.projectCode,
                                  enquiryNumber: linkedEnq?.enquiryNumber || p.projectCode,
                                  projectTitle: p.title,
                                  customerName: linkedEnq?.customerName || dbUser?.fullName || dbUser?.email || '',
                                  customerEmail: dbUser?.email || '',
                                  totalAmountInr: Number(p.totalAmountInr || 0),
                                  paidAmountInr: Number(p.paidAmountInr || 0),
                                  balanceAmountInr: Number(p.balanceAmountInr || 0),
                                  receipts: projReceipts,
                                  gstin:
                                    settings.projectSettings?.enableGstTax && settings.companyInfo?.gstin
                                      ? settings.companyInfo.gstin
                                      : undefined,
                                })
                              }
                              className="px-3 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" /> Payment History Statement
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4">
                <h2 className="font-display font-bold text-lg text-[#123B5D]">Payment History</h2>
                {data.payments.length === 0 ? (
                  <p className="text-sm text-[#263746]/70">No payments recorded yet.</p>
                ) : (
                  <div className="divide-y divide-[#DCEAF5]/60 text-xs">
                    {data.payments.map((p: any) => (
                      <div key={p.id} className="py-3 flex justify-between gap-2">
                        <div>
                          <div className="font-mono font-semibold text-[#123B5D]">{p.paymentRef}</div>
                          <div className="text-[#263746]/70">{p.entityType} · {p.mode === 'test_mode' ? 'Sandbox Test Mode' : 'Razorpay'}</div>
                          {p.failureReason && (
                            <div className="text-red-700 mt-0.5">Reason: {p.failureReason}</div>
                          )}
                        </div>
                        <div className="text-right font-mono">
                          <div className="font-bold text-[#123B5D]">₹{p.amountInr.toLocaleString('en-IN')}</div>
                          <div className={`inline-flex items-center gap-1 ${p.status === 'failed' ? 'text-red-700' : p.status === 'refunded' ? 'text-amber-700' : 'text-[#42A5F5]'}`}>
                            <CheckCircle2 className="w-3 h-3" /> {p.status}
                            {p.refundStatus && p.refundStatus !== 'none' ? ` (${p.refundStatus})` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4">
                <h2 className="font-display font-bold text-lg text-[#123B5D]">Invoices &amp; Official Receipts</h2>
                {(data.receipts || []).length > 0 && (
                  <div className="space-y-2 pb-3 border-b border-[#DCEAF5]/60">
                    <div className="text-xs font-semibold text-[#123B5D]">Verified Payment Receipts</div>
                    <div className="divide-y divide-[#DCEAF5]/60 text-xs">
                      {data.receipts.map((rcp: any) => (
                        <div key={rcp.id} className="py-2 flex items-center justify-between gap-2">
                          <div>
                            <span className="font-mono font-semibold text-[#123B5D]">{rcp.receiptNumber}</span> ·{' '}
                            <span className="text-[#263746]/70">
                              {rcp.paymentStage} · ₹{Number(rcp.amountInr).toLocaleString('en-IN')}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              downloadPaymentReceiptPdf({
                                receiptNumber: rcp.receiptNumber,
                                paymentRef: rcp.paymentRef,
                                razorpayPaymentId: rcp.razorpayPaymentId,
                                paymentStage: rcp.paymentStage,
                                amountInr: rcp.amountInr,
                                issuedAt: rcp.issuedAt,
                                customerEmail: dbUser?.email || '',
                                referenceCode: rcp.payload?.projectCode || rcp.paymentRef,
                              })
                            }
                            className="px-3 py-1 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                          >
                            <Download className="w-3 h-3" /> Receipt PDF
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(() => {
                  const paidOrderIds = new Set(
                    (data.storeOrders || [])
                      .filter((o: any) => o.paymentStatus === 'paid')
                      .map((o: any) => o.id)
                  );
                  const visibleInvoices = (data.invoices || []).filter(
                    (inv: any) => inv.entityType !== 'store_order' || paidOrderIds.has(inv.entityId)
                  );
                  return visibleInvoices.length === 0 ? (
                    <p className="text-sm text-[#263746]/70">
                      No paid Tax Invoices issued yet. Store Tax Invoices unlock automatically after payment confirmation.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#DCEAF5]/60 text-xs">
                      {visibleInvoices.map((inv: any) => (
                        <div key={inv.id} className="py-3 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-mono font-semibold text-[#123B5D]">{inv.invoiceNumber}</div>
                            <div className="text-[#263746]/70">
                              {inv.docType} · ₹{Number(inv.amountInr || 0).toLocaleString('en-IN')} · {new Date(inv.issuedAt).toLocaleDateString('en-IN')}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              downloadInvoicePdf({
                                invoiceNumber: inv.invoiceNumber,
                                docType: inv.docType,
                                entityType: inv.entityType,
                                amountInr: inv.amountInr,
                                gstInr: inv.gstInr,
                                issuedAt: inv.issuedAt,
                                customerEmail: dbUser?.email || '',
                                gstin:
                                  settings.projectSettings?.enableGstTax && settings.companyInfo?.gstin
                                    ? settings.companyInfo.gstin
                                    : undefined,
                                payload: inv.payload || {},
                              })
                            }
                            className="px-3 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" /> Invoice PDF
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
            </div>
          )}

          {/* WISHLIST */}
          {tab === 'wishlist' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {data.wishlist.length === 0 ? (
                <div className="col-span-full rounded-xl border border-[#DCEAF5] bg-white p-8 text-sm text-[#263746]/70 flex items-center gap-2">
                  <Heart className="w-4 h-4 text-[#42A5F5]" /> Your wishlist is empty.
                </div>
              ) : (
                data.wishlist.map((prod: any) => (
                  <button
                    key={prod.id}
                    onClick={() => navigate(`/product/${prod.slug}`)}
                    className="text-left rounded-xl border border-[#DCEAF5] bg-white hover:border-[#90CAF9] overflow-hidden transition-colors"
                  >
                    <img src={prod.imageUrl} alt={prod.name} referrerPolicy="no-referrer" className="w-full aspect-[4/3] object-cover" />
                    <div className="p-4 space-y-1">
                      <div className="font-display font-semibold text-sm text-[#123B5D]">{prod.name}</div>
                      <div className="font-mono text-xs font-bold text-[#42A5F5]">₹{(prod.discountPriceInr ?? prod.priceInr).toLocaleString('en-IN')}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* SUPPORT TICKETS */}
          {tab === 'support' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#DCEAF5] bg-[#F0F8FF] p-5 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-display font-bold text-sm text-[#123B5D]">
                    Direct Customer Care Email Support
                  </div>
                  <p className="text-xs text-[#263746]/80">
                    Reach our customer care team directly via email for fast order &amp; warranty assistance.
                  </p>
                </div>
                <a
                  href={`mailto:${settings.companyInfo?.customerCareEmail || 'info@nexustekfusion.in'}?subject=${encodeURIComponent('Customer Care Ticket Enquiry')}`}
                  className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-2 font-mono transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Contact Customer Support ({settings.companyInfo?.customerCareEmail || 'info@nexustekfusion.in'})
                </a>
              </div>
              {data.supportTickets.length === 0 ? (
                <div className="rounded-xl border border-[#DCEAF5] bg-white p-8 text-sm text-[#263746]/70">
                  No support tickets yet. Visit Contact to open a ticket.
                </div>
              ) : (
                data.supportTickets.map((t: any) => (
                  <div key={t.id} className="rounded-xl border border-[#DCEAF5] bg-white p-6 space-y-4">
                    <div className="flex justify-between items-center border-b border-[#DCEAF5]/60 pb-2">
                      <div>
                        <span className="font-mono text-xs text-[#263746]/70">{t.ticketNumber} · {t.serviceCategory}</span>
                        <h3 className="font-display font-bold text-[#123B5D]">{t.subject}</h3>
                      </div>
                      <span className="text-xs font-semibold text-[#42A5F5]">{t.status}</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      {(t.messages || []).map((m: any, i: number) => (
                        <div key={i} className={`p-3 rounded-lg ${m.role === 'admin' ? 'bg-[#F0F8FF] text-[#123B5D] border border-[#DCEAF5]' : 'bg-white border border-[#DCEAF5]/70 text-[#263746]'}`}>
                          <div className="font-semibold">{m.sender} ({m.role})</div>
                          <div className="mt-0.5">{m.text}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        placeholder="Write a reply..."
                        value={replyText[t.id] || ''}
                        onChange={(e) => setReplyText({ ...replyText, [t.id]: e.target.value })}
                        className="flex-1 rounded-lg border border-[#DCEAF5] bg-white px-3 py-2 text-xs text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                      />
                      <button
                        onClick={() => sendTicketReply(t.id)}
                        className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-xs font-semibold rounded-lg transition-colors"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {orderDetailModal && (
        <div className="fixed inset-0 z-50 bg-[#123B5D]/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white border border-[#DCEAF5] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-[#F0F8FF] border-b border-[#DCEAF5] text-[#123B5D] px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono text-[#42A5F5]">Store Order Summary</div>
                <h3 className="font-display font-bold text-base">{orderDetailModal.orderNumber}</h3>
              </div>
              <button
                type="button"
                onClick={() => setOrderDetailModal(null)}
                className="p-1.5 rounded-lg text-[#123B5D] hover:bg-[#DCEAF5]/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-[#DCEAF5] p-3.5 space-y-1">
                  <div className="font-semibold text-[#123B5D]">Shipping Address</div>
                  <div className="text-[#263746]/80">
                    {orderDetailModal.shippingAddress?.fullName} · {orderDetailModal.shippingAddress?.mobile}
                    <div>
                      {orderDetailModal.shippingAddress?.houseFlat}, {orderDetailModal.shippingAddress?.streetArea}
                    </div>
                    <div>
                      {orderDetailModal.shippingAddress?.city}, {orderDetailModal.shippingAddress?.state} — {orderDetailModal.shippingAddress?.pinCode}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-[#DCEAF5] p-3.5 space-y-1 font-mono tabular-nums text-[#263746]">
                  <div className="font-sans font-semibold text-[#123B5D]">Payment &amp; Status</div>
                  <div>Order Status: {orderDetailModal.orderStatus}</div>
                  <div>Payment: {orderDetailModal.paymentStatus}</div>
                  <div>Total Paid: ₹{Number(orderDetailModal.totalInr || 0).toLocaleString('en-IN')}</div>
                </div>
              </div>

              <div className="divide-y divide-[#DCEAF5]/60 border rounded-lg border-[#DCEAF5] px-4 text-[#263746]">
                {(orderDetailModal.items || []).map((it: any, idx: number) => (
                  <div key={idx} className="py-2.5 flex justify-between gap-2">
                    <span>
                      {it.name} × {it.qty} ({it.sku})
                    </span>
                    <span className="font-mono font-semibold text-[#123B5D]">₹{Number(it.lineTotalInr || 0).toLocaleString('en-IN')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {cancelOrderModal && (
        <div className="fixed inset-0 z-50 bg-[#123B5D]/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#DCEAF5] shadow-2xl p-6 space-y-4">
            <h3 className="font-display font-bold text-lg text-[#123B5D]">
              Cancel Order {cancelOrderModal.orderNumber}?
            </h3>
            <p className="text-xs text-[#263746]/80">
              Orders can be cancelled before dispatch and reserved inventory will be restored immediately.
            </p>
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation..."
              className="w-full rounded-lg border border-[#DCEAF5] bg-white px-3 py-2 text-xs text-[#263746] focus:outline-none focus:border-[#64B5F6]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelOrderModal(null)}
                className="px-4 py-2 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg text-xs font-semibold transition-colors"
              >
                Keep Order
              </button>
              <button
                type="button"
                disabled={cancellingOrder}
                onClick={handleCancelStoreOrder}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                {cancellingOrder ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {payModal && (
        <RazorpayCheckoutModal
          open={payModal.open}
          onClose={() => setPayModal(null)}
          entityType={payModal.entityType}
          entityId={payModal.entityId}
          paymentMode={payModal.paymentMode}
          title={payModal.title}
          amountInr={payModal.amountInr}
          onSuccess={loadDashboard}
        />
      )}
    </div>
  );
};
