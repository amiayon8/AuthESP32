-- ============================================================================
-- ESP32 TOTP Authenticator Platform - Database Schema
-- ============================================================================
-- This file creates the complete database schema for the ESP32 TOTP Authenticator
-- Run against a fresh Supabase PostgreSQL database
-- ============================================================================

-- ============================================================================
-- SCHEMA SETUP
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS authenticator;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

SET search_path TO authenticator, public, extensions;

-- ============================================================================
-- ENUMS
-- ============================================================================
CREATE TYPE authenticator.totp_algorithm AS ENUM ('SHA1', 'SHA256', 'SHA512');
CREATE TYPE authenticator.audit_action AS ENUM (
    'device_created',
    'device_revoked',
    'device_reactivated',
    'api_key_rotated',
    'account_created',
    'account_updated',
    'account_deleted',
    'account_enabled',
    'account_disabled',
    'secret_replaced',
    'account_assigned',
    'account_unassigned',
    'device_sync',
    'failed_device_auth',
    'user_login',
    'user_logout',
    'password_changed'
);
CREATE TYPE authenticator.audit_result AS ENUM ('success', 'failure');

-- ============================================================================
-- TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles - Links Supabase Auth users to application data
-- ----------------------------------------------------------------------------
CREATE TABLE authenticator.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- devices - ESP32 hardware authenticators
-- ----------------------------------------------------------------------------
CREATE TABLE authenticator.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES authenticator.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    device_identifier TEXT NOT NULL UNIQUE,
    api_key_hash BYTEA NOT NULL UNIQUE,
    api_key_prefix TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    revoked_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    config_version INTEGER NOT NULL DEFAULT 1,
    sync_failure_count INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT devices_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
    CONSTRAINT devices_identifier_length CHECK (char_length(device_identifier) BETWEEN 1 AND 64),
    CONSTRAINT devices_prefix_length CHECK (char_length(api_key_prefix) BETWEEN 8 AND 16)
);

-- ----------------------------------------------------------------------------
-- totp_accounts - TOTP account metadata (no secrets)
-- ----------------------------------------------------------------------------
CREATE TABLE authenticator.totp_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES authenticator.profiles(id) ON DELETE CASCADE,
    device_id UUID REFERENCES authenticator.devices(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    issuer TEXT,
    account_label TEXT,
    algorithm authenticator.totp_algorithm NOT NULL DEFAULT 'SHA1',
    digits INTEGER NOT NULL DEFAULT 6,
    period INTEGER NOT NULL DEFAULT 30,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT totp_accounts_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
    CONSTRAINT totp_accounts_issuer_length CHECK (char_length(issuer) <= 100),
    CONSTRAINT totp_accounts_label_length CHECK (char_length(account_label) <= 100),
    CONSTRAINT totp_accounts_digits CHECK (digits IN (6, 8)),
    CONSTRAINT totp_accounts_period CHECK (period > 0 AND period <= 300),
    CONSTRAINT totp_accounts_sort_order CHECK (sort_order >= 0)
);

-- ----------------------------------------------------------------------------
-- totp_secrets - Encrypted TOTP secrets (strictly controlled access)
-- ----------------------------------------------------------------------------
CREATE TABLE authenticator.totp_secrets (
    account_id UUID PRIMARY KEY REFERENCES authenticator.totp_accounts(id) ON DELETE CASCADE,
    ciphertext BYTEA NOT NULL,
    iv BYTEA NOT NULL,
    auth_tag BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT totp_secrets_iv_length CHECK (octet_length(iv) = 12),
    CONSTRAINT totp_secrets_auth_tag_length CHECK (octet_length(auth_tag) = 16)
);

-- ----------------------------------------------------------------------------
-- audit_logs - Security audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE authenticator.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES authenticator.profiles(id) ON DELETE SET NULL,
    device_id UUID REFERENCES authenticator.devices(id) ON DELETE SET NULL,
    account_id UUID REFERENCES authenticator.totp_accounts(id) ON DELETE SET NULL,
    action authenticator.audit_action NOT NULL,
    result authenticator.audit_result NOT NULL,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_devices_user_id ON authenticator.devices(user_id);
CREATE INDEX idx_devices_active ON authenticator.devices(user_id, active) WHERE active = TRUE;
CREATE INDEX idx_devices_last_seen ON authenticator.devices(last_seen_at DESC);
CREATE INDEX idx_totp_accounts_user_id ON authenticator.totp_accounts(user_id);
CREATE INDEX idx_totp_accounts_device_id ON authenticator.totp_accounts(device_id);
CREATE INDEX idx_totp_accounts_enabled ON authenticator.totp_accounts(device_id, enabled) WHERE enabled = TRUE;
CREATE INDEX idx_totp_accounts_sort_order ON authenticator.totp_accounts(device_id, sort_order);
CREATE INDEX idx_audit_logs_user_id ON authenticator.audit_logs(user_id);
CREATE INDEX idx_audit_logs_device_id ON authenticator.audit_logs(device_id);
CREATE INDEX idx_audit_logs_account_id ON authenticator.audit_logs(account_id);
CREATE INDEX idx_audit_logs_action ON authenticator.audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON authenticator.audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_user_created ON authenticator.audit_logs(user_id, created_at DESC);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- updated_at trigger function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION authenticator.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = authenticator, public, extensions, pg_temp;

-- ----------------------------------------------------------------------------
-- Audit log helper function (Fixed parameter order)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION authenticator.log_audit_event(
    p_action authenticator.audit_action,
    p_result authenticator.audit_result,
    p_user_id UUID DEFAULT NULL,
    p_device_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
    INSERT INTO authenticator.audit_logs (
        user_id, device_id, account_id, action, result, ip_address, user_agent, metadata
    )
    VALUES (
        p_user_id, p_device_id, p_account_id, p_action, p_result, p_ip_address, p_user_agent, p_metadata
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Audit logging failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = authenticator, public, extensions, pg_temp;

-- ----------------------------------------------------------------------------
-- Device sync function - atomically updates sync status
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION authenticator.record_device_sync(
    p_device_id UUID,
    p_success BOOLEAN,
    p_error_code TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    IF p_success THEN
        UPDATE authenticator.devices
        SET last_sync_at = NOW(),
            last_seen_at = NOW(),
            sync_failure_count = 0,
            last_error_code = NULL,
            config_version = config_version + 1
        WHERE id = p_device_id;
    ELSE
        UPDATE authenticator.devices
        SET last_seen_at = NOW(),
            sync_failure_count = sync_failure_count + 1,
            last_error_code = p_error_code
        WHERE id = p_device_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = authenticator, public, extensions, pg_temp;

-- ----------------------------------------------------------------------------
-- Get device accounts for ESP32 sync (server-side only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION authenticator.get_device_sync_accounts(p_device_id UUID)
RETURNS TABLE (
    name TEXT,
    secret TEXT
) AS $$
DECLARE
    v_device_user_id UUID;
    v_account RECORD;
BEGIN
    SELECT user_id INTO v_device_user_id
    FROM authenticator.devices
    WHERE id = p_device_id
      AND active = TRUE
      AND revoked_at IS NULL;
    
    IF v_device_user_id IS NULL THEN
        RETURN;
    END IF;
    
    FOR v_account IN
        SELECT a.id, a.name, a.issuer, a.account_label, a.algorithm, a.digits, a.period,
               s.ciphertext, s.iv, s.auth_tag
        FROM authenticator.totp_accounts a
        JOIN authenticator.totp_secrets s ON s.account_id = a.id
        WHERE a.device_id = p_device_id
          AND a.enabled = TRUE
          AND a.user_id = v_device_user_id
        ORDER BY a.sort_order, a.created_at
    LOOP
        RETURN QUERY SELECT v_account.name, ''::TEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = authenticator, public, extensions, pg_temp;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON authenticator.profiles
    FOR EACH ROW EXECUTE FUNCTION authenticator.update_updated_at_column();

CREATE TRIGGER trigger_devices_updated_at
    BEFORE UPDATE ON authenticator.devices
    FOR EACH ROW EXECUTE FUNCTION authenticator.update_updated_at_column();

CREATE TRIGGER trigger_totp_accounts_updated_at
    BEFORE UPDATE ON authenticator.totp_accounts
    FOR EACH ROW EXECUTE FUNCTION authenticator.update_updated_at_column();

CREATE TRIGGER trigger_totp_secrets_updated_at
    BEFORE UPDATE ON authenticator.totp_secrets
    FOR EACH ROW EXECUTE FUNCTION authenticator.update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all user-owned tables
ALTER TABLE authenticator.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE authenticator.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE authenticator.totp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE authenticator.totp_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE authenticator.audit_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- profiles policies
-- ----------------------------------------------------------------------------
CREATE POLICY "profiles_select_own" ON authenticator.profiles
    FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_update_own" ON authenticator.profiles
    FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ----------------------------------------------------------------------------
-- devices policies
-- ----------------------------------------------------------------------------
CREATE POLICY "devices_select_own" ON authenticator.devices
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "devices_insert_own" ON authenticator.devices
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "devices_update_own" ON authenticator.devices
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "devices_delete_own" ON authenticator.devices
    FOR DELETE USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- totp_accounts policies
-- ----------------------------------------------------------------------------
CREATE POLICY "totp_accounts_select_own" ON authenticator.totp_accounts
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "totp_accounts_insert_own" ON authenticator.totp_accounts
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "totp_accounts_update_own" ON authenticator.totp_accounts
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "totp_accounts_delete_own" ON authenticator.totp_accounts
    FOR DELETE USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- totp_secrets policies - NO direct access from browser clients
-- Only accessible via service-role server client
-- ----------------------------------------------------------------------------
CREATE POLICY "totp_secrets_no_access" ON authenticator.totp_secrets
    FOR ALL USING (false) WITH CHECK (false);

-- ----------------------------------------------------------------------------
-- audit_logs policies
-- ----------------------------------------------------------------------------
CREATE POLICY "audit_logs_select_own" ON authenticator.audit_logs
    FOR SELECT USING (user_id = auth.uid());

-- ============================================================================
-- HELPER VIEWS (for application use)
-- ============================================================================

-- Device summary view for dashboard
CREATE OR REPLACE VIEW authenticator.device_summary AS
SELECT 
    d.id,
    d.user_id,
    d.name,
    d.device_identifier,
    d.api_key_prefix,
    d.active,
    d.revoked_at,
    d.last_sync_at,
    d.last_seen_at,
    d.config_version,
    d.sync_failure_count,
    d.last_error_code,
    d.created_at,
    d.updated_at,
    COUNT(a.id) FILTER (WHERE a.enabled = TRUE) AS active_account_count,
    COUNT(a.id) AS total_account_count
FROM authenticator.devices d
LEFT JOIN authenticator.totp_accounts a ON a.device_id = d.id
GROUP BY d.id;

-- Account summary view for dashboard (no secrets)
CREATE OR REPLACE VIEW authenticator.account_summary AS
SELECT 
    a.id,
    a.user_id,
    a.device_id,
    a.name,
    a.issuer,
    a.account_label,
    a.algorithm,
    a.digits,
    a.period,
    a.sort_order,
    a.enabled,
    a.created_at,
    a.updated_at,
    d.name AS device_name,
    d.api_key_prefix AS device_prefix
FROM authenticator.totp_accounts a
LEFT JOIN authenticator.devices d ON d.id = a.device_id;

-- ============================================================================
-- GRANTS AND PERMISSIONS
-- ============================================================================
GRANT USAGE ON SCHEMA authenticator TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA authenticator TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA authenticator TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA authenticator TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA authenticator GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA authenticator GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA authenticator GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE authenticator.profiles IS 'User profiles linked to Supabase Auth';
COMMENT ON TABLE authenticator.devices IS 'ESP32 hardware authenticator devices';
COMMENT ON TABLE authenticator.totp_accounts IS 'TOTP account metadata (no secrets)';
COMMENT ON TABLE authenticator.totp_secrets IS 'Encrypted TOTP secrets - access restricted to service role';
COMMENT ON TABLE authenticator.audit_logs IS 'Security audit trail for all sensitive operations';
COMMENT ON COLUMN authenticator.devices.api_key_hash IS 'SHA-256 hash of the device API key';
COMMENT ON COLUMN authenticator.devices.api_key_prefix IS 'First 8-12 chars of API key for identification';
COMMENT ON COLUMN authenticator.totp_secrets.ciphertext IS 'AES-256-GCM encrypted TOTP secret';
COMMENT ON COLUMN authenticator.totp_secrets.iv IS '12-byte initialization vector (nonce)';
COMMENT ON COLUMN authenticator.totp_secrets.auth_tag IS '16-byte authentication tag';