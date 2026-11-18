-- 记录删除：只允许记录作者本人删除自己的训练记录
--
-- 训练记录表对 authenticated 只授予 select / insert，既没有 delete 权限，
-- 也没有 delete 策略（tests/cloud-db.test.ts 里「blocks browser deletion」守着这条边界）。
-- 因此 RPC 必须是 security definer，权限边界全部由函数体承担：
--   1. 调用者必须是该空间成员，否则 42501；
--   2. 只能删除 created_by = auth.uid() 的行；
--   3. 行已不存在时按幂等成功处理，网络重试不会报错。
-- 不修改 herfit_write：它体量大且带 valid_payload 校验，改动风险高于新增独立函数。

begin;

create or replace function public.herfit_delete_workout(
  p_workspace uuid, p_profile uuid, p_record uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  changed integer := 0;
begin
  if not exists (
    select from public.workspace_members
    where workspace_id = p_workspace and user_id = (select auth.uid())
  ) then
    raise insufficient_privilege using message = 'workspace access denied';
  end if;

  delete from public.workout_logs
    where workspace_id = p_workspace and profile_id = p_profile and id = p_record
      and created_by = (select auth.uid());
  get diagnostics changed = row_count;

  -- 删除 0 行但记录仍在：是别人的记录，明确拒绝，而不是静默成功
  if changed = 0 and exists (
    select from public.workout_logs
    where workspace_id = p_workspace and profile_id = p_profile and id = p_record
  ) then
    raise insufficient_privilege using message = 'not the record author';
  end if;

  return public.herfit_snapshot();
end
$$;
revoke all on function public.herfit_delete_workout(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.herfit_delete_workout(uuid, uuid, uuid) to authenticated;

commit;
