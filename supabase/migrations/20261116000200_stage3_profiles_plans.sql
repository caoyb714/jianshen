-- 阶段 3：双档案、训练计划、逐组训练记录
--
-- 1. health_profiles 从「一个空间一份档案」扩展为「一个空间两个档案位」
-- 2. 新增 training_plans（每个档案同时只有一份 active 计划）
-- 3. workout payload 由「每动作一组数值」改为「逐组记录」
-- 4. herfit_snapshot 返回多档案与计划；herfit_write 支持 plan

begin;

-- ── 双档案 ────────────────────────────────────────────────────────────────
alter table public.health_profiles drop constraint health_profiles_workspace_id_key;
alter table public.health_profiles
  add column slot smallint not null default 1 check (slot in (1, 2));
alter table public.health_profiles
  add constraint health_profiles_workspace_slot_key unique (workspace_id, slot);

-- ── 训练计划 ──────────────────────────────────────────────────────────────
create table public.training_plans (
  workspace_id uuid not null,
  profile_id uuid not null,
  id uuid not null,
  status text not null check (status in ('active', 'archived')),
  payload jsonb not null check (herfit_private.valid_payload('plan', payload)),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  primary key (workspace_id, profile_id, id),
  foreign key (workspace_id, profile_id) references public.health_profiles(workspace_id, id) on delete cascade
);
-- 一个档案同时只能有一份生效计划，避免客户端并发确认出两份
create unique index training_plans_one_active
  on public.training_plans (workspace_id, profile_id) where status = 'active';

-- ── 载荷校验 ──────────────────────────────────────────────────────────────
create or replace function herfit_private.valid_payload(kind text, body jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  exercise jsonb;
  set_row jsonb;
  plan_day jsonb;
  plan_slot jsonb;
begin
  if jsonb_typeof(body) is distinct from 'object' or octet_length(body::text) > 32000 then
    return false;
  end if;
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
        and jsonb_typeof(body->'weeklyDays') = 'number'
        and (body->>'sessionMinutes') ~ '^[0-9]+$'
        and (body->>'sessionMinutes')::int between 10 and 90
        and jsonb_typeof(body->'sessionMinutes') = 'number'
        and jsonb_typeof(body->'equipment') = 'array'
        and jsonb_array_length(body->'equipment') between 1 and 3
        and not exists (
          select from jsonb_array_elements(body->'equipment') e
          where e not in ('"徒手"'::jsonb, '"哑铃"'::jsonb, '"弹力带"'::jsonb)
        )
        and jsonb_typeof(body->'dumbbell') = 'string' and length(body->>'dumbbell') <= 50
        and jsonb_typeof(body->'band') = 'string' and length(body->>'band') <= 50
        and jsonb_typeof(body->'restrictions') = 'string' and length(body->>'restrictions') <= 500
        and body->'restrictionsConfirmed' = 'true'::jsonb
      ) is true;
    when 'habit' then
      return (
        jsonb_typeof(body->'water') = 'number' and (body->>'water')::numeric between 0 and 10000
        and (
          body->'sleep' = 'null'::jsonb
          or (jsonb_typeof(body->'sleep') = 'number' and (body->>'sleep')::numeric between 0 and 24)
        )
        and (
          body->'energy' = 'null'::jsonb
          or (jsonb_typeof(body->'energy') = 'number' and (body->>'energy') ~ '^[1-5]$')
        )
        and jsonb_typeof(body->'meals') = 'boolean'
        and jsonb_typeof(body->'protein') = 'boolean'
        and jsonb_typeof(body->'plants') = 'boolean'
      ) is true;
    when 'metric' then
      return (
        (
          body->'weight' = 'null'::jsonb
          or (jsonb_typeof(body->'weight') = 'number' and (body->>'weight')::numeric between 20 and 400)
        )
        and (
          body->'waist' = 'null'::jsonb
          or (jsonb_typeof(body->'waist') = 'number' and (body->>'waist')::numeric between 30 and 250)
        )
        and (
          body->'hip' = 'null'::jsonb
          or (jsonb_typeof(body->'hip') = 'number' and (body->>'hip')::numeric between 30 and 250)
        )
        and (body->>'weight' is not null or body->>'waist' is not null or body->>'hip' is not null)
      ) is true;
    when 'workout' then
      if (
        jsonb_typeof(body->'planId') = 'string' and length(body->>'planId') between 1 and 100
        and jsonb_typeof(body->'planVersion') = 'number'
        and (body->>'planVersion')::numeric between 0 and 100000
        and jsonb_typeof(body->'title') = 'string' and length(body->>'title') between 1 and 100
        and jsonb_typeof(body->'minutes') = 'number' and (body->>'minutes')::numeric between 0 and 240
        and jsonb_typeof(body->'difficulty') = 'number' and (body->>'difficulty') ~ '^([1-9]|10)$'
        and jsonb_typeof(body->'discomfort') = 'boolean'
        and jsonb_typeof(body->'feeling') = 'string' and length(body->>'feeling') <= 500
        and jsonb_typeof(body->'exercises') = 'array'
        and jsonb_array_length(body->'exercises') <= 30
      ) is not true then
        return false;
      end if;
      for exercise in select value from jsonb_array_elements(body->'exercises') loop
        if (
          jsonb_typeof(exercise->'exerciseId') = 'string'
          and length(exercise->>'exerciseId') between 1 and 100
          and jsonb_typeof(exercise->'name') = 'string' and length(exercise->>'name') between 1 and 100
          and exercise->>'role' in ('主要','放松')
          and jsonb_typeof(exercise->'plannedSets') = 'number'
          and (exercise->>'plannedSets') ~ '^([0-9]|10)$'
          and (
            exercise->'targetReps' = 'null'::jsonb
            or (jsonb_typeof(exercise->'targetReps') = 'number'
                and (exercise->>'targetReps')::numeric between 0 and 200)
          )
          and (
            exercise->'targetSeconds' = 'null'::jsonb
            or (jsonb_typeof(exercise->'targetSeconds') = 'number'
                and (exercise->>'targetSeconds')::numeric between 0 and 600)
          )
          and (
            exercise->'replacedFrom' = 'null'::jsonb
            or (jsonb_typeof(exercise->'replacedFrom') = 'string'
                and length(exercise->>'replacedFrom') <= 100)
          )
          and jsonb_typeof(exercise->'sets') = 'array'
          and jsonb_array_length(exercise->'sets') <= 12
        ) is not true then
          return false;
        end if;
        for set_row in select value from jsonb_array_elements(exercise->'sets') loop
          if (
            jsonb_typeof(set_row->'reps') = 'number' and (set_row->>'reps') ~ '^([0-9]{1,2}|100)$'
            and jsonb_typeof(set_row->'load') = 'number'
            and (set_row->>'load')::numeric between 0 and 200
            and jsonb_typeof(set_row->'done') = 'boolean'
          ) is not true then
            return false;
          end if;
        end loop;
      end loop;
      return true;
    when 'plan' then
      if (
        jsonb_typeof(body->'version') = 'number' and (body->>'version')::numeric between 1 and 100000
        and jsonb_typeof(body->'generatedAt') = 'string' and length(body->>'generatedAt') <= 40
        and (
          body->'confirmedAt' = 'null'::jsonb
          or (jsonb_typeof(body->'confirmedAt') = 'string' and length(body->>'confirmedAt') <= 40)
        )
        and body->>'status' in ('active','archived')
        and jsonb_typeof(body->'input') = 'object'
        and jsonb_typeof(body->'days') = 'array' and jsonb_array_length(body->'days') = 7
        and jsonb_typeof(body->'notes') = 'array' and jsonb_array_length(body->'notes') <= 10
      ) is not true then
        return false;
      end if;
      for plan_day in select value from jsonb_array_elements(body->'days') loop
        if (
          jsonb_typeof(plan_day->'index') = 'number' and (plan_day->>'index') ~ '^[0-6]$'
          and plan_day->>'kind' in ('训练','恢复','休息')
          and jsonb_typeof(plan_day->'focus') = 'string' and length(plan_day->>'focus') <= 40
          and jsonb_typeof(plan_day->'warmup') = 'string' and length(plan_day->>'warmup') <= 200
          and jsonb_typeof(plan_day->'note') = 'string' and length(plan_day->>'note') <= 200
          and jsonb_typeof(plan_day->'estimatedMinutes') = 'number'
          and (plan_day->>'estimatedMinutes')::numeric between 0 and 240
          and jsonb_typeof(plan_day->'slots') = 'array'
          and jsonb_array_length(plan_day->'slots') <= 12
        ) is not true then
          return false;
        end if;
        for plan_slot in select value from jsonb_array_elements(plan_day->'slots') loop
          if (
            jsonb_typeof(plan_slot->'exerciseId') = 'string'
            and length(plan_slot->>'exerciseId') between 1 and 100
            and plan_slot->>'role' in ('主要','放松')
            and jsonb_typeof(plan_slot->'sets') = 'number'
            and (plan_slot->>'sets')::numeric between 1 and 10
            and jsonb_typeof(plan_slot->'target') = 'object'
            and plan_slot->'target'->>'type' in ('reps','hold','time')
            and jsonb_typeof(plan_slot->'restSeconds') = 'number'
            and (plan_slot->>'restSeconds')::numeric between 0 and 300
            and jsonb_typeof(plan_slot->'startLoad') = 'number'
            and (plan_slot->>'startLoad')::numeric between 0 and 200
          ) is not true then
            return false;
          end if;
        end loop;
      end loop;
      return true;
    when 'settings' then
      return (jsonb_typeof(body->'showWeight') = 'boolean') is true;
    else
      return false;
  end case;
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    return false;
end
$$;
revoke all on function herfit_private.valid_payload(text, jsonb) from public, anon, authenticated;
grant execute on function herfit_private.valid_payload(text, jsonb) to authenticated;

-- 已有 workout_logs 的校验约束需要重新绑定到新版本
alter table public.workout_logs drop constraint workout_logs_payload_check;
alter table public.workout_logs
  add constraint workout_logs_payload_check
  check (herfit_private.valid_payload('workout', payload));

-- ── 计划表的 RLS 与权限 ───────────────────────────────────────────────────
do $$
begin
  execute 'alter table public.training_plans enable row level security';
  execute 'revoke all on public.training_plans from public, anon, authenticated';
  execute 'grant select on public.training_plans to authenticated';
  execute 'create policy member_read on public.training_plans for select to authenticated
    using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id=(select auth.uid())))';
  execute 'create policy member_insert on public.training_plans for insert to authenticated
    with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id=(select auth.uid())))';
  execute 'create policy member_update on public.training_plans for update to authenticated
    using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id=(select auth.uid())))
    with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id=(select auth.uid())))';
  execute 'create trigger stamp_write before insert or update on public.training_plans
    for each row execute function herfit_private.stamp_write()';
end
$$;
grant insert (workspace_id, profile_id, id, status, payload) on public.training_plans to authenticated;
grant update (status, payload) on public.training_plans to authenticated;

-- 首次使用允许成员建立档案位。槽位由 herfit_write 计算，unique(workspace_id,slot)
-- 保证最多两个，因此策略本身只校验成员资格与合法槽位，避免同表子查询触发策略递归。
create policy member_insert on public.health_profiles for insert to authenticated
  with check (
    workspace_id in (
      select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())
    )
    and slot in (1, 2)
  );
grant insert (id, workspace_id, slot, payload) on public.health_profiles to authenticated;

-- ── 快照 ──────────────────────────────────────────────────────────────────
create or replace function public.herfit_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'workspaceId', w.id,
    'workspaceName', w.name,
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'slot', p.slot,
        'profile', herfit_private.entry(p.payload, p.revision, p.created_by, p.updated_by, p.updated_at)
      ) order by p.slot)
      from public.health_profiles p where p.workspace_id = w.id
    ), '[]'::jsonb),
    'habits', coalesce((
      select jsonb_agg(herfit_private.entry(
        h.payload || jsonb_build_object('profileId', h.profile_id, 'date', h.observed_on),
        h.revision, h.created_by, h.updated_by, h.updated_at) order by h.observed_on desc)
      from public.habit_logs h where h.workspace_id = w.id
    ), '[]'::jsonb),
    'metrics', coalesce((
      select jsonb_agg(herfit_private.entry(
        m.payload || jsonb_build_object('profileId', m.profile_id, 'id', m.id, 'date', m.observed_on),
        m.revision, m.created_by, m.updated_by, m.updated_at) order by m.observed_on desc)
      from public.body_metrics m where m.workspace_id = w.id
    ), '[]'::jsonb),
    'workouts', coalesce((
      select jsonb_agg(herfit_private.entry(
        l.payload || jsonb_build_object('profileId', l.profile_id, 'id', l.id,
          'date', l.performed_on, 'createdAt', l.created_at),
        l.revision, l.created_by, l.updated_by, l.updated_at) order by l.created_at desc)
      from public.workout_logs l where l.workspace_id = w.id
    ), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(herfit_private.entry(
        pl.payload || jsonb_build_object('profileId', pl.profile_id, 'id', pl.id, 'status', pl.status),
        pl.revision, pl.created_by, pl.updated_by, pl.updated_at) order by pl.created_at desc)
      from public.training_plans pl where pl.workspace_id = w.id
    ), '[]'::jsonb),
    'settings', (
      select herfit_private.entry(s.payload, s.revision, s.created_by, s.updated_by, s.updated_at)
      from public.app_settings s where s.workspace_id = w.id and s.user_id = (select auth.uid())
    )
  )
  from public.workspaces w
  where w.id in (
    select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())
  )
$$;
revoke all on function public.herfit_snapshot() from public, anon, authenticated;
grant execute on function public.herfit_snapshot() to authenticated;

-- ── 写入 ──────────────────────────────────────────────────────────────────
create or replace function public.herfit_write(
  p_workspace uuid, p_profile uuid, p_kind text, p_payload jsonb, p_expected integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  changed integer := 0;
  day date;
  record_id uuid;
  body jsonb;
  slot_index smallint;
begin
  -- 先确认调用者是本空间成员。档案行受 RLS 保护，非成员看不到任何行，
  -- 因此不能仅凭「档案不存在」就推断可以创建。
  if not exists (
    select from public.workspace_members
    where workspace_id = p_workspace and user_id = (select auth.uid())
  ) then
    raise insufficient_privilege using message = 'workspace access denied';
  end if;

  if not exists (
    select from public.health_profiles where workspace_id = p_workspace and id = p_profile
  ) then
    if p_kind <> 'profile' then
      raise insufficient_privilege using message = 'workspace access denied';
    end if;
    -- 首次建立档案位：仅允许 1、2 两个槽位
    select coalesce(max(slot), 0) + 1 into slot_index
      from public.health_profiles where workspace_id = p_workspace;
    if slot_index > 2 then
      raise insufficient_privilege using message = 'workspace is full';
    end if;
    if p_expected is not null then
      raise serialization_failure using message = 'record changed, reload before saving';
    end if;
    if not herfit_private.valid_payload(p_kind, p_payload) then
      raise check_violation using message = 'invalid record';
    end if;
    insert into public.health_profiles (id, workspace_id, slot, payload)
      values (p_profile, p_workspace, slot_index, p_payload - 'profileId');
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise serialization_failure using message = 'record changed, reload before saving';
    end if;
    return public.herfit_snapshot();
  end if;

  if not herfit_private.valid_payload(p_kind, p_payload) then
    raise check_violation using message = 'invalid record';
  end if;
  body := p_payload - array['id', 'date', 'createdAt', 'profileId'];

  if p_kind in ('habit', 'metric', 'workout') then
    if (p_payload->>'date') is null or (p_payload->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise check_violation using message = 'invalid date';
    end if;
    day := (p_payload->>'date')::date;
  end if;

  if p_kind = 'profile' then
    update public.health_profiles set payload = body
      where workspace_id = p_workspace and id = p_profile and revision = p_expected;
    get diagnostics changed = row_count;
  elsif p_kind = 'habit' then
    if p_expected is null then
      insert into public.habit_logs (workspace_id, profile_id, observed_on, payload)
        values (p_workspace, p_profile, day, body)
        on conflict (workspace_id, profile_id, observed_on) do nothing;
    else
      update public.habit_logs set payload = body
        where workspace_id = p_workspace and profile_id = p_profile
          and observed_on = day and revision = p_expected;
    end if;
    get diagnostics changed = row_count;
  elsif p_kind = 'metric' then
    if p_expected is null then
      insert into public.body_metrics (workspace_id, profile_id, observed_on, payload)
        values (p_workspace, p_profile, day, body)
        on conflict (workspace_id, profile_id, observed_on) do nothing;
    else
      update public.body_metrics set payload = body
        where workspace_id = p_workspace and profile_id = p_profile
          and observed_on = day and revision = p_expected;
    end if;
    get diagnostics changed = row_count;
  elsif p_kind = 'workout' then
    record_id := (p_payload->>'id')::uuid;
    insert into public.workout_logs (workspace_id, profile_id, id, performed_on, payload)
      values (p_workspace, p_profile, record_id, day, body)
      on conflict (workspace_id, profile_id, id) do nothing;
    get diagnostics changed = row_count;
    -- 同一次提交的重试：内容与创建者一致时视为成功
    if changed = 0 and exists (
      select from public.workout_logs
      where workspace_id = p_workspace and profile_id = p_profile and id = record_id
        and created_by = (select auth.uid()) and performed_on = day and payload = body
    ) then
      changed := 1;
    end if;
  elsif p_kind = 'plan' then
    record_id := (p_payload->>'id')::uuid;
    if p_payload->>'status' = 'active' then
      update public.training_plans set status = 'archived'
        where workspace_id = p_workspace and profile_id = p_profile
          and status = 'active' and id <> record_id;
    end if;
    insert into public.training_plans (workspace_id, profile_id, id, status, payload)
      values (p_workspace, p_profile, record_id, p_payload->>'status', body)
      on conflict (workspace_id, profile_id, id) do nothing;
    get diagnostics changed = row_count;
    if changed = 0 and exists (
      select from public.training_plans
      where workspace_id = p_workspace and profile_id = p_profile and id = record_id
        and created_by = (select auth.uid()) and payload = body
    ) then
      changed := 1;
    end if;
  elsif p_kind = 'settings' then
    if p_expected is null then
      insert into public.app_settings (workspace_id, user_id, payload)
        values (p_workspace, (select auth.uid()), body)
        on conflict (workspace_id, user_id) do nothing;
    else
      update public.app_settings set payload = body
        where workspace_id = p_workspace and user_id = (select auth.uid())
          and revision = p_expected;
    end if;
    get diagnostics changed = row_count;
  end if;

  if changed is distinct from 1 then
    raise serialization_failure using message = 'record changed, reload before saving';
  end if;
  return public.herfit_snapshot();
end
$$;
revoke all on function public.herfit_write(uuid, uuid, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.herfit_write(uuid, uuid, text, jsonb, integer) to authenticated;

commit;
