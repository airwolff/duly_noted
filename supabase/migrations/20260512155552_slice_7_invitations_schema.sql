-- Slice 7 — email-keyed invitations + auth.users trigger + admin RPCs.
-- Backwards-compatible with deployed worker and web app: additive new
-- table, additive new functions, additive new policies. No mutations to
-- existing tables, no changes to existing RLS or grants.

-- 1. invitations table.
create table public.invitations (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null check (email = lower(email)),
  publication_id      uuid not null references public.publications(id) on delete cascade,
  role                text not null check (role in ('reader', 'editor', 'admin')),
  invited_by_user_id  uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '7 days'),
  accepted_at         timestamptz,
  revoked_at          timestamptz
);

comment on table public.invitations is
  'Slice 7: email-keyed pending memberships, resolved into public.memberships at first sign-in by handle_new_auth_user trigger or by resolve_pending_invitations RPC at session establishment.';

-- 2. Indexes.
create unique index invitations_open_email_pub_unique_idx
  on public.invitations (email, publication_id)
  where accepted_at is null and revoked_at is null;

create index invitations_publication_id_idx
  on public.invitations (publication_id);

-- 3. RLS.
alter table public.invitations enable row level security;

create policy "service_role full access invitations"
  on public.invitations for all to service_role
  using (true) with check (true);

create policy "authenticated admin select invitations"
  on public.invitations for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.publication_id = invitations.publication_id
        and m.role = 'admin'
    )
  );

-- 4. Trigger function: resolve open invitations into memberships at
--    auth.users INSERT. SECURITY DEFINER so it can write public.memberships
--    while running under supabase_auth_admin's identity.
--
--    MANDATORY EXCEPTION WHEN OTHERS wrapper per CLAUDE.md §6: any unhandled
--    exception inside an auth.users trigger rolls back the auth subsystem's
--    INSERT and blocks signup with a misleading "Database error saving new
--    user" response. Failure to perform the membership-resolution side
--    effect is recoverable; blocked signup is not.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  matched_ids uuid[];
begin
  select array_agg(id) into matched_ids
    from public.invitations
   where email = NEW.email
     and accepted_at is null
     and revoked_at is null
     and expires_at > now();

  if matched_ids is null or array_length(matched_ids, 1) is null then
    return NEW;
  end if;

  insert into public.memberships (user_id, publication_id, role)
  select NEW.id, publication_id, role
    from public.invitations
   where id = any(matched_ids)
  on conflict (user_id, publication_id) do nothing;

  update public.invitations
     set accepted_at = now()
   where id = any(matched_ids);

  return NEW;
exception when others then
  raise warning 'handle_new_auth_user: failed for user_id=%, email=%, error=%',
    NEW.id, NEW.email, SQLERRM;
  return NEW;
end;
$$;

-- 5. Trigger.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 6. RPC for the middleware-side defensive resolution. Closes the case
--    where an invitation is created AFTER the auth.users row already
--    existed (no INSERT event for the trigger to fire on).
create or replace function public.resolve_pending_invitations()
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_uid uuid := auth.uid();
  caller_email text;
  matched_ids uuid[];
  resolved_count int;
begin
  if caller_uid is null then
    return 0;
  end if;

  -- Read email from auth.users (not from JWT app_metadata) so a stale
  -- JWT cannot misidentify the caller's email.
  select email into caller_email from auth.users where id = caller_uid;
  if caller_email is null then
    return 0;
  end if;

  select array_agg(id) into matched_ids
    from public.invitations
   where email = caller_email
     and accepted_at is null
     and revoked_at is null
     and expires_at > now();

  if matched_ids is null or array_length(matched_ids, 1) is null then
    return 0;
  end if;

  insert into public.memberships (user_id, publication_id, role)
  select caller_uid, publication_id, role
    from public.invitations
   where id = any(matched_ids)
  on conflict (user_id, publication_id) do nothing;

  update public.invitations
     set accepted_at = now()
   where id = any(matched_ids);

  get diagnostics resolved_count = row_count;
  return resolved_count;
end;
$$;

-- 7. RPC for the Edge Function's pre-flight conflict check. Service-role
--    only; reads auth.users to detect "already a member" without exposing
--    the auth schema to PostgREST.
create or replace function public.check_invite_conflicts(
  p_email text,
  p_publication_id uuid
)
returns text
language sql
security definer
set search_path = public, auth
as $$
  select case
    when exists (
      select 1
        from public.memberships m
        join auth.users u on u.id = m.user_id
       where lower(u.email) = lower(p_email)
         and m.publication_id = p_publication_id
    ) then 'already_member'
    when exists (
      select 1
        from public.invitations
       where email = lower(p_email)
         and publication_id = p_publication_id
         and accepted_at is null
         and revoked_at is null
         and expires_at > now()
    ) then 'invitation_pending'
    else 'ok'
  end;
$$;

-- 8. GRANTs.
grant all on public.invitations to service_role;
grant select on public.invitations to authenticated;

revoke all on function public.handle_new_auth_user() from public;
grant execute on function public.handle_new_auth_user() to supabase_auth_admin;

revoke all on function public.resolve_pending_invitations() from public;
grant execute on function public.resolve_pending_invitations() to authenticated;

revoke all on function public.check_invite_conflicts(text, uuid) from public;
grant execute on function public.check_invite_conflicts(text, uuid) to service_role;
