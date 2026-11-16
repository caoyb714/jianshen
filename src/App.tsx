import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { StoreProvider } from './app/Store'
import Shell from './app/Shell'
import Home from './pages/Home'
import { resolveConfig } from './cloud/config'
const config = resolveConfig(
  {
    VITE_HERFIT_MODE: import.meta.env.VITE_HERFIT_MODE,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  },
  import.meta.env.DEV,
)
const CloudGate = lazy(() => import('./cloud/CloudGate'))
const Training = lazy(() => import('./pages/Training')),
  Workout = lazy(() => import('./pages/Workout')),
  Exercises = lazy(() => import('./pages/Exercises')),
  Records = lazy(() => import('./pages/Records')),
  Growth = lazy(() => import('./pages/Growth')),
  Me = lazy(() => import('./pages/Me'))
export default function App() {
  const pages = (
    <Suspense
      fallback={
        <div className="loading" role="status">
          HerFit · 正在准备你的空间…
        </div>
      }
    >
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="training" element={<Training />} />
          <Route path="training/session/:date" element={<Workout />} />
          <Route path="exercises" element={<Exercises />} />
          <Route path="records" element={<Records />} />
          <Route path="growth" element={<Growth />} />
          <Route path="me" element={<Me />} />
          <Route
            path="*"
            element={
              <div className="empty-state">
                <h1>这一页还没有留下足迹</h1>
                <Link className="button primary" to="/">
                  回到首页
                </Link>
              </div>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  )
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <p className="loading" role="status">
            正在准备 HerFit…
          </p>
        }
      >
        {config.mode === 'cloud' ? (
          <CloudGate config={config}>{pages}</CloudGate>
        ) : (
          <StoreProvider>{pages}</StoreProvider>
        )}
      </Suspense>
    </BrowserRouter>
  )
}
