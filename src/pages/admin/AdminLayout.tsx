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
    <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] gap-4 p-4 md:grid-cols-[230px_1fr] md:p-6">
      <nav
        className="flex flex-col gap-1 self-start rounded-[20px] border border-line bg-white p-4 md:sticky md:top-6"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div className="mb-4 px-2">
          <p className="text-lg font-extrabold tracking-tight text-ink">
            PrismaCash<span className="text-violet">/admin</span>
          </p>
          <div className="mt-4 border-l-2 border-violet pl-3">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.6px] text-ink-faint">evento</p>
            <p className="font-extrabold text-violet">{eventSlug}</p>
          </div>
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className="navlink">
            <span className="n">{item.n}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
