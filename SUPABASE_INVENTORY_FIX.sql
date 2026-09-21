-- MARV'S GAMING HUB - INVENTORY CONSTRAINT FIX
-- Run this once in the Supabase SQL Editor.
-- The current Overall Peripheral Count uses these five peripheral types.

ALTER TABLE public.report_inventory
  DROP CONSTRAINT IF EXISTS report_inventory_peripheral_type_check;

ALTER TABLE public.report_inventory
  ADD CONSTRAINT report_inventory_peripheral_type_check
  CHECK (peripheral_type IN (
    'Keyboard',
    'Mouse',
    'Headset',
    'Monitor',
    'Power Cord'
  ));

-- The frontend no longer uses fixed brands, but the existing brand column
-- may still be NOT NULL. The frontend therefore saves an empty string ('')
-- for brand so the existing schema remains compatible.
