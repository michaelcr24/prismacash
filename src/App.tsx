import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider } from './lib/auth'
import { useAuth } from './lib/auth-context'

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const Branches = lazy(() => import('./pages/admin/Branches'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const Devices = lazy(() => import('./pages/admin/Devices'))
const Refunds = lazy(() => import('./pages/admin/Refunds'))
const Staff = lazy(() => import('./pages/admin/Staff'))
const Transactions = lazy(() => import('./pages/admin/Transactions'))
const Kiosk = lazy(() => import('./pages/Kiosk'))
const Login = lazy(() => import('./pages/Login'))
const Pos = lazy(() => import('./pages/Pos'))

const queryClient = new QueryClient()

/** Guarda de ruta: sin sesión (o restaurándola todavía) manda a /login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return <div className="p-6 text-sm text-ink-soft">Cargando…</div>
  }
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Suspense fallback={<div className="p-6 text-sm text-ink-soft">Cargando…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />

            <Route
              path="/e/:eventSlug/kiosk"
              element={
                <RequireAuth>
                  <Kiosk />
                </RequireAuth>
              }
            />
            <Route
              path="/e/:eventSlug/pos"
              element={
                <RequireAuth>
                  <Pos />
                </RequireAuth>
              }
            />

            <Route
              path="/e/:eventSlug/admin"
              element={
                <RequireAuth>
                  <AdminLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="branches" element={<Branches />} />
              <Route path="staff" element={<Staff />} />
              <Route path="devices" element={<Devices />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="refunds" element={<Refunds />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </QueryClientProvider>
  )
}
