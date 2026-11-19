import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { payments, printingFileDownloadLogs, printingOrders } from '../db/schema.ts';
import { ensureUploadDirs, logAudit, UPLOADS_ROOT } from './utils.ts';

export const ALLOWED_ORIGINAL_3D_EXTS = ['.stl', '.obj', '.3mf', '.step', '.stp', '.iges', '.igs'];

export const REJECTED_SLICED_3D_EXTS = [
  '.gcode',
  '.gco',
  '.g',
  '.bgcode',
  '.gx',
  '.x3g',
  '.ctb',
  '.goo',
  '.pwmo',
  '.sl1',
  '.sl1s',
  '.photon',
  '.cxdlp',
  '.cbddlp',
  '.pwms',
  '.pw0',
  '.pwmx',
  '.rzd',
  '.fpp',
];

export const PRINTING_ORDER_STATUSES = [
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
] as const;

export const ALLOWED_PRODUCTION_3D_EXTS = [
  '.gcode',
  '.gco',
  '.bgcode',
  '.3mf',
  '.stl',
  '.obj',
  '.step',
  '.stp',
  '.zip',
  '.pdf',
  '.txt',
];

export function createOriginal3DModelUploadMiddleware(maxSizeMb = 80) {
  ensureUploadDirs();
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(UPLOADS_ROOT, '3d-models'));
    },
    filename: (_req, file, cb) => {
      const safeBase = path
        .basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 48);
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeBase}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (REJECTED_SLICED_3D_EXTS.includes(ext)) {
        cb(
          new Error(
            `Sliced printer files (${ext}) are not accepted. Please upload an original 3D CAD design file (.STL, .OBJ, .3MF, .STEP/.STP, or .IGES/.IGS).`
          )
        );
        return;
      }
      if (!ALLOWED_ORIGINAL_3D_EXTS.includes(ext)) {
        cb(
          new Error(
            `Unsupported 3D file format '${ext}'. Allowed original 3D CAD formats: STL, OBJ, 3MF, STEP/STP, IGES/IGS.`
          )
        );
        return;
      }
      cb(null, true);
    },
  });
}

export function createProduction3DFileUploadMiddleware(maxSizeMb = 100) {
  ensureUploadDirs();
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(UPLOADS_ROOT, '3d-production'));
    },
    filename: (_req, file, cb) => {
      const safeBase = path
        .basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 48);
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeBase}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_PRODUCTION_3D_EXTS.includes(ext)) {
        cb(
          new Error(
            `Unsupported production file '${ext}'. Allowed: ${ALLOWED_PRODUCTION_3D_EXTS.join(', ')}`
          )
        );
        return;
      }
      cb(null, true);
    },
  });
}

export function runSingleUploadWithJsonErrors(
  middleware: multer.Multer,
  fieldName: string
) {
  const single = middleware.single(fieldName);
  return (req: Request, res: Response, next: NextFunction) => {
    single(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({
          error: err?.message || 'Invalid file upload.',
        });
      }
      next();
    });
  };
}

export interface DownloadVerificationResult {
  allowed: boolean;
  reason: string;
  order: typeof printingOrders.$inferSelect | null;
}

/**
 * Authoritative backend verification for 3D design download eligibility.
 * Enforced identically for BOTH customers and administrators:
 * - Payment status MUST be 'paid'
 * - Refund status MUST be 'none' (blocked on partial, full, cancelled, failed, pending)
 * - Total INR must be > 0
 * - At least one verified/captured Razorpay payment record (or order.razorpayPaymentId) with no refund
 */
export async function verifyPrintingOrderDownloadAccess(
  orderId: number
): Promise<DownloadVerificationResult> {
  const [order] = await db
    .select()
    .from(printingOrders)
    .where(eq(printingOrders.id, orderId))
    .limit(1);

  if (!order) {
    return { allowed: false, reason: '3D printing order not found.', order: null };
  }

  const refundStatus = String(order.refundStatus || 'none').toLowerCase();
  if (refundStatus === 'full' || refundStatus === 'partial') {
    return {
      allowed: false,
      reason: `Original 3D file access revoked because payment was ${refundStatus === 'full' ? 'refunded' : 'partially refunded'}.`,
      order,
    };
  }

  const pStatus = String(order.paymentStatus || 'pending').toLowerCase();
  if (pStatus !== 'paid') {
    const labelMap: Record<string, string> = {
      pending: 'Payment Pending — full verified Razorpay payment is required before original 3D file download.',
      partial: 'Partial Payment only — full payment verification is required before original 3D file download.',
      failed: 'Payment Failed — original 3D file download is locked until full verified payment is completed.',
      cancelled: 'Payment Cancelled — original 3D file download is locked.',
      refunded: 'Payment Refunded — original 3D file download access has been revoked.',
      partially_refunded: 'Payment Partially Refunded — original 3D file download is locked.',
    };
    return {
      allowed: false,
      reason: labelMap[pStatus] || `Original 3D file download requires full verified payment (current status: ${order.paymentStatus}).`,
      order,
    };
  }

  if (order.orderStatus === 'Cancelled') {
    return {
      allowed: false,
      reason: 'Order has been cancelled; original 3D file download is locked.',
      order,
    };
  }

  if (!order.totalInr || order.totalInr <= 0) {
    return {
      allowed: false,
      reason: 'Order total is invalid or unquoted; verified payment is required.',
      order,
    };
  }

  const orderPayments = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.entityType, 'printing_order'),
        eq(payments.entityId, order.id)
      )
    );

  const hasRefundedPayment = orderPayments.some(
    (p) =>
      p.status === 'refunded' ||
      p.status === 'partially_refunded' ||
      p.refundStatus === 'full' ||
      p.refundStatus === 'partial'
  );
  if (hasRefundedPayment) {
    return {
      allowed: false,
      reason: 'A refund or reversal was recorded for this order; original 3D file download access is locked.',
      order,
    };
  }

  const verifiedPayments = orderPayments.filter(
    (p) => (p.status === 'verified' || p.status === 'captured') && (p.refundStatus === 'none' || !p.refundStatus)
  );
  const totalVerifiedInr = verifiedPayments.reduce((sum, p) => sum + Number(p.amountInr || 0), 0);

  const hasOrderPaymentRef = Boolean(order.razorpayPaymentId && order.razorpayPaymentId.trim().length > 0);
  if (verifiedPayments.length === 0 && !hasOrderPaymentRef) {
    return {
      allowed: false,
      reason: 'Verified Razorpay transaction proof is missing for this order.',
      order,
    };
  }

  if (verifiedPayments.length > 0 && totalVerifiedInr < order.totalInr) {
    return {
      allowed: false,
      reason: `Partial payment recorded (₹${totalVerifiedInr} of ₹${order.totalInr}). Full verified payment is required to unlock original 3D file download.`,
      order,
    };
  }

  return { allowed: true, reason: '', order };
}

export async function recordPrintingDownloadLog(params: {
  printingOrderId: number;
  orderNumber: string;
  userId?: number | null;
  actorUid?: string;
  actorEmail: string;
  actorRole: string;
  fileKind: 'original' | 'production' | 'spec_sheet';
  fileName: string;
  accessGranted: boolean;
  denialReason?: string;
  ipAddress?: string;
}) {
  try {
    await db.insert(printingFileDownloadLogs).values({
      printingOrderId: params.printingOrderId,
      orderNumber: params.orderNumber,
      userId: params.userId ?? null,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      fileKind: params.fileKind,
      fileName: params.fileName,
      accessGranted: params.accessGranted,
      denialReason: params.denialReason || '',
      ipAddress: params.ipAddress || '',
    });

    await logAudit({
      actorUid: params.actorUid || params.actorEmail,
      actorEmail: params.actorEmail,
      action: params.accessGranted
        ? `3DP_FILE_DOWNLOAD_${params.fileKind.toUpperCase()}`
        : `3DP_FILE_DOWNLOAD_DENIED_${params.fileKind.toUpperCase()}`,
      entityType: 'printing_order',
      entityId: params.printingOrderId,
      details: {
        orderNumber: params.orderNumber,
        fileName: params.fileName,
        actorRole: params.actorRole,
        accessGranted: params.accessGranted,
        denialReason: params.denialReason || '',
      },
    });
  } catch (err) {
    console.error('Failed to log 3D print file download attempt:', err);
  }
}
