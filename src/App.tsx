import { useCallback, useEffect, useState } from 'react';
import { Moon, Settings, Sun } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { apiRequest } from './lib/api';
import type { AuthStatus, DashboardData, ReferenceCatalog, User } from './types';
import { AuthGate } from './components/AuthGate';
import { OverviewView } from './components/OverviewView';
import { LineageView } from './components/LineageView';
import { MutationsView } from './components/MutationsView';
import { ExperimentsView } from './components/ExperimentsView';
import { GuidesView } from './components/GuidesView';
import { AlertsView } from './components/AlertsView';
import { SettingsView } from './components/SettingsView';
import { NcbiModal } from './components/NcbiModal';
import { LabLoader } from './components/TelemetryCharts';
import { TactileButton } from './components/Tactile3D';

type NavTab = 'overview' | 'lineage' | 'mutations' | 'experiments' | 'guides' | 'alerts' | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; subtitle: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    subtitle: 'Chromosome off-target mapping, Cas9 fidelity calibration, and cleavage telemetry',
  },
  {
    id: 'lineage',
    label: 'Lineage Tree',
    subtitle: 'Recursive cell-line inheritance tree and clone mutation trace',
  },
  {
    id: 'mutations',
    label: 'Off-Target Log',
    subtitle: 'Detected off-target cleavage events, rankings, and unhit loci',
  },
  {
    id: 'experiments',
    label: 'Experiments',
    subtitle: 'Cas9 fidelity benchmarks and mismatch decay profiling',
  },
  {
    id: 'guides',
    label: 'Guide RNAs',
    subtitle: '20-nt spacer sequences, on-target scores, and off-target sites',
  },
  {
    id: 'alerts',
    label: 'Alerts',
    subtitle: 'Automated high-frequency alerts and relational integrity audits',
  },
];

const SETTINGS_META = {
  label: 'Settings & Architecture Reference',
  subtitle: 'Display preferences, session details, interactive ER diagram, and 3NF schema notes',
};

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [isDark, setIsDark] = useState(true);

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [reference, setReference] = useState<ReferenceCatalog | null>(null);
  const [ncbiTarget, setNcbiTarget] = useState<{ symbol: string; organism?: string } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  const loadAuthStatus = useCallback(async () => {
    try {
      const status = await apiRequest<AuthStatus>('/api/auth/status');
      setAuthStatus(status);
      setInitError(null);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Unable to reach backend API.');
    }
  }, []);

  useEffect(() => {
    loadAuthStatus();
  }, [loadAuthStatus]);

  const loadWorkspaceData = useCallback(async (activeToken: string) => {
    try {
      const [dashRes, refRes] = await Promise.all([
        apiRequest<DashboardData>('/api/dashboard', { token: activeToken }),
        apiRequest<ReferenceCatalog>('/api/reference', { token: activeToken }),
      ]);
      setDashboard(dashRes);
      setReference(refRes);
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
        setToken(null);
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    if (token) {
      loadWorkspaceData(token);
    }
  }, [token, loadWorkspaceData]);

  const handleAuthenticated = (nextToken: string, nextUser: User) => {
    setToken(nextToken);
    setUser(nextUser);
    setActiveTab('overview');
  };

  const handleSignOut = () => {
    setToken(null);
    setUser(null);
    setDashboard(null);
    setReference(null);
    loadAuthStatus();
  };

  if (initError) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="min-h-screen bg-slate-50 dark:bg-[#06080D] lab-grid-surface flex items-center justify-center p-6">
          <div className="max-w-md w-full border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-[#0B0F17] rounded-lg p-6 space-y-3">
            <h1 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100">
              Service Connection Unavailable
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">{initError}</p>
            <TactileButton
              onClick={loadAuthStatus}
              className="btn-3d-primary px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md"
            >
              Retry Connection
            </TactileButton>
          </div>
        </div>
      </MotionConfig>
    );
  }

  if (!authStatus) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="min-h-screen bg-slate-50 dark:bg-[#06080D] lab-grid-surface flex items-center justify-center p-6">
          <LabLoader label="Initializing HelixTrace workspace..." />
        </div>
      </MotionConfig>
    );
  }

  if (!token || !user) {
    return (
      <MotionConfig reducedMotion="user">
        <AuthGate authStatus={authStatus} onAuthenticated={handleAuthenticated} />
      </MotionConfig>
    );
  }

  const activeMeta =
    activeTab === 'settings'
      ? SETTINGS_META
      : (NAV_ITEMS.find((item) => item.id === activeTab) ?? NAV_ITEMS[0]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-slate-50 dark:bg-[#06080D] text-slate-900 dark:text-slate-100 flex flex-col">
        {/* Minimalistic 3-zone Top Bar Contract */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#0B0F17]/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-8">
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setActiveTab('overview')}
              className="text-xl font-display font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 text-3d-relief"
            >
              HelixTrace
            </motion.button>

            <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary sections">
              {NAV_ITEMS.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <motion.button
                    key={item.id}
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setActiveTab(item.id)}
                    className={`relative py-1.5 text-[14px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'text-cyan-700 dark:text-cyan-400'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    <span>{item.label}</span>
                    {isActive && (
                      <motion.span
                        layoutId="active-nav-underline"
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute left-0 right-0 -bottom-0.5 h-0.5 bg-cyan-600 dark:bg-cyan-400"
                      />
                    )}
                  </motion.button>
                );
              })}
            </nav>

            <div className="shrink-0">
              <TactileButton
                onClick={handleSignOut}
                className="btn-3d-secondary px-4 py-1.5 text-[13px] font-medium text-slate-900 dark:text-slate-100 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap shrink-0"
              >
                Sign Out
              </TactileButton>
            </div>
          </div>
        </header>

        {/* Workspace Sub-Bar */}
        <div className="border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-[#0B0F17]/70">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 text-3d-relief">
                {activeMeta.label}
              </h1>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                {activeMeta.subtitle}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-[13px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                <span className="font-medium text-slate-900 dark:text-slate-100">{user.fullName}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span className="capitalize font-mono text-xs">{user.role}</span>
              </div>

              <TactileButton
                onClick={() => setActiveTab((prev) => (prev === 'settings' ? 'overview' : 'settings'))}
                className={`btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium rounded-md border whitespace-nowrap shrink-0 ${
                  activeTab === 'settings'
                    ? 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-600 text-cyan-800 dark:text-cyan-300'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#101622] text-slate-700 dark:text-slate-300'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Settings</span>
              </TactileButton>

              <TactileButton
                onClick={() => setIsDark((prev) => !prev)}
                aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                className="btn-3d-secondary p-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#101622] text-slate-600 dark:text-slate-300"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </TactileButton>
            </div>
          </div>
        </div>

      {/* Main Content Stage */}
      <main className="flex-1 lab-grid-surface">
        <div className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'overview' && (
                <OverviewView
                  token={token}
                  dashboard={dashboard}
                  reference={reference}
                  onNavigate={(tab) => setActiveTab(tab)}
                  onInspectGene={(symbol) => setNcbiTarget({ symbol })}
                />
              )}

              {activeTab === 'lineage' && (
                <LineageView
                  token={token}
                  user={user}
                  reference={reference}
                  dashboard={dashboard}
                  onDataChanged={() => loadWorkspaceData(token)}
                />
              )}

              {activeTab === 'mutations' && (
                <MutationsView
                  token={token}
                  reference={reference}
                  onInspectGene={(symbol) => setNcbiTarget({ symbol })}
                  onDataChanged={() => loadWorkspaceData(token)}
                />
              )}

              {activeTab === 'experiments' && (
                <ExperimentsView
                  token={token}
                  reference={reference}
                  dashboard={dashboard}
                  onDataChanged={() => loadWorkspaceData(token)}
                />
              )}

              {activeTab === 'guides' && (
                <GuidesView
                  token={token}
                  reference={reference}
                  onInspectGene={(symbol, organism) => setNcbiTarget({ symbol, organism })}
                  onDataChanged={() => loadWorkspaceData(token)}
                />
              )}

              {activeTab === 'alerts' && (
                <AlertsView
                  token={token}
                  onInspectGene={(symbol) => setNcbiTarget({ symbol })}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  user={user}
                  isDark={isDark}
                  onToggleTheme={() => setIsDark((prev) => !prev)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

        {/* Third-party NCBI Gene Annotation Modal */}
        <NcbiModal
          symbol={ncbiTarget?.symbol ?? null}
          organism={ncbiTarget?.organism}
          token={token}
          onClose={() => setNcbiTarget(null)}
        />
      </div>
    </MotionConfig>
  );
}
