-- =============================================================
-- FIX EXPERT APPROVAL RPC: SYNCHRONIZE ROLE TO AUTH.USERS
-- =============================================================

-- Update the expert approval RPC to ALSO update auth.users metadata so that sessions sync correctly.
-- This ensures the frontend doesn't default to 'user' when loading the session.
CREATE OR REPLACE FUNCTION public.approve_expert_application(
  target_app_id BIGINT,
  target_reviewer_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  -- 1. Security Check
  IF NOT public.is_admin_or_moderator() THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  -- 2. Update Profile Role
  UPDATE public.profiles
  SET 
    role = CASE 
      WHEN (SELECT applied_roles[1] FROM public.creator_applications WHERE id = target_app_id) = 'mains_expert' THEN 'mains_expert' 
      WHEN (SELECT applied_roles[1] FROM public.creator_applications WHERE id = target_app_id) = 'mentor' THEN 'mains_expert'
      ELSE 'prelims_expert' 
    END,
    is_verified = TRUE
  WHERE id = (SELECT user_id FROM public.creator_applications WHERE id = target_app_id);

  -- 3. Update auth.users metadata directly (Requires SUPERUSER privileges, meaning SECURITY DEFINER and execution by Supabase admin)
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) || jsonb_build_object('role', (
    SELECT role FROM public.profiles WHERE id = (SELECT user_id FROM public.creator_applications WHERE id = target_app_id)
  ))
  WHERE id = (SELECT auth_user_id FROM public.profiles WHERE id = (SELECT user_id FROM public.creator_applications WHERE id = target_app_id));

  -- 4. Update Application Status
  UPDATE public.creator_applications
  SET 
    status = 'approved',
    reviewer_note = target_reviewer_note,
    reviewed_at = NOW(),
    reviewed_by = (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1)
  WHERE id = target_app_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
