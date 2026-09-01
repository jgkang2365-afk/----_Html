-- Staging schema drift repair: existing deployments can run this repeatedly without data loss.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mobile text;
