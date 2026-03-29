import React, { useMemo, useState } from 'react';
import { ArrowRight, Database, Eye, EyeOff, LockKeyhole, Moon, Server, Sparkles, Sun, UserRound, FileLock2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { BackendConfig } from '../services/backendService';

interface AuthScreenProps {
  backendConfig: BackendConfig | null;
  isLoading: boolean;
  error: string | null;
  onLogin: (payload: { username: string; password: string }) => Promise<void> | void;
  onSignup: (payload: { username: string; password: string }) => Promise<void> | void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ backendConfig, isLoading, error, onLogin, onSignup }) => {
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const resolvedError = localError || error;
  const storageLabel = backendConfig?.storageProvider === 'mongodb' ? 'MongoDB Ready' : 'Checking MongoDB';

  const submitLabel = useMemo(() => {
    if (isLoading) return mode === 'login' ? 'Signing in...' : 'Creating account...';
    return mode === 'login' ? 'Sign In' : 'Create Account';
  }, [isLoading, mode]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setLocalError('Username is required');
      return;
    }

    if (!password) {
      setLocalError('Password is required');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    const action = mode === 'login' ? onLogin : onSignup;
    await action({ username: cleanUsername, password });
  };

  return (
    <div className="min-h-screen bg-background text-text-primary relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(76,139,250,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_28%)]" />
      <div className="absolute inset-0 cyber-grid opacity-30" />

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="h-16 px-5 sm:px-8 flex items-center justify-between border-b border-border/70 bg-background/70 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-accent-primary/10 text-accent-primary flex items-center justify-center shadow-sm">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">jellyfsch</div>
              <div className="text-xs text-text-secondary">Secure chat workspace</div>
            </div>
          </div>

          <button
            onClick={(event) => toggleTheme(event)}
            className="p-2 rounded-xl hover:bg-surface text-text-secondary hover:text-text-primary transition-colors"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        <main className="flex-1 grid lg:grid-cols-[1.1fr_0.9fr]">
          <section className="hidden lg:flex flex-col justify-between p-10 xl:p-14 border-r border-border/60">
            <div className="space-y-6 max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent-primary/20 bg-accent-primary/10 text-accent-primary text-xs font-semibold uppercase tracking-[0.18em]">
                Server-first runtime
              </div>
              <h1 className="text-5xl font-semibold tracking-tight leading-[1.02]">
                Chat, imports, and state now live behind one authenticated backend.
              </h1>
              <p className="text-base text-text-secondary leading-7 max-w-lg">
                Sign in to load your personal workspace, persisted in MongoDB, streamed over SSE, and kept separate per account.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 max-w-xl">
              <div className="p-5 rounded-3xl bg-surface/80 border border-border shadow-sm">
                <div className="flex items-center gap-3 text-text-primary font-semibold"><Database size={18} className="text-accent-primary" /> {storageLabel}</div>
                <p className="mt-2 text-sm text-text-secondary">Per-user chat state, folders, graph notes, and imported conversations are persisted on the backend.</p>
              </div>
              <div className="p-5 rounded-3xl bg-surface/80 border border-border shadow-sm">
                <div className="flex items-center gap-3 text-text-primary font-semibold"><Server size={18} className="text-accent-primary" /> Unified backend</div>
                <p className="mt-2 text-sm text-text-secondary">Authentication, chat generation, Mermaid tooling, and imports stay on the same service boundary.</p>
              </div>
            </div>
          </section>

          <section className="flex items-center justify-center p-5 sm:p-8 lg:p-10">
            <div className="w-full max-w-md rounded-[28px] border border-border bg-surface/90 backdrop-blur-xl shadow-2xl shadow-black/10 overflow-hidden">
              <div className="p-6 sm:p-7 border-b border-border/70 bg-black/5 dark:bg-black/20">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h2>
                    <p className="mt-1 text-sm text-text-secondary">
                      {mode === 'login' ? 'Use your username and password to continue.' : 'Create a local account for this backend.'}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-accent-primary/10 text-accent-primary flex items-center justify-center">
                    <LockKeyhole size={20} />
                  </div>
                </div>

                <div className="mt-5 inline-flex rounded-2xl bg-background border border-border p-1 w-full">
                  <button onClick={() => { setMode('login'); setLocalError(null); }} className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-text-primary text-background shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
                    Sign In
                  </button>
                  <button onClick={() => { setMode('signup'); setLocalError(null); }} className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${mode === 'signup' ? 'bg-text-primary text-background shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
                    Sign Up
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6 sm:p-7 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Username</label>
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3.5 focus-within:border-accent-primary focus-within:ring-4 focus-within:ring-accent-primary/10 transition-all">
                    <UserRound size={18} className="text-text-secondary" />
                    <input value={username} onChange={(event) => setUsername(event.target.value)} className="w-full bg-transparent outline-none text-sm text-text-primary placeholder:text-text-secondary" placeholder="your_name" autoComplete="username" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Password</label>
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3.5 focus-within:border-accent-primary focus-within:ring-4 focus-within:ring-accent-primary/10 transition-all">
                    <LockKeyhole size={18} className="text-text-secondary" />
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-transparent outline-none text-sm text-text-primary placeholder:text-text-secondary" placeholder="Enter password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-text-secondary hover:text-text-primary focus:outline-none transition-colors" tabIndex={-1}>
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {mode === 'signup' && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Confirm Password</label>
                    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3.5 focus-within:border-accent-primary focus-within:ring-4 focus-within:ring-accent-primary/10 transition-all">
                      <LockKeyhole size={18} className="text-text-secondary" />
                      <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full bg-transparent outline-none text-sm text-text-primary placeholder:text-text-secondary" placeholder="Re-enter password" autoComplete="new-password" />
                      <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="text-text-secondary hover:text-text-primary focus:outline-none transition-colors" tabIndex={-1}>
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                )}

                {resolvedError && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">{resolvedError}</div>}

                <button type="submit" disabled={isLoading} className={`w-full flex items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-semibold transition-all ${isLoading ? 'bg-text-secondary/20 text-text-secondary cursor-not-allowed' : 'bg-text-primary text-background hover:scale-[1.01] shadow-lg hover:shadow-xl'}`}>
                  <span>{submitLabel}</span>
                  {!isLoading && <ArrowRight size={16} />}
                </button>

                <div className="rounded-2xl border border-border bg-background/70 px-4 py-3.5 text-xs leading-6 text-text-secondary">
                  <div className="font-semibold text-text-primary flex items-center gap-2 mb-1.5">
                    <FileLock2 size={14} className="text-accent-primary" />
                    Privacy & Cookies
                  </div>
                  <p>We use an essential session cookie to keep you signed in.</p>
                  <p className="mt-1">Your workspace data persists server-side in MongoDB, while the session cookie is used only for authenticated app access.</p>
                </div>
              </form>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default AuthScreen;
