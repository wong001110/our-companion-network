import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Archive,
  BookHeart,
  Boxes,
  BriefcaseBusiness,
  Bug,
  Cat,
  CircleUserRound,
  Database,
  Fingerprint,
  Gauge,
  HeartHandshake,
  History,
  Laptop,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UsersRound,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../features/auth/AuthProvider';

const userLinks = [
  { to: '/my-network', label: 'Home', icon: BookHeart, end: true },
  { to: '/my-network/profile', label: 'Profile', icon: CircleUserRound },
  { to: '/my-network/companion', label: 'My Companion', icon: Cat },
  { to: '/my-network/friends', label: 'Friends', icon: HeartHandshake },
  { to: '/my-network/visits', label: 'Visits', icon: Sparkles },
  { to: '/my-network/security', label: 'Devices & Security', icon: Laptop },
  { to: '/my-network/data', label: 'My Data', icon: Archive },
];

const adminLinks = [
  { to: '/caretaker', label: 'Network Overview', icon: Gauge, end: true },
  { to: '/caretaker/accounts', label: 'Accounts', icon: UsersRound },
  { to: '/caretaker/companions', label: 'Companions', icon: Cat },
  { to: '/caretaker/assets', label: 'Asset Storage', icon: Boxes },
  { to: '/caretaker/visits', label: 'Visit Debugger', icon: Activity },
  { to: '/caretaker/realtime', label: 'Presence & Realtime', icon: Fingerprint },
  { to: '/caretaker/audit', label: 'Audit Log', icon: History },
  { to: '/caretaker/system', label: 'System Health', icon: Database },
  { to: '/caretaker/debug', label: 'Developer Debug', icon: Bug },
];

export function AppShell({ mode }: { mode: 'user' | 'admin' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const reducedMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('oc-portal-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('oc-portal-theme', theme);
  }, [theme]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const links = mode === 'admin' ? adminLinks : userLinks;
  return (
    <div className={`app-shell app-shell--${mode}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="mobile-header">
        <button aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu /></button>
        <Brand compact />
        <button aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? <Moon /> : <Sun />}
        </button>
      </header>
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`} aria-label={mode === 'admin' ? 'Caretaker Desk' : 'My Network'}>
        <button className="sidebar-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X /></button>
        <Brand />
        <div className="view-label">
          {mode === 'admin' ? <BriefcaseBusiness aria-hidden="true" /> : <CircleUserRound aria-hidden="true" />}
          <div>
            <span>Viewing</span>
            <strong>{mode === 'admin' ? 'Caretaker Desk' : 'My Network'}</strong>
          </div>
        </div>
        <nav className="primary-nav">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        {user?.role === 'SUPERADMIN' && (
          <NavLink
            className="switch-view"
            to={mode === 'admin' ? '/my-network' : '/caretaker'}
          >
            {mode === 'admin' ? <BookHeart /> : <ShieldCheck />}
            {mode === 'admin' ? 'Back to My Network' : 'Open Caretaker Desk'}
          </NavLink>
        )}
        <div className="sidebar-footer">
          <button className="theme-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? <Moon /> : <Sun />}
            {theme === 'light' ? 'Evening paper' : 'Morning paper'}
          </button>
          <div className="account-chip">
            <span>{(user?.profile?.displayName || user?.username || '?').slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user?.profile?.displayName || user?.username}</strong>
              <small>{user?.uid}</small>
            </div>
            <button aria-label="Sign out" onClick={() => void logout().then(() => navigate('/login'))}>
              <LogOut />
            </button>
          </div>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <main id="main-content" className="main-content" tabIndex={-1}>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand-mark"><Cat aria-hidden="true" /></span>
      {!compact && <div><strong>Our Companion</strong><small>Network Portal</small></div>}
    </div>
  );
}
