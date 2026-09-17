-- Westlake Academy family dashboard (school-dashboard)
-- NEW TABLES ONLY. Do not drop, alter, or write into existing Flowboard / product tables.
-- Prefix: wla_ so these objects cannot collide with public.comments, public.notifications, public.tasks, etc.

CREATE TABLE IF NOT EXISTS public.wla_assignment_comments (
  id text PRIMARY KEY,
  assignment_id text NOT NULL,
  author text,
  author_key text,
  author_user_id text,
  author_photo text,
  role text,
  body text NOT NULL DEFAULT '',
  timestamp text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wla_assignment_comments_assignment_idx
  ON public.wla_assignment_comments (assignment_id, created_at);

CREATE TABLE IF NOT EXISTS public.wla_missing_acks (
  ack_key text PRIMARY KEY,
  assignment_id text NOT NULL,
  student text,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  acknowledged_by text,
  acknowledged_by_key text,
  acknowledged_by_user_id text,
  acknowledged_by_photo text,
  role text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wla_missing_acks_assignment_idx
  ON public.wla_missing_acks (assignment_id);

CREATE TABLE IF NOT EXISTS public.wla_notifications (
  id text PRIMARY KEY,
  type text,
  assignment_id text,
  title text,
  student text,
  author text,
  author_key text,
  message text,
  preview text,
  recipient_keys text[] NOT NULL DEFAULT '{}',
  audience text,
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wla_notifications_created_idx
  ON public.wla_notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS public.wla_read_state (
  user_key text NOT NULL,
  feed_key text NOT NULL,
  feed text,
  item_id text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, feed_key)
);

CREATE TABLE IF NOT EXISTS public.wla_done_overrides (
  assignment_id text PRIMARY KEY,
  done_override boolean NOT NULL DEFAULT false,
  user_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wla_assignment_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wla_missing_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wla_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wla_read_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wla_done_overrides ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wla_assignment_comments TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wla_missing_acks TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wla_notifications TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wla_read_state TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wla_done_overrides TO anon, authenticated, service_role;

DROP POLICY IF EXISTS wla_assignment_comments_family_all ON public.wla_assignment_comments;
CREATE POLICY wla_assignment_comments_family_all
  ON public.wla_assignment_comments
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS wla_missing_acks_family_all ON public.wla_missing_acks;
CREATE POLICY wla_missing_acks_family_all
  ON public.wla_missing_acks
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS wla_notifications_family_all ON public.wla_notifications;
CREATE POLICY wla_notifications_family_all
  ON public.wla_notifications
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS wla_read_state_family_all ON public.wla_read_state;
CREATE POLICY wla_read_state_family_all
  ON public.wla_read_state
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS wla_done_overrides_family_all ON public.wla_done_overrides;
CREATE POLICY wla_done_overrides_family_all
  ON public.wla_done_overrides
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
