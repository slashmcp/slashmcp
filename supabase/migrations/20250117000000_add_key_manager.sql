-- Key Manager Agent (KMA) Migration
-- Provides secure storage and management of API keys and MCP credentials

-- Ensure required extensions exist
create extension if not exists "pgcrypto";

-- API Keys table for storing encrypted API keys and MCP credentials
create table public.api_keys (
  id text primary key default 'key_' || substr(md5((clock_timestamp())::text || random()::text), 1, 12),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  key_type text not null check (key_type in ('api_key', 'mcp_key', 'oauth_token')),
  provider text not null, -- e.g., 'openai', 'anthropic', 'custom_mcp_server'
  encrypted_key bytea not null, -- Encrypted using pgcrypto
  is_active boolean not null default true,
  expires_at timestamptz, -- Optional expiration date
  last_used_at timestamptz, -- Track last usage for stale key detection
  usage_count bigint not null default 0,
  scope text, -- Intended scope/purpose of the key
  metadata jsonb default '{}'::jsonb, -- Additional metadata (e.g., rate limits, permissions)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_user_key_name unique (user_id, name)
);

create trigger set_api_keys_updated_at
before update on public.api_keys
for each row execute procedure public.set_updated_at();

comment on table public.api_keys is 'Encrypted API keys and MCP credentials managed by Key Manager Agent.';
comment on column public.api_keys.encrypted_key is 'Encrypted key value using pgcrypto pgp_sym_encrypt.';
comment on column public.api_keys.scope is 'Intended scope or purpose of the key (e.g., "read-only", "full-access", "mcp-server-auth").';

-- Audit log for all key management operations
create table public.key_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key_id text references public.api_keys(id) on delete set null,
  action text not null check (action in ('add', 'update', 'delete', 'retrieve', 'audit', 'check', 'rotate', 'disable', 'enable')),
  provider text,
  key_name text, -- Store name even if key is deleted
  details jsonb default '{}'::jsonb, -- Additional context (e.g., error messages, usage stats)
  ip_address inet, -- Optional: track source IP
  user_agent text, -- Optional: track user agent
  created_at timestamptz not null default now()
);

create index key_audit_log_user_id_idx on public.key_audit_log(user_id);
create index key_audit_log_key_id_idx on public.key_audit_log(key_id);
create index key_audit_log_action_idx on public.key_audit_log(action);
create index key_audit_log_created_at_idx on public.key_audit_log(created_at);

comment on table public.key_audit_log is 'Non-repudiable audit log of all key management operations.';

-- Row Level Security for api_keys
alter table public.api_keys enable row level security;

create policy "Select own API keys"
  on public.api_keys
  for select
  using (auth.uid() = user_id);

create policy "Insert own API keys"
  on public.api_keys
  for insert
  with check (auth.uid() = user_id);

create policy "Update own API keys"
  on public.api_keys
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Delete own API keys"
  on public.api_keys
  for delete
  using (auth.uid() = user_id);

-- Row Level Security for key_audit_log
alter table public.key_audit_log enable row level security;

create policy "Select own audit logs"
  on public.key_audit_log
  for select
  using (auth.uid() = user_id);

-- Function to encrypt a key value
-- Note: Encryption key should be set via Supabase secrets/vault
-- This function uses a session variable for the encryption key
create or replace function public.encrypt_key_value(
  key_value text,
  encryption_key text
)
returns bytea as $$
begin
  if encryption_key is null or encryption_key = '' then
    raise exception 'Encryption key cannot be empty';
  end if;
  return pgp_sym_encrypt(key_value, encryption_key);
end;
$$ language plpgsql security definer;

-- Function to decrypt a key value
create or replace function public.decrypt_key_value(
  encrypted_value bytea,
  encryption_key text
)
returns text as $$
begin
  if encryption_key is null or encryption_key = '' then
    raise exception 'Encryption key cannot be empty';
  end if;
  return pgp_sym_decrypt(encrypted_value, encryption_key);
end;
$$ language plpgsql security definer;

-- Function to log key management actions
create or replace function public.log_key_action(
  p_user_id uuid,
  p_action text,
  p_key_id text default null,
  p_provider text default null,
  p_key_name text default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid as $$
declare
  log_id uuid;
begin
  insert into public.key_audit_log (user_id, key_id, action, provider, key_name, details)
  values (p_user_id, p_key_id, p_action, p_provider, p_key_name, p_details)
  returning id into log_id;
  return log_id;
end;
$$ language plpgsql security definer;

-- Function to detect stale keys (not used in last N days)
create or replace function public.get_stale_keys(
  p_user_id uuid,
  p_days_threshold integer default 90
)
returns table (
  id text,
  name text,
  provider text,
  key_type text,
  last_used_at timestamptz,
  days_since_use bigint
) as $$
begin
  return query
  select
    ak.id,
    ak.name,
    ak.provider,
    ak.key_type,
    ak.last_used_at,
    extract(day from (now() - coalesce(ak.last_used_at, ak.created_at)))::bigint as days_since_use
  from public.api_keys ak
  where ak.user_id = p_user_id
    and ak.is_active = true
    and (
      ak.last_used_at is null
      or ak.last_used_at < now() - (p_days_threshold || ' days')::interval
    )
  order by coalesce(ak.last_used_at, ak.created_at) asc;
end;
$$ language plpgsql security definer;

-- Index for efficient stale key queries
create index api_keys_user_id_last_used_idx on public.api_keys(user_id, last_used_at) where is_active = true;
create index api_keys_user_id_provider_idx on public.api_keys(user_id, provider);
create index api_keys_expires_at_idx on public.api_keys(expires_at) where expires_at is not null;

