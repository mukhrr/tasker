-- The sniper subscribes to user_settings changes (auto-post / auto-pilot
-- toggles, watch config) instead of polling them every second.
alter publication supabase_realtime add table public.user_settings;
