-- MARV'S GAMING HUB ADMIN SECURITY
-- Run this in Supabase SQL Editor after confirming public.admin_users.user_id contains the UUIDs of allowed admins.
-- This script only targets the Gaming Hub report tables.

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('gaming_reports','report_games','report_defects','report_pc_status','report_inventory','report_spares','report_signoffs')
  LOOP
    EXECUTE format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- RLS
ALTER TABLE public.gaming_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_pc_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_spares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_signoffs ENABLE ROW LEVEL SECURITY;

-- Admin users can read all Gaming Hub reports.
CREATE POLICY gaming_admin_read_reports
ON public.gaming_reports FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()));

CREATE POLICY gaming_admin_read_games
ON public.report_games FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()));

CREATE POLICY gaming_admin_read_defects
ON public.report_defects FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()));

CREATE POLICY gaming_admin_read_pc_status
ON public.report_pc_status FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()));

CREATE POLICY gaming_admin_read_inventory
ON public.report_inventory FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()));

CREATE POLICY gaming_admin_read_spares
ON public.report_spares FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()));

CREATE POLICY gaming_admin_read_signoffs
ON public.report_signoffs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()));

-- NOTE:
-- Keep the staff site's INSERT policies separately according to your chosen staff authentication model.
-- Do not add public/anon SELECT policies to these report tables.
