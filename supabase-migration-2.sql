-- Run in Supabase SQL editor after supabase-migration.sql

-- Secure function: looks up email for a given username.
-- SECURITY DEFINER lets it read auth.users without exposing it publicly.
CREATE OR REPLACE FUNCTION get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT au.email INTO v_email
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  WHERE lower(p.username) = lower(p_username)
  LIMIT 1;
  RETURN v_email;
END;
$$;
