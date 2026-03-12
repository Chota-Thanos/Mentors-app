-- Phase 1 and 2 Zoom Integration

-- Create table for mentor zoom connections
create table if not exists mentor_zoom_connections (
  id bigint primary key generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade on update cascade,
  zoom_account_id text,
  zoom_user_id text,
  display_name text,
  email text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (user_id)
);

-- Drop old check constraints for call_provider
alter table mentorship_slots
  drop constraint if exists ck_mentorship_slots_call_provider;

alter table mentorship_sessions
  drop constraint if exists ck_mentorship_sessions_call_provider;

-- Add new constraints for call_provider including zoom_video_sdk
alter table mentorship_slots
  add constraint ck_mentorship_slots_call_provider
  check (call_provider in ('custom', 'zoom', 'zoom_video_sdk'));

alter table mentorship_sessions
  add constraint ck_mentorship_sessions_call_provider
  check (call_provider in ('custom', 'zoom', 'zoom_video_sdk'));

-- Add new provider columns to mentorship_sessions
alter table mentorship_sessions
  add column if not exists provider_session_id text,
  add column if not exists provider_host_url text,
  add column if not exists provider_join_url text,
  add column if not exists provider_payload jsonb default '{}'::jsonb,
  add column if not exists provider_error text,
  add column if not exists live_started_at timestamptz,
  add column if not exists live_ended_at timestamptz;
