-- 先由管理员在 Auth 建两个已确认的 Email 用户，再替换下方两个用户 UUID。
-- 只通过项目 SQL Editor 或数据库管理员连接运行一次。这里不存储邮箱或密码。
do $$
declare
  member_a uuid := '00000000-0000-0000-0000-000000000001';
  member_b uuid := '00000000-0000-0000-0000-000000000002';
  space_id uuid;
begin
  if member_a = member_b
    or (select count(*) from auth.users where id in (member_a,member_b) and email_confirmed_at is not null) <> 2
  then
    raise exception '需要两个不同、已确认的 Auth 用户 UUID';
  end if;
  if exists (select from public.workspace_members where user_id in (member_a,member_b)) then
    raise exception '至少一位用户已属于现有空间，请先核对成员';
  end if;
  insert into public.workspaces(name) values ('HerFit 共享空间') returning id into space_id;
  insert into public.workspace_members(workspace_id,user_id,seat) values (space_id,member_a,1),(space_id,member_b,2);
  -- 两个档案位：slot 1 为被监督者（主要使用者），slot 2 为另一位成员。payload 留空，由 App 首次填写。
  insert into public.health_profiles(workspace_id,slot) values (space_id,1),(space_id,2);
end
$$;
