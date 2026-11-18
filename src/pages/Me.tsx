import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  UserRound,
  Pencil,
  Download,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  ChevronRight,
  Heart,
  LogOut,
} from 'lucide-react'
import { useProfile } from '../app/Store'
import { readJson, removeKey, writeJson } from '../app/storage'
import { PageHeading, Modal } from '../components/UI'
import ProfileForm from '../components/ProfileForm'
import { AI_CONSENT_KEY } from '../domain/ai'
import { makeSeed } from '../domain/seed'
import { STORAGE_KEY } from '../domain/repository'
import { latestWeights } from '../domain/stats'
import { displayDate } from '../domain/dates'
function downloadText(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function Me() {
  const {
      active,
      profile,
      profiles,
      switchProfile,
      data,
      today,
      error,
      commit,
      replace,
      notify,
      cloud,
      busy,
    } = useProfile(),
    [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState<'clear' | 'reset' | null>(null),
    [install, setInstall] = useState(false),
    // 同意状态以本机标记为准，训练页每次点击都会重新读取它
    [consent, setConsent] = useState(() => readJson<boolean>(AI_CONSENT_KEY) === true)
  const location = useLocation(),
    latestWeight = latestWeights(active.metrics)[0]

  // Me 是懒加载路由：浏览器原生 hash 滚动发生在 Suspense 占位阶段，那时元素还没挂载，
  // 所以 /me#showWeight 不会自己滚到底。必须等这一帧渲染完再手动滚。
  useEffect(() => {
    if (location.hash !== '#showWeight') return
    const timer = window.setTimeout(() => {
      document.getElementById('showWeight')?.scrollIntoView({ block: 'center' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [location.hash])

  function toggleConsent(next: boolean) {
    // 关闭时直接删键：任何读到"没有标记"的页面都会回到未同意状态，包括训练页的同意弹窗
    const saved = next ? writeJson(AI_CONSENT_KEY, true) : removeKey(AI_CONSENT_KEY)
    setConsent(saved && next)
    if (!saved) notify('无法保存这项偏好，请检查浏览器是否允许本机存储。')
  }

  function exportData() {
    try {
      const value = cloud
        ? JSON.stringify(
            { version: 2, exportedAt: new Date().toISOString(), ...cloud.snapshot },
            null,
            2,
          )
        : error
          ? localStorage.getItem(STORAGE_KEY)
          : JSON.stringify(data, null, 2)
      if (value === null) {
        notify('没有可导出的原始数据。')
        return
      }
      downloadText(
        value,
        cloud ? `herfit-shared-${today}.json` : `herfit-demo-${today}${error ? '-raw' : ''}.json`,
      )
      notify('已发起本机下载，请妥善保存导出文件。')
    } catch {
      notify('无法读取本机存储，未生成导出文件。')
    }
  }

  function confirmReset() {
    if (confirm === 'reset') {
      if (replace?.(makeSeed())) setConfirm(null)
      return
    }
    const next = {
      ...data,
      workouts: data.workouts.filter((row) => row.profileId !== active.id),
      metrics: data.metrics.filter((row) => row.profileId !== active.id),
      habits: data.habits.filter((row) => row.profileId !== active.id),
    }
    if (replace?.(next)) setConfirm(null)
  }

  return (
    <>
      <PageHeading
        title="照顾自己，从了解开始。"
        description="你的身体档案、使用偏好和数据，都在这里。"
      />
      <section className="profile-card">
        <div className="avatar">
          <UserRound size={35} strokeWidth={1.3} />
        </div>
        <div>
          <h2>
            {profile.name}
            <span className="soft-label">档案位 {active.slot}</span>
          </h2>
          <p>{profile.goal}</p>
          <span className="soft-label">
            {cloud ? cloud.snapshot.workspaceName : '虚构示例档案 · 本机使用'}
          </span>
        </div>
        <button className="button secondary" onClick={() => setEditing(true)}>
          <Pencil size={16} />
          编辑身体档案
        </button>
      </section>

      <section className="settings-section">
        <h2>这份空间里的两个档案</h2>
        <p className="small-muted">
          双方都能查看和填写这两个档案。你负责记录，她负责查看与执行时，切到她的档案即可。
        </p>
        {profiles.map((slot) => (
          <button
            key={slot.id}
            className="setting-row setting-button"
            aria-pressed={slot.id === active.id}
            onClick={() => void switchProfile(slot.id)}
          >
            <UserRound size={21} />
            <span>
              <strong>
                档案位 {slot.slot} · {slot.profile?.name ?? '尚未建立'}
              </strong>
              <small>
                {slot.profile
                  ? `${slot.profile.experience} · 每周 ${slot.profile.weeklyDays} 天`
                  : '点这里切过去并建立档案'}
              </small>
            </span>
            <span className="status-chip">{slot.id === active.id ? '当前' : '切换'}</span>
          </button>
        ))}
        {profiles.every((slot) => slot.profile) ? null : (
          <p className="small-muted">切到空档案位后会显示建立表单。</p>
        )}
      </section>

      <section className="profile-facts">
        <div>
          <span>年龄 / 身高</span>
          <strong>
            {profile.age} 岁 / {profile.height} cm
          </strong>
        </div>
        <div>
          <span>运动经验</span>
          <strong>{profile.experience}</strong>
        </div>
        <div>
          <span>每周可用时间</span>
          <strong>
            {profile.weeklyDays} 天 · 每次 {profile.sessionMinutes} 分钟
          </strong>
        </div>
        <div>
          <span>家里的器械</span>
          <strong>{profile.equipment.join('、')}</strong>
        </div>
      </section>

      {data.settings.showWeight ? (
        <section className="weight-mirror">
          <div>
            <span>体重</span>
            <strong>{latestWeight ? `${latestWeight.weight} kg` : '尚未记录'}</strong>
            <small>
              {latestWeight
                ? `最近一次 ${displayDate(latestWeight.date)}`
                : '在「记录」页添加第一次记录'}
            </small>
          </div>
          <Link className="text-button" to="/records">
            记录体重
          </Link>
        </section>
      ) : null}

      <section className="settings-section">
        <h2>按你的方式使用</h2>
        <div className="setting-row" id="showWeight">
          <div>
            <strong>显示体重记录</strong>
            <p>
              {cloud
                ? '只改变你的显示偏好。已有体重记录仍保留在共享空间及导出文件中。'
                : '随时隐藏。已有数据仍保留在本机与导出文件中。'}
            </p>
          </div>
          <button
            className="switch"
            type="button"
            role="switch"
            aria-label="显示体重记录"
            aria-checked={data.settings.showWeight}
            disabled={busy}
            onClick={() =>
              void commit({ kind: 'settings', value: { showWeight: !data.settings.showWeight } })
            }
          >
            <span />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>AI 训练说明</strong>
            <p>开启后可在训练页把档案摘要发给 DeepSeek 生成说明；关闭后不再发送。</p>
          </div>
          <button
            className="switch"
            type="button"
            role="switch"
            aria-label="AI 训练说明"
            aria-checked={consent}
            onClick={() => toggleConsent(!consent)}
          >
            <span />
          </button>
        </div>
        <button
          className="setting-row setting-button"
          onClick={() => setInstall(!install)}
          aria-expanded={install}
        >
          <Smartphone size={21} />
          <span>
            <strong>添加到手机主屏幕</strong>
            <small>正式 HTTPS 部署后可安装使用</small>
          </span>
          <ChevronRight size={18} />
        </button>
        {install ? (
          <div className="install-help">
            <p>
              <strong>iPhone：</strong>使用 Safari 打开正式 HTTPS
              地址，在分享菜单选择「添加到主屏幕」。
            </p>
            <p>
              <strong>Android：</strong>使用 Chrome
              打开正式地址，在菜单选择「安装应用」或「添加到主屏幕」。
            </p>
            <p>本机 localhost 地址只能在这台电脑使用。请使用部署后的地址在手机安装。</p>
          </div>
        ) : null}
      </section>

      <section className="settings-section">
        <h2>数据由你掌握</h2>
        <button className="setting-row setting-button" onClick={exportData}>
          <Download size={21} />
          <span>
            <strong>{cloud ? '导出共享记录' : '导出本机数据'}</strong>
            <small>JSON 格式 · 包含档案、身体指标、训练记录与计划</small>
          </span>
          <ChevronRight size={18} />
        </button>
        {cloud ? (
          <>
            <button
              className="setting-row setting-button"
              disabled={busy}
              onClick={() => void cloud.refresh()}
            >
              <RefreshCw size={21} />
              <span>
                <strong>刷新共享记录</strong>
                <small>读取另一位成员最近的修改</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button
              className="setting-row setting-button"
              disabled={busy}
              onClick={() => void cloud.signOut()}
            >
              <LogOut size={21} />
              <span>
                <strong>退出登录</strong>
                <small>{cloud.account}</small>
              </span>
              <ChevronRight size={18} />
            </button>
          </>
        ) : (
          <>
            <button className="setting-row setting-button" onClick={() => setConfirm('clear')}>
              <Trash2 size={21} />
              <span>
                <strong>清空当前档案的记录</strong>
                <small>只清空档案位 {active.slot} 的运动、习惯与指标，保留档案与计划</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button className="setting-row setting-button" onClick={() => setConfirm('reset')}>
              <RefreshCw size={21} />
              <span>
                <strong>重新加载示例</strong>
                <small>替换全部档案与记录，回到最初的演示状态</small>
              </span>
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </section>

      <div className="privacy-note">
        <ShieldCheck size={25} />
        <div>
          <h3>{cloud ? '共享空间的权限' : '现在，只属于这台浏览器'}</h3>
          <p>
            {cloud
              ? '空间成员可以查看和修改两个共享档案。导出的 JSON 含个人数据，请妥善保管。'
              : '当前数据保存在浏览器本地，未加密，也不会共享给另一人。浏览器清理数据可能移除记录，请勿在演示模式录入真实敏感信息。'}
          </p>
        </div>
      </div>

      <div className="made-with">
        <Heart size={15} />
        HerFit · 给彼此，也给自己，一点温柔。
      </div>

      {editing ? (
        <Modal title="编辑身体档案" onClose={() => setEditing(false)}>
          <ProfileForm onSaved={() => setEditing(false)} />
        </Modal>
      ) : null}
      {confirm ? (
        <Modal
          title={confirm === 'clear' ? '清空这个档案的记录？' : '重新加载全部示例？'}
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === 'clear'
              ? `档案位 ${active.slot} 的运动、习惯和身体指标将被移除；档案、计划与偏好保留。`
              : '当前全部档案、偏好与记录将被虚构示例替换。'}
            此操作无法在应用内撤销，请先导出需要保留的数据。
          </p>
          <div className="actions">
            <button className="button secondary" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button className="button primary" onClick={confirmReset}>
              {confirm === 'clear' ? '确认清空' : '确认替换示例'}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
