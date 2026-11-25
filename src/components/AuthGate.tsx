import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Dna, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../lib/api';
import { TactileButton, TactileCard, TactileSegmentButton } from './Tactile3D';
import { MiniHelixMark } from './TelemetryCharts';
import type { AuthStatus, User } from '../types';

interface AuthGateProps {
  authStatus: AuthStatus;
  onAuthenticated: (token: string, user: User) => void;
}

export function AuthGate({ authStatus, onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [labId, setLabId] = useState<string>(
    authStatus.labs[0] ? String(authStatus.labs[0].lab_id) : '',
  );
  const [claimPasscode, setClaimPasscode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const isBootstrap = authStatus.needsBootstrap;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isBootstrap) {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/bootstrap', {
          method: 'POST',
          body: {
            fullName,
            email,
            password,
            labId: labId ? Number(labId) : null,
            claimPasscode: authStatus.envPasscodeConfigured ? claimPasscode : undefined,
          },
        });
        onAuthenticated(res.token, res.user);
      } else if (mode === 'register') {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/register', {
          method: 'POST',
          body: {
            fullName,
            email,
            password,
            labId: labId ? Number(labId) : null,
          },
        });
        onAuthenticated(res.token, res.user);
      } else {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        onAuthenticated(res.token, res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#06080D] text-slate-900 dark:text-slate-100 grid lg:grid-cols-12 items-stretch">
      {/* Left laboratory image + minimal schematic */}
      <div className="relative lg:col-span-5 min-h-[260px] lg:min-h-screen bg-slate-900 overflow-hidden flex flex-col justify-between border-r border-slate-200 dark:border-slate-800">
        {!imgError ? (
          <img
            src="/src/assets/images/auth_genomics_lab_1795530004129.jpg"
            alt="Genomics sequencing flow cell and laboratory micropipettes"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#06080D] via-[#0B0F17] to-cyan-950/50 flex items-center justify-center">
            <Dna className="w-24 h-24 text-cyan-500/25" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#06080D] via-[#06080D]/65 to-[#06080D]/30" />

        <div className="relative z-10 p-8 lg:p-10 flex items-center justify-between">
          <span className="text-lg font-display font-bold tracking-wider text-white text-3d-relief">
            HelixTrace
          </span>
          <MiniHelixMark className="w-16 h-12 opacity-80" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 p-8 lg:p-10 space-y-4"
        >
          <h1 className="text-3xl lg:text-4xl font-display font-semibold text-white leading-tight max-w-md [text-wrap:balance] text-3d-relief">
            Precision lineage &amp; CRISPR off-target tracking.
          </h1>
          <p className="text-[15px] text-slate-300 leading-relaxed max-w-md">
            Trace clone ancestry, evaluate cleavage fidelity across Cas9 variants, and audit high-frequency mutations in one workspace.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 font-mono">
            <span>Recursive Lineage Trees</span>
            <span aria-hidden="true">·</span>
            <span>Off-Target Risk Scoring</span>
            <span aria-hidden="true">·</span>
            <span>JWT Auth</span>
          </div>
        </motion.div>
      </div>

      {/* Right authentication panel */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-12 lab-grid-surface">
        <TactileCard
          intensity="subtle"
          interactiveScale={false}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md space-y-6 bg-white/95 dark:bg-[#0B0F17]/95 border border-slate-200 dark:border-slate-800 rounded-lg p-7"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-medium text-cyan-700 dark:text-cyan-400">
              <ShieldCheck className="w-4 h-4" />
              <span className="font-['Courier_New',Courier,monospace]">
                {isBootstrap ? 'First-Run Laboratory Initialization' : 'Authenticated Research Access'}
              </span>
            </div>
            <h2 className="text-2xl font-['Orbitron'] font-semibold text-slate-900 dark:text-slate-100 text-3d-relief">
              {isBootstrap
                ? 'Create Lab Administrator'
                : mode === 'login'
                  ? 'Sign in to HelixTrace'
                  : 'Register Researcher'}
            </h2>
            <p className="text-sm font-['Michroma'] text-slate-600 dark:text-slate-400">
              {isBootstrap
                ? 'Initialize primary administrator credentials to unlock the genomic workspace.'
                : mode === 'login'
                  ? 'Enter your laboratory credentials to establish a session.'
                  : 'Create a researcher account linked to your laboratory unit.'}
            </p>
          </div>

          {!isBootstrap && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-[#06080D] border border-slate-200 dark:border-slate-800 rounded-md">
              <TactileSegmentButton
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`py-2 px-3 text-sm font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Sign In
              </TactileSegmentButton>
              <TactileSegmentButton
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`py-2 px-3 text-sm font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Register Researcher
              </TactileSegmentButton>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-3 border border-rose-200 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/30 rounded-md text-sm text-rose-700 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {(isBootstrap || mode === 'register') && (
              <div>
                <label
                  htmlFor="auth-fullname"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Full Name
                </label>
                <input
                  id="auth-fullname"
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Dr. Anita Rao"
                  className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Laboratory Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="anita.rao@lab.in"
                className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Password {isBootstrap || mode === 'register' ? '(minimum 8 characters)' : ''}
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={isBootstrap || mode === 'register' ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            {(isBootstrap || mode === 'register') && authStatus.labs.length > 0 && (
              <div>
                <label
                  htmlFor="auth-lab"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Laboratory Affiliation
                </label>
                <select
                  id="auth-lab"
                  value={labId}
                  onChange={(e) => setLabId(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {authStatus.labs.map((lab) => (
                    <option key={lab.lab_id} value={lab.lab_id}>
                      {lab.lab_name} ({lab.department})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isBootstrap && authStatus.envPasscodeConfigured && (
              <div>
                <label
                  htmlFor="auth-passcode"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Administrator Claim Passcode
                </label>
                <input
                  id="auth-passcode"
                  type="password"
                  required
                  value={claimPasscode}
                  onChange={(e) => setClaimPasscode(e.target.value)}
                  placeholder="Matches ADMIN_CLAIM_PASSCODE env var"
                  className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            )}

            <TactileButton
              type="submit"
              disabled={submitting}
              className="btn-3d-primary w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
            >
              <span>
                {submitting
                  ? 'Verifying...'
                  : isBootstrap
                    ? 'Initialize Administrator'
                    : mode === 'login'
                      ? 'Sign In'
                      : 'Create Researcher Account'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </TactileButton>
          </form>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pt-2 border-t border-slate-200 dark:border-slate-800">
            Session tokens are signed with HS256 JWTs and stored strictly in runtime memory.
          </p>
        </TactileCard>
      </div>
    </div>
  );
}
