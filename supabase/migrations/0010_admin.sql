-- Migration: 0010_admin
-- Phase 10: Super Admin Panel and Employee Bots
-- Adds delete_vault_secret SECURITY DEFINER function for orphan cleanup.
-- Called by provisionBots Server Action when hotel_bots INSERT fails after
-- a successful Vault secret insert — prevents orphaned secrets accumulating.

-- =============================================================================
-- delete_vault_secret: deletes a Vault secret by UUID
-- Called by admin provisioning Server Action on failure after Vault insert
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_vault_secret(p_vault_secret_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_vault_secret_id;
END;
$$;

-- Restrict execution: revoke from PUBLIC, anon, authenticated; grant to service_role only.
REVOKE EXECUTE ON FUNCTION public.delete_vault_secret(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_vault_secret(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_vault_secret(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_vault_secret(UUID) TO service_role;
