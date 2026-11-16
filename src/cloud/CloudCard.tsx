import type { ReactNode } from 'react'

export function CloudCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="account-page">
      <span className="brand">
        HerFit<span className="brand-dot">.</span>
      </span>
      <section className="panel account-card">
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  )
}
