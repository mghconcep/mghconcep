MARV'S GAMING HUB — ADMIN REPORTS

Purpose:
Separate responsive admin website for viewing reports saved by the Gaming Hub staff website in Supabase.

Supabase project:
https://fvxpfpqkdsznvvreicfc.supabase.co

How it works:
1. Staff website saves a report into gaming_reports and its child tables.
2. Admin website signs in with Supabase Auth.
3. Admin website loads report history from gaming_reports.
4. Clicking View report loads games, defects, PC status, inventory, spares, signoffs and follow-up information.
5. The existing admin_users table is checked when available using user_id = auth.uid(). Database RLS should remain the final security control.

IMPORTANT:
- Create the admin account in Supabase Authentication.
- Add that Auth user's UUID to public.admin_users.user_id if you want the admin_users gate enforced.
- Do not place a Supabase secret/service-role key in this website.
- The browser uses only the publishable key.

If the report list is empty or a 401/403 error appears, check the Supabase Data API exposure, grants and RLS policies for the Gaming Hub tables.
