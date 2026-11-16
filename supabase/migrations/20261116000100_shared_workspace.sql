begin;

create schema herfit_private;
revoke all on schema herfit_private from public, anon, authenticated;
grant usage on schema herfit_private to authenticated;

-- Normalized ownership and dates, with typed payload checks at the database boundary.
create function herfit_private.valid_payload(kind text, body jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare exercise jsonb;
begin
  if jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>32000 then return false; end if;
  case kind
    when 'profile' then
      return (
        jsonb_typeof(body->'name') = 'string' and length(trim(body->>'name')) between 1 and 20
        and jsonb_typeof(body->'age') = 'number' and (body->>'age')::numeric between 18 and 100
        and jsonb_typeof(body->'height') = 'number' and (body->>'height')::numeric between 100 and 230
        and body->>'experience' in ('刚刚开始','偶尔运动','规律运动')
        and body->>'activity' in ('大多坐着','经常走动','体力活动较多')
        and body->>'goal' in ('养成运动习惯','提升力量与体能','改善日常状态')
        and (body->>'weeklyDays') ~ '^[1-7]$'
        and (body->>'sessionMinutes') ~ '^[0-9]+$' and (body->>'sessionMinutes')::int between 10 and 90
        and jsonb_typeof(body->'weeklyDays') = 'number' and jsonb_typeof(body->'sessionMinutes') = 'number'
        and jsonb_typeof(body->'equipment') = 'array' and jsonb_array_length(body->'equipment') between 1 and 3
        and not exists (select from jsonb_array_elements(body->'equipment') e where e not in ('"徒手"'::jsonb,'"哑铃"'::jsonb,'"弹力带"'::jsonb))
        and jsonb_typeof(body->'dumbbell') = 'string' and length(body->>'dumbbell') <= 50
        and jsonb_typeof(body->'band') = 'string' and length(body->>'band') <= 50
        and jsonb_typeof(body->'restrictions') = 'string' and length(body->>'restrictions') <= 500
        and body->'restrictionsConfirmed' = 'true'::jsonb
      ) is true;
    when 'habit' then
      return (
        jsonb_typeof(body->'water') = 'number' and (body->>'water')::numeric between 0 and 10000
        and (body->'sleep' = 'null'::jsonb or (jsonb_typeof(body->'sleep') = 'number' and (body->>'sleep')::numeric between 0 and 24))
        and (body->'energy' = 'null'::jsonb or (jsonb_typeof(body->'energy') = 'number' and (body->>'energy') ~ '^[1-5]$'))
        and jsonb_typeof(body->'meals') = 'boolean'
        and jsonb_typeof(body->'protein') = 'boolean'
        and jsonb_typeof(body->'plants') = 'boolean'
      ) is true;
    when 'metric' then
      return (
        (body->'weight' = 'null'::jsonb or (jsonb_typeof(body->'weight') = 'number' and (body->>'weight')::numeric between 20 and 400))
        and (body->'waist' = 'null'::jsonb or (jsonb_typeof(body->'waist') = 'number' and (body->>'waist')::numeric between 30 and 250))
        and (body->'hip' = 'null'::jsonb or (jsonb_typeof(body->'hip') = 'number' and (body->>'hip')::numeric between 30 and 250))
        and (body->>'weight' is not null or body->>'waist' is not null or body->>'hip' is not null)
      ) is true;
    when 'workout' then
      if (
        jsonb_typeof(body->'planId') = 'string' and length(body->>'planId') between 1 and 100
        and jsonb_typeof(body->'title') = 'string' and length(body->>'title') between 1 and 100
        and jsonb_typeof(body->'minutes') = 'number' and (body->>'minutes')::numeric between 0 and 240
        and jsonb_typeof(body->'difficulty') = 'number' and (body->>'difficulty') ~ '^([1-9]|10)$'
        and jsonb_typeof(body->'discomfort') = 'boolean'
        and jsonb_typeof(body->'feeling') = 'string' and length(body->>'feeling') <= 500
        and jsonb_typeof(body->'exercises') = 'array' and jsonb_array_length(body->'exercises') <= 30
      ) is not true then return false; end if;
      for exercise in select value from jsonb_array_elements(body->'exercises') loop
        if (
          jsonb_typeof(exercise->'id') = 'string' and length(exercise->>'id') between 1 and 100
          and jsonb_typeof(exercise->'name') = 'string' and length(exercise->>'name') between 1 and 100
          and jsonb_typeof(exercise->'sets') = 'number' and (exercise->>'sets') ~ '^([0-9]|10)$'
          and jsonb_typeof(exercise->'reps') = 'number' and (exercise->>'reps') ~ '^([0-9]{1,2}|100)$'
          and jsonb_typeof(exercise->'load') = 'number' and (exercise->>'load')::numeric between 0 and 200
        ) is not true then return false; end if;
      end loop;
      return true;
    when 'settings' then return (jsonb_typeof(body->'showWeight') = 'boolean') is true;
    else return false;
  end case;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  return false;
end
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  seat smallint not null check (seat in (1, 2)),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id), unique (workspace_id, seat)
);
create table public.health_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  payload jsonb check (payload is null or herfit_private.valid_payload('profile', payload)),
  revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  unique (workspace_id, id)
);
create table public.habit_logs (
  workspace_id uuid not null, profile_id uuid not null, observed_on date not null,
  payload jsonb not null check (herfit_private.valid_payload('habit', payload)),
  revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  primary key (workspace_id, profile_id, observed_on),
  foreign key (workspace_id, profile_id) references public.health_profiles(workspace_id,id) on delete cascade
);
create table public.body_metrics (
  workspace_id uuid not null, profile_id uuid not null, observed_on date not null,
  id uuid not null default gen_random_uuid(),
  payload jsonb not null check (herfit_private.valid_payload('metric', payload)),
  revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  primary key (workspace_id, profile_id, observed_on),
  unique (workspace_id, profile_id, id),
  foreign key (workspace_id, profile_id) references public.health_profiles(workspace_id,id) on delete cascade
);
create table public.workout_logs (
  workspace_id uuid not null, profile_id uuid not null, id uuid not null, performed_on date not null,
  payload jsonb not null check (herfit_private.valid_payload('workout', payload)),
  revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  primary key (workspace_id, profile_id, id),
  foreign key (workspace_id, profile_id) references public.health_profiles(workspace_id,id) on delete cascade
);
create table public.app_settings (
  workspace_id uuid not null,
  user_id uuid not null,
  payload jsonb not null check (herfit_private.valid_payload('settings', payload)),
  revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);

create function herfit_private.stamp_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.revision := 1;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if tg_table_name = 'health_profiles' and old.payload is null and new.payload is not null then
      new.created_by := coalesce(old.created_by, auth.uid());
    end if;
    new.revision := old.revision + 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;
revoke all on function herfit_private.stamp_write() from public, anon, authenticated;
revoke all on function herfit_private.valid_payload(text,jsonb) from public, anon, authenticated;
grant execute on function herfit_private.valid_payload(text,jsonb) to authenticated;

alter table public.workspace_members enable row level security;
alter table public.workspaces enable row level security;
revoke all on public.workspace_members, public.workspaces from public, anon, authenticated;
grant select on public.workspace_members, public.workspaces to authenticated;
create policy self_membership on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()));

do $$
declare item text;
declare membership text := 'workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id=(select auth.uid()))';
begin
  execute 'create policy member_read on public.workspaces for select to authenticated using (id in (select m.workspace_id from public.workspace_members m where m.user_id=(select auth.uid())))';
  foreach item in array array['health_profiles','habit_logs','body_metrics','workout_logs','app_settings'] loop
    execute format('alter table public.%I enable row level security',item);
    execute format('revoke all on public.%I from public, anon, authenticated',item);
    execute format('grant select on public.%I to authenticated',item);
    execute format('create trigger stamp_write before insert or update on public.%I for each row execute function herfit_private.stamp_write()',item);
    if item = 'app_settings' then
      execute format('create policy member_read on public.%I for select to authenticated using (%s and user_id=(select auth.uid()))',item,membership);
      execute format('create policy member_insert on public.%I for insert to authenticated with check (%s and user_id=(select auth.uid()))',item,membership);
      execute format('create policy member_update on public.%I for update to authenticated using (%s and user_id=(select auth.uid())) with check (%s and user_id=(select auth.uid()))',item,membership,membership);
    else
      execute format('create policy member_read on public.%I for select to authenticated using (%s)',item,membership);
      if item <> 'health_profiles' then
        execute format('create policy member_insert on public.%I for insert to authenticated with check (%s)',item,membership);
      end if;
      if item <> 'workout_logs' then
        execute format('create policy member_update on public.%I for update to authenticated using (%s) with check (%s)',item,membership,membership);
      end if;
    end if;
  end loop;
end
$$;

grant update(payload) on public.health_profiles, public.habit_logs, public.body_metrics, public.app_settings to authenticated;
grant insert(workspace_id,profile_id,observed_on,payload) on public.habit_logs, public.body_metrics to authenticated;
grant insert(workspace_id,profile_id,id,performed_on,payload) on public.workout_logs to authenticated;
grant insert(workspace_id,user_id,payload) on public.app_settings to authenticated;

create function herfit_private.entry(value jsonb, rev integer, creator uuid, editor uuid, edited timestamptz)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('value',value,'revision',rev,'createdBy',creator,'updatedBy',editor,'updatedAt',edited)
$$;
revoke all on function herfit_private.entry(jsonb,integer,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function herfit_private.entry(jsonb,integer,uuid,uuid,timestamptz) to authenticated;

create function public.herfit_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'workspaceId',w.id, 'workspaceName',w.name,'profileId',p.id,
    'profile',herfit_private.entry(p.payload,p.revision,p.created_by,p.updated_by,p.updated_at),
    'habits',coalesce((select jsonb_agg(herfit_private.entry(
      h.payload||jsonb_build_object('date',h.observed_on),h.revision,h.created_by,h.updated_by,h.updated_at) order by h.observed_on desc)
      from public.habit_logs h where (h.workspace_id,h.profile_id)=(w.id,p.id)),'[]'::jsonb),
    'metrics',coalesce((select jsonb_agg(herfit_private.entry(
      m.payload||jsonb_build_object('id',m.id,'date',m.observed_on),m.revision,m.created_by,m.updated_by,m.updated_at) order by m.observed_on desc)
      from public.body_metrics m where (m.workspace_id,m.profile_id)=(w.id,p.id)),'[]'::jsonb),
    'workouts',coalesce((select jsonb_agg(herfit_private.entry(
      l.payload||jsonb_build_object('id',l.id,'date',l.performed_on,'createdAt',l.created_at),l.revision,l.created_by,l.updated_by,l.updated_at) order by l.created_at desc)
      from public.workout_logs l where (l.workspace_id,l.profile_id)=(w.id,p.id)),'[]'::jsonb),
    'settings',(select herfit_private.entry(s.payload,s.revision,s.created_by,s.updated_by,s.updated_at)
      from public.app_settings s where s.workspace_id=w.id and s.user_id=(select auth.uid()))
  )
  from public.workspaces w join public.health_profiles p on p.workspace_id=w.id
  where w.id in (select m.workspace_id from public.workspace_members m where m.user_id=(select auth.uid()))
$$;

create function public.herfit_write(p_workspace uuid, p_profile uuid, p_kind text, p_payload jsonb, p_expected integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare changed integer; day date; log_id uuid; body jsonb;
begin
  if not exists (select from public.health_profiles where workspace_id=p_workspace and id=p_profile) then
    raise insufficient_privilege using message='workspace access denied';
  end if;
  if not herfit_private.valid_payload(p_kind,p_payload) then
    raise check_violation using message='invalid record';
  end if;
  body := p_payload - array['id','date','createdAt'];
  if p_kind in ('habit','metric','workout') then
    if (p_payload->>'date') is null or (p_payload->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise check_violation using message='invalid date';
    end if;
    day := (p_payload->>'date')::date;
  end if;
  if p_kind = 'profile' then
    update public.health_profiles set payload=body where workspace_id=p_workspace and id=p_profile and revision=p_expected;
    get diagnostics changed = row_count;
  elsif p_kind = 'habit' then
    if p_expected is null then
      insert into public.habit_logs(workspace_id,profile_id,observed_on,payload) values(p_workspace,p_profile,day,body)
      on conflict (workspace_id,profile_id,observed_on) do nothing;
    else
      update public.habit_logs set payload=body where workspace_id=p_workspace and profile_id=p_profile and observed_on=day and revision=p_expected;
    end if;
    get diagnostics changed = row_count;
  elsif p_kind = 'metric' then
    if p_expected is null then
      insert into public.body_metrics(workspace_id,profile_id,observed_on,payload) values(p_workspace,p_profile,day,body)
      on conflict (workspace_id,profile_id,observed_on) do nothing;
    else
      update public.body_metrics set payload=body where workspace_id=p_workspace and profile_id=p_profile and observed_on=day and revision=p_expected;
    end if;
    get diagnostics changed = row_count;
  elsif p_kind = 'workout' then
    log_id := (p_payload->>'id')::uuid;
    insert into public.workout_logs(workspace_id,profile_id,id,performed_on,payload)
    values(p_workspace,p_profile,log_id,day,body) on conflict (workspace_id,profile_id,id) do nothing;
    get diagnostics changed = row_count;
    if changed=0 and exists (select from public.workout_logs where workspace_id=p_workspace and profile_id=p_profile
      and id=log_id and created_by=(select auth.uid()) and performed_on=day and payload=body) then
      changed := 1;
    end if;
  elsif p_kind = 'settings' then
    if p_expected is null then
      insert into public.app_settings(workspace_id,user_id,payload) values(p_workspace,(select auth.uid()),body)
      on conflict (workspace_id,user_id) do nothing;
    else
      update public.app_settings set payload=body where workspace_id=p_workspace and user_id=(select auth.uid()) and revision=p_expected;
    end if;
    get diagnostics changed = row_count;
  end if;
  if changed is distinct from 1 then
    raise serialization_failure using message='record changed, reload before saving';
  end if;
  return public.herfit_snapshot();
end
$$;
revoke all on function public.herfit_snapshot() from public, anon, authenticated;
revoke all on function public.herfit_write(uuid,uuid,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.herfit_snapshot(), public.herfit_write(uuid,uuid,text,jsonb,integer) to authenticated;

commit;
