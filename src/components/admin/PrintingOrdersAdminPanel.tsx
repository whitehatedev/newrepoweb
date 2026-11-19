import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  Filter,
  Lock,
  Search,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { usePlatform } from '../../context/PlatformContext';
import { ModelViewer3D } from '../ModelViewer3D';
import { PrintingOrderRecord, PrintingOrderStatus } from '../../types/platform';

export const STANDARD_PRINTING_ORDER_STATUSES: PrintingOrderStatus[] = [
  'New Order',
  'Payment Pending',
  'Payment Completed',
  'File Under Review',
  'Printing Parameters Confirmed',
  'Ready for Printing',
  'Printing in Progress',
  'Quality Inspection',
  'Completed',
  'Dispatched / Delivered',
  'Cancelled',
];

interface Props {
  orders: PrintingOrderRecord[];
  onRefresh: () => void;
}

export const PrintingOrdersAdminPanel: React.FC<Props> = ({ orders, onRefresh }) => {
  const { apiFetch, getIdToken, notify } = usePlatform();

  const [searchQ, setSearchQ] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [serverOrders, setServerOrders] = useState<PrintingOrderRecord[] | null>(null);
  const [filtering, setFiltering] = useState(false);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [uploadingProdId, setUploadingProdId] = useState<number | null>(null);

  const [editMap, setEditMap] = useState<Record<number, any>>({});
  const [prodUploadForm, setProdUploadForm] = useState<
    Record<number, { file: File | null; fileKind: string; notes: string }>
  >({});

  const [previewState, setPreviewState] = useState<{
    order: PrintingOrderRecord;
    buffer: ArrayBuffer | null;
    loading: boolean;
    error: string;
  } | null>(null);

  const activeList = serverOrders !== null ? serverOrders : orders;

  const filteredOrders = useMemo(() => {
    return (activeList || []).filter((o) => {
      if (paymentFilter !== 'all' && String(o.paymentStatus).toLowerCase() !== paymentFilter) {
        return false;
      }
      if (orderStatusFilter !== 'all' && o.orderStatus !== orderStatusFilter) {
        return false;
      }
      if (dateFrom && new Date(o.createdAt) < new Date(`${dateFrom}T00:00:00.000Z`)) {
        return false;
      }
      if (dateTo && new Date(o.createdAt) > new Date(`${dateTo}T23:59:59.999Z`)) {
        return false;
      }
      if (searchQ.trim()) {
        const needle = searchQ.trim().toLowerCase();
        const hay = `${o.orderNumber} ${o.fileName} ${o.customerName || ''} ${o.customerEmail || ''} ${o.materialName} ${o.technology}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [activeList, paymentFilter, orderStatusFilter, dateFrom, dateTo, searchQ]);

  const metrics = useMemo(() => {
    const list = activeList || [];
    const total = list.length;
    const unlocked = list.filter((o) => o.downloadUnlocked).length;
    const locked = total - unlocked;
    const inProd = list.filter((o) =>
      ['Printing Parameters Confirmed', 'Ready for Printing', 'Printing in Progress', 'Quality Inspection'].includes(
        o.orderStatus
      )
    ).length;
    return { total, unlocked, locked, inProd };
  }, [activeList]);

  const fetchFilteredFromServer = async () => {
    setFiltering(true);
    try {
      const qs = new URLSearchParams();
      if (paymentFilter !== 'all') qs.set('paymentStatus', paymentFilter);
      if (orderStatusFilter !== 'all') qs.set('orderStatus', orderStatusFilter);
      if (searchQ.trim()) qs.set('q', searchQ.trim());
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      const res = await apiFetch<{ orders: PrintingOrderRecord[] }>(
        `/api/admin/printing-orders${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      setServerOrders(res.orders || []);
    } catch (err: any) {
      notify(err?.message || 'Failed to query 3D printing orders.', 'error');
    } finally {
      setFiltering(false);
    }
  };

  const resetFilters = () => {
    setSearchQ('');
    setPaymentFilter('all');
    setOrderStatusFilter('all');
    setDateFrom('');
    setDateTo('');
    setServerOrders(null);
  };

  const getOrderEdit = (po: PrintingOrderRecord) => {
    if (editMap[po.id]) return editMap[po.id];
    const cp = (po.customerParameters || {}) as Record<string, any>;
    const conf = (po.confirmedParameters || {}) as Record<string, any>;
    return {
      orderStatus: po.orderStatus,
      slicingStatus: po.slicingStatus,
      totalInr: String(po.totalInr),
      productionNotes: po.productionNotes || '',
      trackingCourier: po.trackingCourier || '',
      trackingId: po.trackingId || '',
      trackingUrl: po.trackingUrl || '',
      customerDownloadEnabled: po.customerDownloadEnabled !== false,
      confirmedMaterialName: String(conf.materialName ?? po.materialName),
      confirmedLayerHeightMm: String(conf.layerHeightMm ?? po.layerHeightMm),
      confirmedInfillPercent: String(conf.infillPercent ?? po.infillPercent),
      confirmedWallCount: String(conf.wallCount ?? po.wallCount ?? cp.wallCount ?? 3),
      confirmedPrintSpeedMmS: String(conf.printSpeedMmS ?? po.printSpeedMmS ?? cp.printSpeedMmS ?? 60),
      confirmedNozzleDiameterMm: String(conf.nozzleDiameterMm ?? po.nozzleDiameterMm ?? cp.nozzleDiameterMm ?? 0.4),
      confirmedBuildOrientation: String(conf.buildOrientation ?? po.buildOrientation ?? cp.buildOrientation ?? 'Auto Optimal'),
      confirmedFinishingOption: String(conf.finishingOption ?? po.finishingOption ?? 'Standard As-Printed'),
      confirmedSupportEnabled:
        conf.supportEnabled !== undefined ? Boolean(conf.supportEnabled) : Boolean(po.supportEnabled),
      confirmedNotes: String(conf.engineeringNotes ?? ''),
    };
  };

  const patchOrderEdit = (id: number, po: PrintingOrderRecord, patch: Record<string, any>) => {
    setEditMap((prev) => ({
      ...prev,
      [id]: {
        ...getOrderEdit(po),
        ...patch,
      },
    }));
  };

  const handleSaveOrder = async (po: PrintingOrderRecord, includeConfirmedParams: boolean) => {
    const ed = getOrderEdit(po);
    setSavingId(po.id);
    try {
      const payload: Record<string, any> = {
        orderStatus: ed.orderStatus,
        slicingStatus: ed.slicingStatus,
        totalInr: Number(ed.totalInr),
        productionNotes: ed.productionNotes,
        trackingCourier: ed.trackingCourier,
        trackingId: ed.trackingId,
        trackingUrl: ed.trackingUrl,
        customerDownloadEnabled: Boolean(ed.customerDownloadEnabled),
      };

      if (includeConfirmedParams) {
        payload.confirmedParameters = {
          materialName: ed.confirmedMaterialName,
          layerHeightMm: Number(ed.confirmedLayerHeightMm),
          infillPercent: Number(ed.confirmedInfillPercent),
          wallCount: Number(ed.confirmedWallCount),
          printSpeedMmS: Number(ed.confirmedPrintSpeedMmS),
          nozzleDiameterMm: Number(ed.confirmedNozzleDiameterMm),
          buildOrientation: ed.confirmedBuildOrientation,
          finishingOption: ed.confirmedFinishingOption,
          supportEnabled: Boolean(ed.confirmedSupportEnabled),
          engineeringNotes: ed.confirmedNotes,
        };
      }

      await apiFetch(`/api/admin/printing-orders/${po.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      notify(`Updated ${po.orderNumber} (${ed.orderStatus}). Payment status remains protected.`, 'success');
      setServerOrders(null);
      onRefresh();
    } catch (err: any) {
      notify(err?.message || 'Failed to save 3D printing order update.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const authorizedFetchBlob = async (url: string, fallbackFileName?: string): Promise<Blob> => {
    const idToken = await getIdToken();
    const headers: Record<string, string> = {};
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const resp = await fetch(url, { headers, credentials: 'same-origin' });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ error: `Blocked (HTTP ${resp.status})` }));
      throw new Error(errData.error || `Request blocked (${resp.status})`);
    }
    const ctype = resp.headers.get('content-type') || '';
    if (ctype.includes('application/json') && !fallbackFileName?.endsWith('.json')) {
      const payload = await resp.json();
      if (payload?.signedUrl) {
        const signedResp = await fetch(payload.signedUrl);
        if (!signedResp.ok) throw new Error('Signed URL download failed.');
        return signedResp.blob();
      }
      return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    }
    return resp.blob();
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadOriginal = async (po: PrintingOrderRecord) => {
    try {
      const blob = await authorizedFetchBlob(
        `/api/admin/printing-orders/${po.id}/download-original?format=json`,
        po.fileName
      );
      triggerBlobDownload(blob, po.fileName);
      notify(`Original CAD file downloaded (${po.fileName}). Logged in audit history.`, 'success');
      onRefresh();
    } catch (err: any) {
      notify(err?.message || 'Original file download blocked.', 'error');
      onRefresh();
    }
  };

  const handleOpenPreview = async (po: PrintingOrderRecord) => {
    setPreviewState({ order: po, buffer: null, loading: true, error: '' });
    try {
      const idToken = await getIdToken();
      const headers: Record<string, string> = {};
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
      const resp = await fetch(
        `/api/admin/printing-orders/${po.id}/download-original?mode=preview&format=json`,
        { headers, credentials: 'same-origin' }
      );
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: 'Preview locked until full payment is verified.' }));
        throw new Error(errData.error || 'Preview blocked.');
      }
      let buffer: ArrayBuffer;
      const ctype = resp.headers.get('content-type') || '';
      if (ctype.includes('application/json')) {
        const payload = await resp.json();
        const fileResp = await fetch(payload.signedUrl);
        if (!fileResp.ok) throw new Error('Could not load signed preview stream.');
        buffer = await fileResp.arrayBuffer();
      } else {
        buffer = await resp.arrayBuffer();
      }
      setPreviewState({ order: po, buffer, loading: false, error: '' });
    } catch (err: any) {
      setPreviewState({
        order: po,
        buffer: null,
        loading: false,
        error: err?.message || 'Preview blocked.',
      });
    }
  };

  const handleDownloadSpecSheet = async (po: PrintingOrderRecord) => {
    try {
      const blob = await authorizedFetchBlob(
        `/api/admin/printing-orders/${po.id}/spec-sheet`,
        `${po.orderNumber}-printing-specs.json`
      );
      triggerBlobDownload(blob, `${po.orderNumber}-printing-specs.json`);
      notify(`Spec sheet exported for ${po.orderNumber}.`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Failed to download spec sheet.', 'error');
    }
  };

  const handleUploadProductionFile = async (po: PrintingOrderRecord) => {
    const entry = prodUploadForm[po.id];
    if (!entry?.file) {
      notify('Select a sliced/production file (.gcode, .3mf, .stl, .zip, .pdf) first.', 'error');
      return;
    }
    setUploadingProdId(po.id);
    try {
      const fd = new FormData();
      fd.append('file', entry.file);
      fd.append('fileKind', entry.fileKind || 'sliced_gcode');
      fd.append('notes', entry.notes || '');
      await apiFetch(`/api/admin/printing-orders/${po.id}/production-files`, {
        method: 'POST',
        body: fd,
      });
      notify(`Production file uploaded separately for ${po.orderNumber}. Original file untouched.`, 'success');
      setProdUploadForm((prev) => ({
        ...prev,
        [po.id]: { file: null, fileKind: 'sliced_gcode', notes: '' },
      }));
      setServerOrders(null);
      onRefresh();
    } catch (err: any) {
      notify(err?.message || 'Failed to upload production file.', 'error');
    } finally {
      setUploadingProdId(null);
    }
  };

  const handleDownloadProductionFile = async (poId: number, fileId: number, fileName: string) => {
    try {
      const blob = await authorizedFetchBlob(
        `/api/admin/printing-orders/${poId}/production-files/${fileId}/download`,
        fileName
      );
      triggerBlobDownload(blob, fileName);
      notify(`Downloaded production file ${fileName}.`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Failed to download production file.', 'error');
    }
  };

  const exportCsv = () => {
    const header = [
      'Order Number',
      'Customer',
      'Email',
      'File Name',
      'Format',
      'Material',
      'Technology',
      'Order Status',
      'Payment Status',
      'Refund Status',
      'Total INR',
      'Created At',
    ];
    const rows = filteredOrders.map((o) => [
      o.orderNumber,
      o.customerName || '',
      o.customerEmail || '',
      o.fileName,
      o.fileFormat,
      o.materialName,
      o.technology,
      o.orderStatus,
      o.paymentStatus,
      o.refundStatus || 'none',
      o.totalInr,
      new Date(o.createdAt).toISOString(),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    triggerBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'nexustek-3d-printing-orders.csv');
  };

  return (
    <div className="space-y-5 text-xs">
      {/* KPI Metrics Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[#DCEAF5] bg-white p-4">
          <div className="text-[#263746]/70">Total 3D Orders</div>
          <div className="font-mono text-2xl font-bold text-[#123B5D] mt-1 tabular-nums">{metrics.total}</div>
        </div>
        <div className="rounded-xl border border-[#90CAF9] bg-[#F0F8FF] p-4">
          <div className="text-[#42A5F5] font-medium flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Verified Paid (Unlocked)
          </div>
          <div className="font-mono text-2xl font-bold text-[#123B5D] mt-1 tabular-nums">{metrics.unlocked}</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-white p-4">
          <div className="text-amber-700 font-medium flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Payment Locked
          </div>
          <div className="font-mono text-2xl font-bold text-amber-800 mt-1 tabular-nums">{metrics.locked}</div>
        </div>
        <div className="rounded-xl border border-[#DCEAF5] bg-white p-4">
          <div className="text-[#263746]/70">In Print / Queue</div>
          <div className="font-mono text-2xl font-bold text-[#123B5D] mt-1 tabular-nums">{metrics.inProd}</div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="rounded-xl border border-[#DCEAF5] bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-display font-bold text-base text-[#123B5D]">
            <Filter className="w-4 h-4 text-[#42A5F5]" />
            <span>3D Printing Orders Management &amp; Payment-Gated CAD Vault</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="px-3 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] rounded-lg font-semibold inline-flex items-center gap-1.5 text-[#123B5D] transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#42A5F5]" /> Export CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="lg:col-span-2 relative">
            <Search className="w-3.5 h-3.5 text-[#42A5F5] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search order #, customer, email, CAD file..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-[#DCEAF5] bg-white text-[#263746] focus:outline-none focus:border-[#64B5F6]"
            />
          </div>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="rounded-lg border border-[#DCEAF5] px-2.5 py-2 bg-white font-medium text-[#263746] focus:outline-none focus:border-[#64B5F6]"
          >
            <option value="all">All Payment Statuses</option>
            <option value="paid">Paid (Verified)</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
            <option value="partial">Partial</option>
          </select>
          <select
            value={orderStatusFilter}
            onChange={(e) => setOrderStatusFilter(e.target.value)}
            className="rounded-lg border border-[#DCEAF5] px-2.5 py-2 bg-white font-medium text-[#263746] focus:outline-none focus:border-[#64B5F6]"
          >
            <option value="all">All Order Statuses</option>
            {STANDARD_PRINTING_ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="From date"
            className="rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-2 font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
          />
          <div className="flex gap-1.5">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="To date"
              className="flex-1 rounded-lg border border-[#DCEAF5] bg-white px-2 py-2 font-mono min-w-0 text-[#263746] focus:outline-none focus:border-[#64B5F6]"
            />
            <button
              type="button"
              disabled={filtering}
              onClick={fetchFilteredFromServer}
              className="px-3 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white font-semibold rounded-lg transition-colors"
            >
              {filtering ? '...' : 'Apply'}
            </button>
            {(searchQ || paymentFilter !== 'all' || orderStatusFilter !== 'all' || dateFrom || dateTo || serverOrders !== null) && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-2.5 py-2 border border-[#DCEAF5] rounded-lg text-[#263746] hover:bg-[#F0F8FF]"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="rounded-xl border border-[#DCEAF5] bg-white p-8 text-center text-[#263746]/70">
          No 3D printing orders match the current filters.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((po) => {
            const ed = getOrderEdit(po);
            const isExpanded = expandedId === po.id;
            const cp = (po.customerParameters || {}) as Record<string, any>;
            const dims = po.boundingBoxMm || cp.dimensionsMm || null;
            const unlocked = Boolean(po.downloadUnlocked);
            const statusOptions = Array.from(
              new Set([po.orderStatus, ...STANDARD_PRINTING_ORDER_STATUSES])
            );
            const prodDraft = prodUploadForm[po.id] || {
              file: null,
              fileKind: 'sliced_gcode',
              notes: '',
            };

            return (
              <div
                key={po.id}
                className={`rounded-xl border bg-white p-5 space-y-4 ${
                  unlocked ? 'border-[#DCEAF5]' : 'border-amber-200'
                }`}
              >
                {/* Header Row */}
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 border-b border-[#DCEAF5]/60 pb-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-sm text-[#123B5D]">
                        {po.orderNumber}
                      </span>
                      <span className="font-mono text-[#263746]/70">
                        · {po.fileFormat || 'CAD'} · {po.fileVersion || 'v1'} ·{' '}
                        {po.fileSizeBytes ? `${(po.fileSizeBytes / 1024).toFixed(1)} KB` : ''}
                      </span>
                      <span className="font-mono text-[#263746]/60">
                        · {new Date(po.uploadedAt || po.createdAt).toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="font-display font-bold text-base text-[#123B5D]">
                      {po.fileName}
                    </div>
                    <div className="text-[#263746]/80">
                      Customer:{' '}
                      <span className="font-semibold text-[#123B5D]">
                        {po.customerName || po.deliveryAddress?.fullName || `User #${po.userId}`}
                      </span>
                      {po.customerEmail ? ` (${po.customerEmail})` : ''}
                      {po.customerMobile ? ` · ${po.customerMobile}` : ''}
                    </div>
                    <div className="text-[#263746]/80 font-mono">
                      {po.technology} · {po.materialName} ({po.colorName}) · Qty {po.quantity} ·{' '}
                      {po.layerHeightMm}mm layer · {po.infillPercent}% infill ·{' '}
                      {po.wallCount ?? cp.wallCount ?? 3} walls ·{' '}
                      {po.printSpeedMmS ?? cp.printSpeedMmS ?? 60} mm/s
                    </div>
                  </div>

                  {/* Strict Read-Only Payment Verification Status + Action Buttons */}
                  <div className="flex flex-col items-start lg:items-end gap-2">
                    <div className="font-mono font-bold text-base text-[#123B5D] tabular-nums">
                      Quote Total: ₹{Number(po.totalInr || 0).toLocaleString('en-IN')}
                    </div>

                    {/* Payment Status & Security Lock Indicator */}
                    <div
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 ${
                        unlocked
                          ? 'border-[#90CAF9] bg-[#F0F8FF] text-[#123B5D]'
                          : 'border-amber-200 bg-amber-50 text-amber-900'
                      }`}
                    >
                      {unlocked ? (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-[#42A5F5]" />
                          <span>
                            Payment Verified ({po.paymentStatus}) — CAD Download Unlocked
                          </span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5 text-amber-700" />
                          <span>
                            Payment: {po.paymentStatus}
                            {po.refundStatus && po.refundStatus !== 'none'
                              ? ` / ${po.refundStatus}`
                              : ''}{' '}
                            — CAD Locked
                          </span>
                        </>
                      )}
                    </div>

                    {po.razorpayPaymentId && (
                      <div className="font-mono text-[11px] text-[#263746]/70">
                        Razorpay: {po.razorpayPaymentId}
                      </div>
                    )}
                  </div>
                </div>

                {/* Status Controls + Download Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!unlocked}
                      onClick={() => handleDownloadOriginal(po)}
                      title={
                        unlocked
                          ? 'Download payment-verified original customer CAD file'
                          : po.downloadLockReason || 'Locked until full payment is verified'
                      }
                      className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 transition-colors ${
                        unlocked
                          ? 'bg-[#64B5F6] hover:bg-[#42A5F5] text-white'
                          : 'bg-[#F0F8FF] text-[#263746]/40 border border-[#DCEAF5] cursor-not-allowed'
                      }`}
                    >
                      {unlocked ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      Download Original 3D File
                    </button>

                    <button
                      type="button"
                      disabled={!unlocked}
                      onClick={() => handleOpenPreview(po)}
                      title={
                        unlocked
                          ? 'Inspect uploaded CAD geometry in 3D viewer'
                          : po.downloadLockReason || 'Locked until full payment is verified'
                      }
                      className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                        unlocked
                          ? 'border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D]'
                          : 'border-[#DCEAF5] bg-[#F0F8FF] text-[#263746]/40 cursor-not-allowed'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      3D Preview
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownloadSpecSheet(po)}
                      className="px-3.5 py-2 rounded-lg border border-[#DCEAF5] bg-white hover:bg-[#F0F8FF] text-[#123B5D] font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-[#42A5F5]" />
                      Spec Sheet (JSON)
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : po.id)}
                      className="px-3.5 py-2 rounded-lg border border-[#90CAF9] bg-[#F0F8FF] hover:bg-[#DCEAF5]/60 text-[#123B5D] font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {isExpanded ? 'Hide Details' : 'Parameters, Slicing & Logs'}
                    </button>
                  </div>

                  {/* Fulfillment Controls (Order Status strictly independent from Payment Status) */}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={ed.slicingStatus}
                      onChange={(e) => patchOrderEdit(po.id, po, { slicingStatus: e.target.value })}
                      className="rounded-lg border border-[#DCEAF5] px-2.5 py-1.5 bg-white text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                      title="Slicing workflow status"
                    >
                      {['Auto Sliced', 'Technical Review Required', 'Slicing Completed'].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>

                    <select
                      value={ed.orderStatus}
                      onChange={(e) => patchOrderEdit(po.id, po, { orderStatus: e.target.value })}
                      className="rounded-lg border border-[#DCEAF5] px-2.5 py-1.5 bg-white font-semibold text-[#123B5D] focus:outline-none focus:border-[#64B5F6]"
                      title="Order fulfillment status (does not alter payment status)"
                    >
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      value={ed.totalInr}
                      onChange={(e) => patchOrderEdit(po.id, po, { totalInr: e.target.value })}
                      className="w-24 rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                      title="Order quote total ₹"
                    />

                    <button
                      type="button"
                      disabled={savingId === po.id}
                      onClick={() => handleSaveOrder(po, false)}
                      className="px-3.5 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold disabled:opacity-50 transition-colors"
                    >
                      {savingId === po.id ? 'Saving...' : 'Update Status'}
                    </button>
                  </div>
                </div>

                {!unlocked && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2 text-amber-900 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      Security Lock Active: {po.downloadLockReason || 'Full verified payment required before CAD download.'} Updating Order Status will NOT unlock CAD downloads.
                    </span>
                  </div>
                )}

                {/* Expanded Workbench Drawer */}
                {isExpanded && (
                  <div className="border-t border-[#DCEAF5] pt-4 space-y-5">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      {/* Left: Immutable Customer Original Parameters */}
                      <div className="rounded-xl border border-[#DCEAF5] bg-[#F0F8FF]/60 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-display font-bold text-sm text-[#123B5D]">
                            Customer Original Parameters (Locked Snapshot)
                          </h4>
                          <span className="font-mono text-[11px] text-[#263746]/70">Read-Only</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]">
                          <div>
                            <span className="text-[#263746]/70 block font-sans">Original File</span>
                            <span className="font-semibold text-[#123B5D] break-all">{cp.originalFilename || po.fileName}</span>
                          </div>
                          <div>
                            <span className="text-[#263746]/70 block font-sans">Technology / Printer</span>
                            <span className="font-semibold text-[#123B5D]">
                              {cp.technology || po.technology} · {cp.printerName || po.printerName || 'Standard'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#263746]/70 block font-sans">Material &amp; Colour</span>
                            <span className="font-semibold text-[#123B5D]">
                              {cp.materialName || po.materialName} ({cp.colorName || po.colorName})
                            </span>
                          </div>
                          <div>
                            <span className="text-[#263746]/70 block font-sans">Layer Height / Infill</span>
                            <span className="font-semibold text-[#123B5D]">
                              {cp.layerHeightMm ?? po.layerHeightMm} mm / {cp.infillPercent ?? po.infillPercent}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[#263746]/70 block font-sans">Walls / Nozzle / Speed</span>
                            <span className="font-semibold text-[#123B5D]">
                              {cp.wallCount ?? po.wallCount ?? 3} walls · {cp.nozzleDiameterMm ?? po.nozzleDiameterMm ?? 0.4} mm · {cp.printSpeedMmS ?? po.printSpeedMmS ?? 60} mm/s
                            </span>
                          </div>
                          <div>
                            <span className="text-[#263746]/70 block font-sans">Orientation / Scale / Supports</span>
                            <span className="font-semibold text-[#123B5D]">
                              {cp.buildOrientation ?? po.buildOrientation ?? 'Auto Optimal'} · {cp.scalePercent ?? po.scalePercent ?? 100}% · {(cp.supportEnabled ?? po.supportEnabled) ? 'Supports Yes' : 'Supports No'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#263746]/70 block font-sans">Quantity / Finishing</span>
                            <span className="font-semibold text-[#123B5D]">
                              {cp.quantity ?? po.quantity} · {cp.finishingOption || po.finishingOption}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#263746]/70 block font-sans">Dimensions / Volume / Mass</span>
                            <span className="font-semibold text-[#123B5D]">
                              {dims ? `${dims.x}×${dims.y}×${dims.z} mm` : 'Pending'} · {po.volumeCm3} cm³ · {po.estimatedWeightG} g
                            </span>
                          </div>
                        </div>
                        {po.specialInstructions && (
                          <div className="rounded-lg bg-white border border-[#DCEAF5] p-2.5 text-[#263746]">
                            <span className="font-semibold text-[#123B5D]">Customer Notes: </span>
                            {po.specialInstructions}
                          </div>
                        )}
                        {po.deliveryAddress && (
                          <div className="rounded-lg bg-white border border-[#DCEAF5] p-2.5 text-[#263746]">
                            <span className="font-semibold text-[#123B5D]">Delivery Address: </span>
                            {po.deliveryAddress.fullName},{' '}
                            {[
                              po.deliveryAddress.houseFlat,
                              po.deliveryAddress.streetArea,
                              (po.deliveryAddress as Record<string, any>).line1,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                            , {po.deliveryAddress.city}, {po.deliveryAddress.state} - {po.deliveryAddress.pinCode} ({po.deliveryAddress.mobile})
                          </div>
                        )}
                      </div>

                      {/* Right: Admin Confirmed Parameters & Dispatch Controls */}
                      <div className="rounded-xl border border-[#90CAF9] bg-white p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-display font-bold text-sm text-[#123B5D]">
                            Admin Confirmed Parameters &amp; Logistics
                          </h4>
                          {po.confirmedParameters?.confirmedBy && (
                            <span className="text-[11px] text-[#42A5F5] font-mono">
                              Confirmed by {po.confirmedParameters.confirmedBy}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[11px] text-[#263746]/70 mb-1">Material</label>
                            <input
                              value={ed.confirmedMaterialName}
                              onChange={(e) => patchOrderEdit(po.id, po, { confirmedMaterialName: e.target.value })}
                              className="w-full rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#263746]/70 mb-1">Layer (mm)</label>
                            <input
                              type="number"
                              step="0.05"
                              value={ed.confirmedLayerHeightMm}
                              onChange={(e) => patchOrderEdit(po.id, po, { confirmedLayerHeightMm: e.target.value })}
                              className="w-full rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#263746]/70 mb-1">Infill (%)</label>
                            <input
                              type="number"
                              value={ed.confirmedInfillPercent}
                              onChange={(e) => patchOrderEdit(po.id, po, { confirmedInfillPercent: e.target.value })}
                              className="w-full rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#263746]/70 mb-1">Walls</label>
                            <input
                              type="number"
                              value={ed.confirmedWallCount}
                              onChange={(e) => patchOrderEdit(po.id, po, { confirmedWallCount: e.target.value })}
                              className="w-full rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#263746]/70 mb-1">Nozzle (mm)</label>
                            <input
                              type="number"
                              step="0.1"
                              value={ed.confirmedNozzleDiameterMm}
                              onChange={(e) => patchOrderEdit(po.id, po, { confirmedNozzleDiameterMm: e.target.value })}
                              className="w-full rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#263746]/70 mb-1">Speed (mm/s)</label>
                            <input
                              type="number"
                              value={ed.confirmedPrintSpeedMmS}
                              onChange={(e) => patchOrderEdit(po.id, po, { confirmedPrintSpeedMmS: e.target.value })}
                              className="w-full rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <input
                            placeholder="Build Orientation"
                            value={ed.confirmedBuildOrientation}
                            onChange={(e) => patchOrderEdit(po.id, po, { confirmedBuildOrientation: e.target.value })}
                            className="rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                          />
                          <input
                            placeholder="Confirmed Finishing"
                            value={ed.confirmedFinishingOption}
                            onChange={(e) => patchOrderEdit(po.id, po, { confirmedFinishingOption: e.target.value })}
                            className="rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <input
                            placeholder="Courier (e.g. Delhivery)"
                            value={ed.trackingCourier}
                            onChange={(e) => patchOrderEdit(po.id, po, { trackingCourier: e.target.value })}
                            className="rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                          />
                          <input
                            placeholder="Tracking / AWB ID"
                            value={ed.trackingId}
                            onChange={(e) => patchOrderEdit(po.id, po, { trackingId: e.target.value })}
                            className="rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 font-mono text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                          />
                          <input
                            placeholder="Tracking URL"
                            value={ed.trackingUrl}
                            onChange={(e) => patchOrderEdit(po.id, po, { trackingUrl: e.target.value })}
                            className="rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                          />
                        </div>

                        <textarea
                          rows={2}
                          placeholder="Internal production notes / slicer profile observations..."
                          value={ed.productionNotes}
                          onChange={(e) => patchOrderEdit(po.id, po, { productionNotes: e.target.value })}
                          className="w-full rounded-lg border border-[#DCEAF5] bg-white px-2.5 py-1.5 text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                        />

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-[#263746] font-medium">
                            <input
                              type="checkbox"
                              checked={Boolean(ed.customerDownloadEnabled)}
                              onChange={(e) =>
                                patchOrderEdit(po.id, po, { customerDownloadEnabled: e.target.checked })
                              }
                              className="accent-[#64B5F6]"
                            />
                            Allow customer self-download once payment verified
                          </label>
                          <button
                            type="button"
                            disabled={savingId === po.id}
                            onClick={() => handleSaveOrder(po, true)}
                            className="px-4 py-2 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold inline-flex items-center gap-1.5 transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {savingId === po.id ? 'Saving...' : 'Confirm Parameters & Save'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Separate Sliced / Production Files Vault */}
                    <div className="rounded-xl border border-[#DCEAF5] bg-[#F0F8FF]/60 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="font-display font-bold text-sm text-[#123B5D]">
                            Separate Production &amp; Sliced Files (Original File Never Overwritten)
                          </h4>
                          <p className="text-[#263746]/70">
                            Upload internal G-code (.gcode/.bgcode), repaired STL/3MF, or machine profile archives separately.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <select
                          value={prodDraft.fileKind}
                          onChange={(e) =>
                            setProdUploadForm((prev) => ({
                              ...prev,
                              [po.id]: { ...prodDraft, fileKind: e.target.value },
                            }))
                          }
                          className="rounded-lg border border-[#DCEAF5] px-2.5 py-1.5 bg-white text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                        >
                          <option value="sliced_gcode">Sliced G-code / Machine Job</option>
                          <option value="repaired_mesh">Repaired / Oriented CAD Mesh</option>
                          <option value="production_notes">Production Setup Package</option>
                        </select>
                        <input
                          type="file"
                          accept=".gcode,.gco,.bgcode,.3mf,.stl,.obj,.step,.stp,.zip,.pdf"
                          onChange={(e) =>
                            setProdUploadForm((prev) => ({
                              ...prev,
                              [po.id]: { ...prodDraft, file: e.target.files?.[0] || null },
                            }))
                          }
                          className="text-xs file:mr-2 file:py-1 file:px-3 file:rounded-md file:border file:border-[#90CAF9] file:bg-white file:text-[#123B5D]"
                        />
                        <input
                          placeholder="Notes (e.g. Bambu X1C 0.2mm PLA profile)"
                          value={prodDraft.notes}
                          onChange={(e) =>
                            setProdUploadForm((prev) => ({
                              ...prev,
                              [po.id]: { ...prodDraft, notes: e.target.value },
                            }))
                          }
                          className="flex-1 min-w-[200px] rounded-lg border border-[#DCEAF5] px-2.5 py-1.5 bg-white text-[#263746] focus:outline-none focus:border-[#64B5F6]"
                        />
                        <button
                          type="button"
                          disabled={uploadingProdId === po.id || !prodDraft.file}
                          onClick={() => handleUploadProductionFile(po)}
                          className="px-3.5 py-1.5 bg-[#64B5F6] hover:bg-[#42A5F5] text-white rounded-lg font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {uploadingProdId === po.id ? 'Uploading...' : 'Upload Production File'}
                        </button>
                      </div>

                      {(po.productionFiles || []).length > 0 && (
                        <div className="divide-y divide-[#DCEAF5] rounded-lg border border-[#DCEAF5] bg-white">
                          {(po.productionFiles || []).map((pf) => (
                            <div
                              key={pf.id}
                              className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
                            >
                              <div>
                                <span className="font-mono font-semibold text-[#123B5D]">
                                  {pf.fileName}
                                </span>{' '}
                                <span className="text-[#263746]/70">
                                  ({pf.fileKind} · {(pf.fileSizeBytes / 1024).toFixed(1)} KB · by {pf.uploadedBy})
                                </span>
                                {pf.notes && <div className="text-[#263746]/80">{pf.notes}</div>}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDownloadProductionFile(po.id, pf.id, pf.fileName)}
                                className="px-3 py-1.5 border border-[#90CAF9] bg-white hover:bg-[#F0F8FF] text-[#123B5D] rounded-lg font-semibold inline-flex items-center gap-1 transition-colors"
                              >
                                <Truck className="w-3 h-3 hidden" />
                                <Download className="w-3.5 h-3.5 text-[#42A5F5]" /> Download
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Download Security Audit Logs */}
                    <div className="rounded-xl border border-[#DCEAF5] bg-white p-4 space-y-2">
                      <h4 className="font-display font-bold text-sm text-[#123B5D]">
                        File Access &amp; Security Audit Trail
                      </h4>
                      {(!po.downloadLogs || po.downloadLogs.length === 0) ? (
                        <div className="text-[#263746]/70">No file download attempts logged for this order yet.</div>
                      ) : (
                        <div className="max-h-44 overflow-y-auto divide-y divide-[#DCEAF5]/60 font-mono text-[11px]">
                          {po.downloadLogs.map((log) => (
                            <div key={log.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <span
                                  className={`font-bold ${
                                    log.accessGranted ? 'text-[#42A5F5]' : 'text-red-700'
                                  }`}
                                >
                                  {log.accessGranted ? 'GRANTED' : 'BLOCKED'}
                                </span>{' '}
                                · {log.fileKind} · {log.actorEmail} ({log.actorRole})
                                {log.denialReason ? ` — ${log.denialReason}` : ''}
                              </div>
                              <span className="text-[#263746]/60">
                                {new Date(log.createdAt).toLocaleString('en-IN')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Payment-Verified 3D Preview Modal */}
      {previewState && (
        <div className="fixed inset-0 z-50 bg-[#123B5D]/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-5 space-y-4 shadow-2xl border border-[#DCEAF5]">
            <div className="flex items-center justify-between border-b border-[#DCEAF5] pb-3">
              <div>
                <div className="font-mono text-xs text-[#42A5F5]">
                  {previewState.order.orderNumber} · {previewState.order.materialName} ({previewState.order.colorName})
                </div>
                <h3 className="font-display font-bold text-lg text-[#123B5D]">
                  3D CAD Model Preview — {previewState.order.fileName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewState(null)}
                className="p-2 rounded-lg border border-[#DCEAF5] hover:bg-[#F0F8FF] text-[#123B5D]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {previewState.loading ? (
              <div className="h-[360px] flex items-center justify-center text-sm text-[#263746]/80">
                Verifying payment lock and loading authenticated CAD geometry...
              </div>
            ) : previewState.error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
                {previewState.error}
              </div>
            ) : (
              <ModelViewer3D
                file={null}
                remoteModel={
                  previewState.buffer
                    ? { name: previewState.order.fileName, buffer: previewState.buffer }
                    : null
                }
                colorHex="#42A5F5"
                dimensionsMm={previewState.order.boundingBoxMm || null}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
