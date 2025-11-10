-- Ensure required extensions exist
create extension if not exists "pgcrypto";

-- Helper function to keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Registry table for custom MCP gateways
create table public.mcp_servers (
  id text primary key default 'srv_' || substr(md5((clock_timestamp())::text || random()::text), 1, 12),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  gateway_url text not null,
  auth_type text not null check (auth_type in ('none', 'api_key', 'oauth')),
  auth_secret bytea,
  is_active boolean not null default true,
  last_health_check timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_user_server_name unique (user_id, name)
);

create trigger set_mcp_servers_updated_at
before update on public.mcp_servers
for each row execute procedure public.set_updated_at();

comment on table public.mcp_servers is 'User-registered MCP gateway definitions.';
comment on column public.mcp_servers.auth_secret is 'Encrypted credentials required for the gateway (optional).';

-- Row Level Security
alter table public.mcp_servers enable row level security;

create policy "Select own MCP servers"
  on public.mcp_servers
  for select
  using (auth.uid() = user_id);

create policy "Insert own MCP servers"
  on public.mcp_servers
  for insert
  with check (auth.uid() = user_id);

create policy "Update own MCP servers"
  on public.mcp_servers
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Delete own MCP servers"
  on public.mcp_servers
  for delete
  using (auth.uid() = user_id);
