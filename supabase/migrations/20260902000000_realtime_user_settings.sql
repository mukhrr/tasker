-- Clients subscribe to user_settings changes instead of polling them.
alter publication supabase_realtime add table public.user_settings;
