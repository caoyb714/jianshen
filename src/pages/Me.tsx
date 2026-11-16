import { useState } from 'react'
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
import { useStore } from '../app/Store'
import { PageHeading, Modal } from '../components/UI'
import ProfileForm from '../components/ProfileForm'
import { makeSeed } from '../domain/seed'
import { STORAGE_KEY } from '../domain/repository'
function downloadText(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function Me() {
  const { data, today, error, commit, replace, notify, cloud, busy } = useStore(),
    [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState<'clear' | 'reset' | null>(null),
    [install, setInstall] = useState(false)
  function exportData() {
    try {
      const value = cloud
        ? JSON.stringify(
            { version: 1, exportedAt: new Date().toISOString(), ...cloud.snapshot },
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
    const next =
      confirm === 'reset' ? makeSeed() : { ...data, workouts: [], metrics: [], habits: [] }
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
          <h2>{data.profile.name}</h2>
          <p>{data.profile.goal}</p>
          <span className="soft-label">
            {cloud ? cloud.snapshot.workspaceName : '虚构示例档案 · 本机使用'}
          </span>
        </div>
        <button className="button secondary" onClick={() => setEditing(true)}>
          <Pencil size={16} />
          编辑身体档案
        </button>
      </section>
      <section className="profile-facts">
        <div>
          <span>年龄 / 身高</span>
          <strong>
            {data.profile.age} 岁 / {data.profile.height} cm
          </strong>
        </div>
        <div>
          <span>运动经验</span>
          <strong>{data.profile.experience}</strong>
        </div>
        <div>
          <span>每周可用时间</span>
          <strong>
            {data.profile.weeklyDays} 天 · 每次 {data.profile.sessionMinutes} 分钟
          </strong>
        </div>
        <div>
          <span>家里的器械</span>
          <strong>{data.profile.equipment.join('、')}</strong>
        </div>
      </section>
      <section className="settings-section">
        <h2>按你的方式使用</h2>
        <div className="setting-row">
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
            <small>JSON 格式 · 包含档案、身体指标与全部记录</small>
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
                <strong>清空本机记录</strong>
                <small>清空运动、习惯和身体指标，保留档案及偏好</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button className="setting-row setting-button" onClick={() => setConfirm('reset')}>
              <RefreshCw size={21} />
              <span>
                <strong>重新加载示例</strong>
                <small>替换当前档案与记录，回到最初的演示状态</small>
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
              ? '空间成员可以查看和修改共享健康档案。导出的 JSON 含个人数据，请妥善保管。'
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
          title={confirm === 'clear' ? '清空这些本机记录？' : '重新加载全部示例？'}
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === 'clear'
              ? '运动、习惯和身体指标将从当前浏览器移除；档案与偏好保留。'
              : '当前档案、偏好与记录将被虚构示例替换。'}
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
