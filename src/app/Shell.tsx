import { useEffect, useState } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import {
  House,
  Dumbbell,
  ChartNoAxesColumn,
  Sprout,
  UserRound,
  Laptop,
  Heart,
  WifiOff,
  LockKeyhole,
} from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useStore } from './Store'
import OnboardProfile from '../components/OnboardProfile'
const navigation = [
  { to: '/', label: '首页', Icon: House },
  { to: '/training', label: '训练', Icon: Dumbbell },
  { to: '/records', label: '记录', Icon: ChartNoAxesColumn },
  { to: '/growth', label: '成长', Icon: Sprout },
  { to: '/me', label: '我的', Icon: UserRound },
]
export default function Shell() {
  const { error, notice, cloud, active, profiles, switchProfile } = useStore(),
    location = useLocation(),
    [online, setOnline] = useState(navigator.onLine)
  const {
    needRefresh: [refresh, setRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])
  useEffect(() => {
    const change = () => setOnline(navigator.onLine)
    window.addEventListener('online', change)
    window.addEventListener('offline', change)
    return () => {
      window.removeEventListener('online', change)
      window.removeEventListener('offline', change)
    }
  }, [])
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          HerFit<span className="brand-dot">.</span>
        </Link>
        <span className="demo-badge">
          {cloud ? <LockKeyhole size={14} /> : <Laptop size={14} />}
          {cloud ? '私人共享空间' : '本机演示'}
        </span>
        <nav aria-label="主要导航">
          {navigation.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon size={21} strokeWidth={1.6} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <Heart size={20} strokeWidth={1.3} />
          <p>
            照顾好身体，
            <br />
            也照顾好自己。
          </p>
          <span>只在你自己的节奏里。</span>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <Link to="/" className="brand mobile-brand">
            HerFit<span className="brand-dot">.</span>
          </Link>
          <span className="desktop-date">
            {new Date().toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </span>
          {profiles.length > 1 ? (
            <div className="profile-switch" role="group" aria-label="切换档案">
              {profiles.map((slot) => (
                <button
                  key={slot.id}
                  aria-pressed={slot.id === active.id}
                  onClick={() => void switchProfile(slot.id)}
                  title={`档案位 ${slot.slot}`}
                >
                  {slot.profile?.name ?? `档案 ${slot.slot}`}
                </button>
              ))}
            </div>
          ) : null}
          <Link to="/me" className="demo-label">
            {cloud ? <LockKeyhole size={14} /> : <Laptop size={14} />}
            {cloud ? '私人共享空间' : '本机演示 · 数据未共享'}
          </Link>
        </div>
        {!online ? (
          <div className="info-banner">
            <WifiOff size={16} />
            {cloud
              ? '当前离线。连接网络后才能保存到共享空间。'
              : '当前离线。本机演示仍可记录，不会同步到其他设备。'}
          </div>
        ) : null}
        {error ? (
          <div className="error-banner" role="alert">
            {error}
            {cloud ? (
              <button className="text-button" onClick={() => void cloud.refresh()}>
                重新读取
              </button>
            ) : (
              <Link to="/me">处理数据</Link>
            )}
          </div>
        ) : null}
        <main id="main" tabIndex={-1}>
          {active.profile ? <Outlet /> : <OnboardProfile />}
        </main>
        <footer className="app-footer">
          <span>A little better, every day.</span>
          <span>{cloud ? 'HerFit v0.3 · 私人共享' : 'HerFit v0.3 · 示例内容'}</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="手机导航">
        {navigation.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon size={21} strokeWidth={1.7} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : (
        <span className="sr-only" role="status" />
      )}
      {refresh ? (
        <div className="update-toast" role="status">
          <p>新版本已准备好。请先保存正在编辑的内容。</p>
          <button onClick={() => void updateServiceWorker(true)}>更新并重新打开</button>
          <button onClick={() => setRefresh(false)}>稍后</button>
        </div>
      ) : null}
    </div>
  )
}
