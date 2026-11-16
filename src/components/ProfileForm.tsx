import { useForm } from 'react-hook-form'
import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useStore } from '../app/Store'
import { profileSchema, type Profile } from '../domain/model'
import { Field } from './UI'
export default function ProfileForm({ onSaved }: { onSaved: () => void }) {
  const { active, commit, cloud } = useStore()
  const revision = cloud?.snapshot.profiles.find((row) => row.id === active.id)?.profile.revision
  return (
    <ProfileEditor
      cloud={Boolean(cloud)}
      initial={active.profile ?? undefined}
      onSubmit={async (profile) => {
        const saved = await commit(
          { kind: 'profile', profileId: active.id, value: profile },
          revision,
        )
        if (saved) onSaved()
        return saved
      }}
    />
  )
}
export function ProfileEditor({
  cloud,
  initial,
  onSubmit,
}: {
  cloud: boolean
  initial?: Profile
  onSubmit: (value: Profile) => Promise<boolean>
}) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Profile>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      dumbbell: '',
      band: '',
      restrictions: '',
      equipment: ['徒手'],
      ...initial,
      restrictionsConfirmed: false,
    },
  })
  const [saveFailed, setSaveFailed] = useState(false)
  const submit = async (profile: Profile) => setSaveFailed(!(await onSubmit(profile)))
  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <p className="small-muted">
        {cloud
          ? '空间内的两位成员都可以查看和编辑此档案。年龄范围限定为成人。'
          : '当前为本机演示档案，请勿填写真实敏感健康信息。年龄范围限定为成人。'}
      </p>
      <div className="form-grid">
        <Field label="昵称">
          <input {...register('name')} maxLength={20} />
        </Field>
        <Field label="年龄">
          <input type="number" {...register('age', { valueAsNumber: true })} min="18" max="100" />
        </Field>
        <Field label="身高（cm）">
          <input
            type="number"
            {...register('height', { valueAsNumber: true })}
            min="100"
            max="230"
          />
        </Field>
        <Field label="运动经验">
          <select {...register('experience')}>
            {['刚刚开始', '偶尔运动', '规律运动'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="日常活动量">
          <select {...register('activity')}>
            {['大多坐着', '经常走动', '体力活动较多'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="运动目标">
          <select {...register('goal')}>
            {['养成运动习惯', '提升力量与体能', '改善日常状态'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="每周可安排天数">
          <input
            type="number"
            min="1"
            max="7"
            {...register('weeklyDays', { valueAsNumber: true })}
          />
        </Field>
        <Field label="每次可安排分钟">
          <input
            type="number"
            min="10"
            max="90"
            {...register('sessionMinutes', { valueAsNumber: true })}
          />
        </Field>
      </div>
      <fieldset>
        <legend>可用器械</legend>
        <div className="check-group">
          {['徒手', '哑铃', '弹力带'].map((item) => (
            <label className="check-line" key={item}>
              <input type="checkbox" value={item} {...register('equipment')} />
              {item}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-grid">
        <Field label="哑铃重量范围（选填）">
          <input {...register('dumbbell')} placeholder="例如 2–5 kg" />
        </Field>
        <Field label="弹力带阻力（选填）">
          <input {...register('band')} placeholder="例如轻阻力 / 型号" />
        </Field>
      </div>
      <Field label="伤病和运动限制（如无，请留空）">
        <textarea
          {...register('restrictions', {
            onChange: () => setValue('restrictionsConfirmed', false),
          })}
          rows={3}
          maxLength={500}
        />
      </Field>
      <label className="check-line">
        <input type="checkbox" {...register('restrictionsConfirmed')} />
        我已检查并确认上述身体限制
      </label>
      {Object.keys(errors).length ? (
        <div className="form-error" role="alert">
          {Object.entries(errors).map(([key, value]) => (
            <p key={key}>
              {key === 'restrictionsConfirmed'
                ? '请主动确认身体限制'
                : key === 'name'
                  ? value.message
                  : key === 'equipment'
                    ? '至少选择一种器械'
                    : `请检查${({ age: '年龄（18–100）', height: '身高（100–230 cm）', weeklyDays: '每周天数（1–7）', sessionMinutes: '每次分钟（10–90）' } as Record<string, string>)[key] ?? key}`}
            </p>
          ))}
        </div>
      ) : null}
      {saveFailed ? (
        <p className="form-error" role="alert">
          保存未完成。输入仍在，可关闭后查看最新档案再修改。
        </p>
      ) : null}
      <button className="button primary full-button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? '正在保存…' : cloud ? '保存共享档案' : '保存本机档案'}
      </button>
    </form>
  )
}
