-- Migration: Add workflow tables for visual workflow builder
-- This enables storing multi-agent workflows with nodes, edges, and configurations

-- Workflows table: Stores the main workflow definitions
create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  is_template boolean not null default false,
  template_category text, -- e.g., "research", "analysis", "content"
  metadata jsonb, -- Additional workflow metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_user_workflow_name unique (user_id, name)
);

-- Workflow nodes: Individual steps/agents in a workflow
create table public.workflow_nodes (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  node_type text not null check (node_type in ('agent', 'tool', 'data', 'condition', 'merge', 'start', 'end')),
  label text not null,
  position_x numeric not null default 0,
  position_y numeric not null default 0,
  -- Node configuration (varies by type)
  config jsonb not null default '{}'::jsonb,
  -- For agent/tool nodes: which MCP server and command
  mcp_server_id text,
  mcp_command_name text,
  -- Execution order within workflow
  execution_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Workflow edges: Connections between nodes (data flow)
create table public.workflow_edges (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  source_node_id uuid not null references public.workflow_nodes(id) on delete cascade,
  target_node_id uuid not null references public.workflow_nodes(id) on delete cascade,
  -- Edge configuration
  condition text, -- Optional condition for conditional branches
  data_mapping jsonb, -- How to map output from source to input of target
  created_at timestamptz not null default now(),
  constraint no_self_loops check (source_node_id != target_node_id)
);

-- Workflow executions: Track workflow runs
create table public.workflow_executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  input_data jsonb, -- Input parameters for the workflow
  output_data jsonb, -- Final output from the workflow
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Node executions: Track individual node execution within a workflow run
create table public.node_executions (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.workflow_executions(id) on delete cascade,
  node_id uuid not null references public.workflow_nodes(id) on delete cascade,
  status text not null check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  input_data jsonb,
  output_data jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- Indexes for performance
create index idx_workflows_user_id on public.workflows(user_id);
create index idx_workflows_is_template on public.workflows(is_template) where is_template = true;
create index idx_workflow_nodes_workflow_id on public.workflow_nodes(workflow_id);
create index idx_workflow_edges_workflow_id on public.workflow_edges(workflow_id);
create index idx_workflow_edges_source on public.workflow_edges(source_node_id);
create index idx_workflow_edges_target on public.workflow_edges(target_node_id);
create index idx_workflow_executions_workflow_id on public.workflow_executions(workflow_id);
create index idx_workflow_executions_user_id on public.workflow_executions(user_id);
create index idx_node_executions_execution_id on public.node_executions(execution_id);
create index idx_node_executions_node_id on public.node_executions(node_id);

-- Helper function to keep updated_at fresh
create or replace function public.set_workflow_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Triggers for updated_at
create trigger set_workflows_updated_at
before update on public.workflows
for each row execute procedure public.set_workflow_updated_at();

create trigger set_workflow_nodes_updated_at
before update on public.workflow_nodes
for each row execute procedure public.set_workflow_updated_at();

-- Row Level Security (RLS)
alter table public.workflows enable row level security;
alter table public.workflow_nodes enable row level security;
alter table public.workflow_edges enable row level security;
alter table public.workflow_executions enable row level security;
alter table public.node_executions enable row level security;

-- RLS Policies for workflows
create policy "Users can view their own workflows"
  on public.workflows for select
  using (auth.uid() = user_id or is_template = true);

create policy "Users can create their own workflows"
  on public.workflows for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own workflows"
  on public.workflows for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own workflows"
  on public.workflows for delete
  using (auth.uid() = user_id);

-- RLS Policies for workflow_nodes (inherits from workflow ownership)
create policy "Users can view nodes of their workflows or templates"
  on public.workflow_nodes for select
  using (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_nodes.workflow_id
      and (w.user_id = auth.uid() or w.is_template = true)
    )
  );

create policy "Users can manage nodes of their workflows"
  on public.workflow_nodes for all
  using (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_nodes.workflow_id
      and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_nodes.workflow_id
      and w.user_id = auth.uid()
    )
  );

-- RLS Policies for workflow_edges (inherits from workflow ownership)
create policy "Users can view edges of their workflows or templates"
  on public.workflow_edges for select
  using (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_edges.workflow_id
      and (w.user_id = auth.uid() or w.is_template = true)
    )
  );

create policy "Users can manage edges of their workflows"
  on public.workflow_edges for all
  using (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_edges.workflow_id
      and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_edges.workflow_id
      and w.user_id = auth.uid()
    )
  );

-- RLS Policies for workflow_executions
create policy "Users can view their own executions"
  on public.workflow_executions for select
  using (auth.uid() = user_id);

create policy "Users can create their own executions"
  on public.workflow_executions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own executions"
  on public.workflow_executions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RLS Policies for node_executions (inherits from execution ownership)
create policy "Users can view node executions of their workflow runs"
  on public.node_executions for select
  using (
    exists (
      select 1 from public.workflow_executions e
      where e.id = node_executions.execution_id
      and e.user_id = auth.uid()
    )
  );

-- Comments for documentation
comment on table public.workflows is 'User-created and template workflows for multi-agent orchestration';
comment on table public.workflow_nodes is 'Individual nodes (agents, tools, data processors) within a workflow';
comment on table public.workflow_edges is 'Connections between workflow nodes defining data flow';
comment on table public.workflow_executions is 'Execution history for workflow runs';
comment on table public.node_executions is 'Execution history for individual nodes within a workflow run';

