-- ============================================================================
-- NEXUSTEKFUSION PRIVATE LIMITED — 3D Printing File Storage, Parameter Lock
-- & Payment-Gated Original File Access Schema Migration
-- Idempotent PostgreSQL / Supabase Migration
-- ============================================================================

-- 1. Extend printing_orders with complete metadata, immutable customer snapshot,
--    confirmed parameters, and verified payment/refund tracking.
ALTER TABLE IF EXISTS public.printing_orders
  ADD COLUMN IF NOT EXISTS file_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS storage_bucket text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS printer_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS wall_count integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS print_speed_mm_s integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS nozzle_diameter_mm double precision NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS build_orientation text NOT NULL DEFAULT 'Auto Optimal',
  ADD COLUMN IF NOT EXISTS scale_percent integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS customer_parameters jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS confirmed_parameters jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS customer_download_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz NOT NULL DEFAULT now();

-- 2. Separate Production / Sliced File Storage Table (never overwrites original file)
CREATE TABLE IF NOT EXISTS public."3d_printing_production_files" (
  id serial PRIMARY KEY,
  printing_order_id integer NOT NULL REFERENCES public.printing_orders(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_format text NOT NULL,
  file_size_bytes integer NOT NULL DEFAULT 0,
  file_storage_path text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'printing-files',
  file_kind text NOT NULL DEFAULT 'sliced_gcode', -- sliced_gcode | converted_mesh | production_notes
  notes text NOT NULL DEFAULT '',
  uploaded_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_3dp_production_files_order
  ON public."3d_printing_production_files" (printing_order_id, created_at DESC);

-- 3. Immutable Download Audit Trail Table
CREATE TABLE IF NOT EXISTS public.printing_file_download_logs (
  id serial PRIMARY KEY,
  printing_order_id integer NOT NULL REFERENCES public.printing_orders(id) ON DELETE CASCADE,
  order_number text NOT NULL DEFAULT '',
  user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  actor_role text NOT NULL DEFAULT 'customer',
  file_kind text NOT NULL DEFAULT 'original', -- original | production | spec_sheet
  file_name text NOT NULL DEFAULT '',
  access_granted boolean NOT NULL DEFAULT false,
  denial_reason text NOT NULL DEFAULT '',
  ip_address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_3dp_download_logs_order
  ON public.printing_file_download_logs (printing_order_id, created_at DESC);

-- 4. Private Storage Bucket for Customer Original & Production 3D Files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'printing-files',
  'printing-files',
  false,
  83886080, -- 80 MB
  ARRAY[
    'application/octet-stream',
    'model/stl',
    'application/vnd.ms-pki.stl',
    'model/obj',
    'text/plain',
    'model/3mf',
    'application/zip',
    'application/step',
    'model/step',
    'model/iges',
    'application/iges',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 83886080;

-- 5. Backend Helper Function for Payment Verification in PostgreSQL / RLS
CREATE OR REPLACE FUNCTION public.is_3dp_order_paid(p_order_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.printing_orders po
    WHERE po.id = p_order_id
      AND po.payment_status = 'paid'
      AND COALESCE(po.refund_status, 'none') = 'none'
      AND po.total_inr > 0
      AND (
        COALESCE(po.razorpay_payment_id, '') <> ''
        OR EXISTS (
          SELECT 1
          FROM public.payments pay
          WHERE pay.entity_type = 'printing_order'
            AND pay.entity_id = po.id
            AND pay.status IN ('verified', 'captured')
            AND COALESCE(pay.refund_status, 'none') = 'none'
        )
      )
  );
$$;

-- 6. Strict Row Level Security on 3D Printing Tables
ALTER TABLE public.printing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."3d_printing_production_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printing_file_download_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read own 3d orders" ON public.printing_orders;
CREATE POLICY "Customers read own 3d orders"
  ON public.printing_orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = printing_orders.user_id
        AND u.uid = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM public.users admin_u
      WHERE admin_u.uid = auth.uid()::text
        AND admin_u.role IN ('super_admin', 'operations_manager', 'accounts_manager')
        AND admin_u.is_active = true
    )
  );

DROP POLICY IF EXISTS "Customers insert own 3d orders unpaid" ON public.printing_orders;
CREATE POLICY "Customers insert own 3d orders unpaid"
  ON public.printing_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    payment_status = 'pending'
    AND COALESCE(refund_status, 'none') = 'none'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = printing_orders.user_id
        AND u.uid = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Admins manage 3d order production fields" ON public.printing_orders;
CREATE POLICY "Admins manage 3d order production fields"
  ON public.printing_orders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users admin_u
      WHERE admin_u.uid = auth.uid()::text
        AND admin_u.role IN ('super_admin', 'operations_manager', 'accounts_manager')
        AND admin_u.is_active = true
    )
  );

DROP POLICY IF EXISTS "Admins manage 3d production files" ON public."3d_printing_production_files";
CREATE POLICY "Admins manage 3d production files"
  ON public."3d_printing_production_files" FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users admin_u
      WHERE admin_u.uid = auth.uid()::text
        AND admin_u.role IN ('super_admin', 'operations_manager', 'accounts_manager')
        AND admin_u.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users admin_u
      WHERE admin_u.uid = auth.uid()::text
        AND admin_u.role IN ('super_admin', 'operations_manager', 'accounts_manager')
        AND admin_u.is_active = true
    )
  );

DROP POLICY IF EXISTS "Admins view 3d download logs" ON public.printing_file_download_logs;
CREATE POLICY "Admins view 3d download logs"
  ON public.printing_file_download_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users admin_u
      WHERE admin_u.uid = auth.uid()::text
        AND admin_u.role IN ('super_admin', 'operations_manager', 'accounts_manager')
        AND admin_u.is_active = true
    )
  );

-- 7. Strict Private Storage Bucket Policies (Zero Public Access; Signed URLs via Verified Backend)
DROP POLICY IF EXISTS "Deny public reads on printing-files" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users upload original 3d design" ON storage.objects;
CREATE POLICY "Authorized users upload original 3d design"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'printing-files'
    AND name LIKE 'original/%'
  );

DROP POLICY IF EXISTS "No direct unverified download of printing-files" ON storage.objects;
CREATE POLICY "No direct unverified download of printing-files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'printing-files'
    AND EXISTS (
      SELECT 1 FROM public.printing_orders po
      WHERE po.file_storage_path = storage.objects.name
        AND public.is_3dp_order_paid(po.id)
    )
  );
