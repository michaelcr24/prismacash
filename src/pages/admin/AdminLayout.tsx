import { NavLink, Outlet, useParams } from 'react-router-dom'

const NAV = [
  { to: 'dashboard', n: '01', label: 'Dashboard' },
  { to: 'branches', n: '02', label: 'Sucursales' },
  { to: 'staff', n: '03', label: 'Personal' },
  { to: 'devices', n: '04', label: 'Dispositivos' },
  { to: 'transactions', n: '05', label: 'Transacciones' },
  { to: 'refunds', n: '06', label: 'Reembolsos' },
]

export default function AdminLayout() {
  const { eventSlug } = useParams()

  return (
    <div className="grid min-h-dvh md:grid-cols-[230px_1fr]">
      <nav className="flex flex-col gap-0.5 border-b border-line bg-paper-raised p-4 md:border-b-0 md:border-r md:p-5 md:pl-0">
        <div className="mb-4 md:mb-6">
          <p className="font-display text-xl font-extrabold uppercase tracking-wide text-ink">
            PrismaCash<span className="text-marigold">/admin</span>
          </p>
          <div className="mt-4 border-l border-line pl-3">
            <p className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-faint">evento</p>
            <p className="font-semibold text-marigold">{eventSlug}</p>
          </div>
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className="navlink">
            <span className="n">{item.n}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="p-5 md:p-8">
        <Outlet />
      </main>
    </div>
  )
}
