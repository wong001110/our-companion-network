import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../features/auth/AuthProvider';
import { Cat, ShieldX } from 'lucide-react';

const LoginPage = lazy(() => import('../pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const HomePage = lazy(() => import('../pages/HomePage').then((module) => ({ default: module.HomePage })));
const ProfilePage = lazy(() => import('../pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const CompanionPage = lazy(() => import('../pages/CompanionPage').then((module) => ({ default: module.CompanionPage })));
const FriendsPage = lazy(() => import('../pages/FriendsPage').then((module) => ({ default: module.FriendsPage })));
const VisitsPage = lazy(() => import('../pages/VisitsPage').then((module) => ({ default: module.VisitsPage })));
const SecurityPage = lazy(() => import('../pages/SecurityPage').then((module) => ({ default: module.SecurityPage })));
const DataPage = lazy(() => import('../pages/DataPage').then((module) => ({ default: module.DataPage })));
const AdminOverviewPage = lazy(() => import('../pages/admin/AdminOverviewPage').then((module) => ({ default: module.AdminOverviewPage })));
const AdminAccountsPage = lazy(() => import('../pages/admin/AdminAccountsPage').then((module) => ({ default: module.AdminAccountsPage })));
const AdminCompanionsPage = lazy(() => import('../pages/admin/AdminCompanionsPage').then((module) => ({ default: module.AdminCompanionsPage })));
const AdminAssetsPage = lazy(() => import('../pages/admin/AdminAssetsPage').then((module) => ({ default: module.AdminAssetsPage })));
const AdminVisitsPage = lazy(() => import('../pages/admin/AdminVisitsPage').then((module) => ({ default: module.AdminVisitsPage })));
const AdminSystemPages = import('../pages/admin/AdminSystemPages');
const AdminRealtimePage = lazy(() => AdminSystemPages.then((module) => ({ default: module.AdminRealtimePage })));
const AdminAuditPage = lazy(() => AdminSystemPages.then((module) => ({ default: module.AdminAuditPage })));
const AdminSystemPage = lazy(() => AdminSystemPages.then((module) => ({ default: module.AdminSystemPage })));
const DeveloperDebugPage = lazy(() => import('../pages/admin/DeveloperDebugPage').then((module) => ({ default: module.DeveloperDebugPage })));

export function App() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/my-network" element={<AppShell mode="user" />}>
          <Route index element={<HomePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="companion" element={<CompanionPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="visits" element={<VisitsPage />} />
          <Route path="visits/:id" element={<VisitsPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="data" element={<DataPage />} />
        </Route>
        <Route element={<AdminRoute />}>
          <Route path="/caretaker" element={<AppShell mode="admin" />}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="accounts" element={<AdminAccountsPage />} />
            <Route path="accounts/:id" element={<AdminAccountsPage />} />
            <Route path="companions" element={<AdminCompanionsPage />} />
            <Route path="companions/:id" element={<AdminCompanionsPage />} />
            <Route path="assets" element={<AdminAssetsPage />} />
            <Route path="assets/:id" element={<AdminAssetsPage />} />
            <Route path="visits" element={<AdminVisitsPage />} />
            <Route path="visits/:id" element={<AdminVisitsPage />} />
            <Route path="realtime" element={<AdminRealtimePage />} />
            <Route path="audit" element={<AdminAuditPage />} />
            <Route path="system" element={<AdminSystemPage />} />
            <Route path="debug" element={<DeveloperDebugPage />} />
            <Route path="debug/:id" element={<DeveloperDebugPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/my-network" replace />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function AdminRoute() {
  const { user } = useAuth();
  if (user?.role !== 'SUPERADMIN') {
    return (
      <main className="route-message">
        <ShieldX />
        <p className="eyebrow">Caretaker access only</p>
        <h1>This desk is not part of your passport.</h1>
        <p>Your account remains safely inside My Network.</p>
        <a className="button button--primary" href="/my-network">Return to My Network</a>
      </main>
    );
  }
  return <Outlet />;
}

function FullPageLoading() {
  return <main className="full-page-loading" aria-busy="true"><Cat /><span>Opening your Network notebook…</span></main>;
}

function NotFound() {
  return <main className="route-message"><Cat /><p className="eyebrow">Page not found</p><h1>This page slipped out of the notebook.</h1><a className="button button--primary" href="/my-network">Return home</a></main>;
}
