-- 计划写入的乐观锁。
--
-- 为什么单独建函数：herfit_write 体量大且承载六种记录的校验，改动它等于把所有
-- 写入路径都重新回归一遍。计划只需要「版本号必须等于我看到的那一版」这一条额外
-- 约束，独立出来风险最小。
--
-- 语义：p_expected 为当前生效计划的 version；不一致即 serialization_failure。
-- 两台设备同时提交时，后到的会失败并要求刷新，而不是静默把对方的版本覆盖掉。

create or replace function public.herfit_write_plan(
  p_workspace uuid, p_profile uuid, p_payload jsonb, p_expected integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  changed integer := 0;
  record_id uuid;
  body jsonb;
begin
  if not exists (
    select from public.workspace_members
    where workspace_id = p_workspace and user_id = (select auth.uid())
  ) then
    raise insufficient_privilege using message = 'workspace access denied';
  end if;

  if not exists (
    select from public.health_profiles where workspace_id = p_workspace and id = p_profile
  ) then
    raise insufficient_privilege using message = 'workspace access denied';
  end if;

  if not herfit_private.valid_payload('plan', p_payload) then
    raise check_violation using message = 'invalid record';
  end if;

  record_id := (p_payload->>'id')::uuid;
  body := p_payload - array['id', 'date', 'createdAt', 'profileId'];

  if p_expected is not null then
    if not exists (
      select from public.training_plans
      where workspace_id = p_workspace
        and profile_id = p_profile
        and status = 'active'
        and (payload->>'version')::int = p_expected
    ) then
      raise serialization_failure using message = 'plan changed, reload before saving';
    end if;
  end if;

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

  if changed is distinct from 1 then
    raise serialization_failure using message = 'record changed, reload before saving';
  end if;

  return public.herfit_snapshot();
end
$$;

revoke all on function public.herfit_write_plan(uuid, uuid, jsonb, integer) from public, anon;
grant execute on function public.herfit_write_plan(uuid, uuid, jsonb, integer) to authenticated;
