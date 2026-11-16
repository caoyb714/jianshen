import { useStore } from '../app/Store'
import { emptyProfile } from '../domain/seed'
import { ProfileEditor } from './ProfileForm'

/** 档案位尚未建立时显示。路由层用它替代页面内容，保证页面拿到的档案一定非空。 */
export default function OnboardProfile() {
  const { active, profiles, switchProfile, commit, cloud } = useStore()
  const revision = cloud?.snapshot.profiles.find((row) => row.id === active.id)?.profile.revision
  const other = profiles.find((row) => row.id !== active.id && row.profile)
  return (
    <section className="panel">
      <h1>建立档案位 {active.slot}</h1>
      <p className="small-muted">
        每位成员都可以填写这两个档案。建议先建立主要使用者的档案，再切到另一位。
        身体限制需要主动确认后才能生成训练计划。
      </p>
      <ProfileEditor
        cloud={Boolean(cloud)}
        initial={emptyProfile}
        onSubmit={(profile) =>
          commit({ kind: 'profile', profileId: active.id, value: profile }, revision ?? undefined)
        }
      />
      {other ? (
        <button className="button secondary" onClick={() => void switchProfile(other.id)}>
          切换到 {other.profile?.name}
        </button>
      ) : null}
    </section>
  )
}
