-- MARV'S GAMING HUB - INVENTORY COMPATIBILITY FIX
-- Run this ONCE in Supabase SQL Editor.
-- This keeps the brand column for backward compatibility, but allows the
-- current brand-independent peripheral count UI to save all 5 peripheral types.

ALTER TABLE public.report_inventory
  DROP CONSTRAINT IF EXISTS report_inventory_peripheral_type_check;

ALTER TABLE public.report_inventory
  ADD CONSTRAINT report_inventory_peripheral_type_check
  CHECK (peripheral_type IN ('Keyboard', 'Mouse', 'Headset', 'Monitor', 'Power Cord'));

-- The current frontend does not use fixed brands. Existing schema may still
-- require brand to be non-null, so the frontend sends an empty string.
-- No brand data is displayed in the report.
