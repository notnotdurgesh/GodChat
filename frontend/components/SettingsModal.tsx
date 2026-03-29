import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, AlertCircle, RefreshCw, Server, Database, Bot, UserRound, KeyRound, Download, LogOut, FileLock2 } from 'lucide-react';
import { BackendConfig, AuthenticatedUser } from '../services/backendService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  backendConfig: BackendConfig | null;
  onRefreshStatus: () => Promise<void> | void;
  user: AuthenticatedUser;
  onUpdateProfile: (payload: { username: string }) => Promise<void> | void;
  onChangePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<void> | void;
  onExportData: () => Promise<void> | void;
  onLogout: () => Promise<void> | void;
}

const StatusPill: React.FC<{ label: string; ok: boolean | null }> = ({ label, ok }) => {
  const className = ok === null
    ? 'bg-zinc-500/10 border-zinc-500/20 text-zinc-500'
    : ok
      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
      : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400';

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider font-bold ${className}`}>
      {label}
    </span>
  );
};

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  backendConfig,
  onRefreshStatus,
  user,
  onUpdateProfile,
  onChangePassword,
  onExportData,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'backend' | 'privacy'>('profile');
  const [username, setUsername] = useState(user?.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      setUsername(user.username);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setProfileError(null);
      setPasswordError(null);
      setExportError(null);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const chatConfigured = backendConfig?.chatConfigured ?? null;
  const redisConfigured = backendConfig?.redisConfigured ?? null;
  const mermaidConfigured = backendConfig?.mermaidConfigured ?? null;
  const authEnabled = backendConfig?.authEnabled ?? null;
  const storageProvider = backendConfig?.storageProvider ?? 'mongodb';

  const handleProfileSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextUsername = username.trim();

    if (!nextUsername) {
      setProfileError('Username is required');
      return;
    }

    if (nextUsername === user.username) {
      setProfileError('Change the username before saving');
      return;
    }

    try {
      setIsSavingProfile(true);
      setProfileError(null);
      await onUpdateProfile({ username: nextUsername });
    } catch (error: any) {
      setProfileError(error.message || 'Failed to update username');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!currentPassword) {
      setPasswordError('Current password is required');
      return;
    }

    if (!newPassword) {
      setPasswordError('New password is required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    try {
      setIsChangingPassword(true);
      setPasswordError(null);
      await onChangePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      setPasswordError(error.message || 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setExportError(null);
      await onExportData();
    } catch (error: any) {
      setExportError(error.message || 'Failed to export account data');
    } finally {
      setIsExporting(false);
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await onLogout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-300 animate-in fade-in" onClick={onClose} />

      <div className="relative w-full max-w-4xl bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col min-h-[600px] max-h-[90vh] animate-in fade-in zoom-in-95 duration-300">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-black/5 dark:bg-black/20 shrink-0">
          <div className="flex items-center gap-6 flex-wrap">
            <button onClick={() => setActiveTab('profile')} className={`flex items-center gap-2 pb-1 border-b-2 font-bold transition-all ${activeTab === 'profile' ? 'border-accent-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
              <UserRound size={18} />
              Account & Profile
            </button>
            <button onClick={() => setActiveTab('backend')} className={`flex items-center gap-2 pb-1 border-b-2 font-bold transition-all ${activeTab === 'backend' ? 'border-accent-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
              <Server size={18} />
              Workspace Backend
            </button>
            <button onClick={() => setActiveTab('privacy')} className={`flex items-center gap-2 pb-1 border-b-2 font-bold transition-all ${activeTab === 'privacy' ? 'border-accent-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
              <FileLock2 size={18} />
              Privacy & Cookies
            </button>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-text-secondary hover:bg-black/10 dark:hover:bg-white/10 hover:text-text-primary transition-colors shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          {activeTab === 'profile' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <form onSubmit={handleProfileSubmit} className="rounded-2xl border border-border bg-background/50 p-6 shadow-sm flex flex-col">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-accent-primary/10 text-accent-primary flex items-center justify-center shrink-0"><UserRound size={20} /></div>
                    <div>
                      <h3 className="text-base font-bold text-text-primary">Profile</h3>
                      <p className="text-xs text-text-secondary">Shown across the workspace.</p>
                    </div>
                  </div>

                  <div className="space-y-2 mb-6 flex-1">
                    <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Username</label>
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-all focus-within:border-accent-primary focus-within:ring-2 focus-within:ring-accent-primary/20">
                      <UserRound size={16} className="text-text-secondary" />
                      <input value={username} onChange={(event) => setUsername(event.target.value)} className="w-full bg-transparent text-sm font-medium text-text-primary outline-none placeholder:text-text-secondary" placeholder="your_name" autoComplete="username" />
                    </div>
                  </div>

                  {profileError && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-600 dark:text-red-300">{profileError}</div>}

                  <button type="submit" disabled={isSavingProfile} className={`w-full rounded-xl px-5 py-3 text-sm font-bold transition-all ${isSavingProfile ? 'bg-text-secondary/20 text-text-secondary cursor-not-allowed' : 'bg-text-primary text-background shadow-sm hover:scale-[1.02]'}`}>
                    {isSavingProfile ? 'Saving...' : 'Save Username'}
                  </button>
                </form>

                <form onSubmit={handlePasswordSubmit} className="rounded-2xl border border-border bg-background/50 p-6 shadow-sm flex flex-col">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0"><KeyRound size={20} /></div>
                    <div>
                      <h3 className="text-base font-bold text-text-primary">Security</h3>
                      <p className="text-xs text-text-secondary">Update authentication credentials.</p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-6 flex-1">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Current Password</label>
                      <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary outline-none transition-all focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20" autoComplete="current-password" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">New</label>
                        <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary outline-none transition-all focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20" autoComplete="new-password" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Confirm</label>
                        <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary outline-none transition-all focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20" autoComplete="new-password" />
                      </div>
                    </div>
                  </div>

                  {passwordError && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-600 dark:text-red-300">{passwordError}</div>}

                  <button type="submit" disabled={isChangingPassword} className={`w-full rounded-xl px-5 py-3 text-sm font-bold transition-all ${isChangingPassword ? 'bg-text-secondary/20 text-text-secondary cursor-not-allowed' : 'bg-amber-600 text-white shadow-sm hover:brightness-110 border border-amber-500'}`}>
                    {isChangingPassword ? 'Updating...' : 'Change Password'}
                  </button>
                </form>
              </div>

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6">
                <div>
                  <h3 className="text-base font-bold text-text-primary flex items-center gap-2"><Database size={18} className="text-emerald-500" /> Export Account Data</h3>
                  <p className="text-sm font-medium text-text-secondary mt-1 max-w-lg">Download your raw workspace payload as a JSON file, containing all settings, chats, folders, and graph notes authenticated to this server.</p>
                  {exportError && <div className="mt-3 text-xs font-semibold text-red-500">{exportError}</div>}
                </div>

                <button onClick={() => void handleExport()} disabled={isExporting} className={`shrink-0 inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold transition-all ${isExporting ? 'bg-text-secondary/20 text-text-secondary cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/20'}`}>
                  <Download size={18} />
                  {isExporting ? 'Preparing...' : 'Download JSON'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'backend' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 p-5 rounded-2xl flex gap-4">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg h-fit text-blue-600 dark:text-blue-400"><ShieldCheck size={20} /></div>
                <div className="text-sm text-blue-900 dark:text-blue-100 leading-relaxed flex-1">
                  <strong className="block mb-1 font-semibold text-blue-700 dark:text-blue-300">Protected workspace mode</strong>
                  The browser no longer owns secrets or chat persistence. Authentication uses username/password plus an HTTP-only session cookie, and workspace data is stored securely in MongoDB.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="p-5 rounded-2xl border border-border bg-background/50 space-y-3"><div className="flex items-center gap-3 text-text-primary"><Bot size={18} className="text-accent-primary" /><span className="font-bold">Chat Provider</span></div><StatusPill label={chatConfigured ? 'Gemini Ready' : chatConfigured === null ? 'Checking' : 'Missing'} ok={chatConfigured} /><p className="text-xs font-medium text-text-secondary">Requires <code>GEMINI_API_KEY</code> on the backend server.</p></div>
                <div className="p-5 rounded-2xl border border-border bg-background/50 space-y-3"><div className="flex items-center gap-3 text-text-primary"><Database size={18} className="text-accent-primary" /><span className="font-bold">Persistence</span></div><StatusPill label={storageProvider === 'mongodb' ? 'MongoDB' : 'Checking'} ok={storageProvider === 'mongodb'} /><p className="text-xs font-medium text-text-secondary">Per-user state is stored in MongoDB instead of local browser.</p></div>
                <div className="p-5 rounded-2xl border border-border bg-background/50 space-y-3"><div className="flex items-center gap-3 text-text-primary"><UserRound size={18} className="text-accent-primary" /><span className="font-bold">Authentication</span></div><StatusPill label={authEnabled ? 'Enabled' : authEnabled === null ? 'Checking' : 'Disabled'} ok={authEnabled} /><p className="text-xs font-medium text-text-secondary">Signup and login restrict state and route access.</p></div>
                <div className="p-5 rounded-2xl border border-border bg-background/50 space-y-3"><div className="flex items-center gap-3 text-text-primary"><Server size={18} className="text-accent-primary" /><span className="font-bold">Redis Fanout</span></div><StatusPill label={redisConfigured ? 'Connected' : redisConfigured === null ? 'Checking' : 'Optional'} ok={redisConfigured} /><p className="text-xs font-medium text-text-secondary">Enable <code>REDIS_URL</code> for multi-instance stream fanout.</p></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl border border-border bg-background/50 space-y-3"><div className="flex items-center gap-3 text-text-primary font-bold"><Server size={18} className="text-accent-primary" /> Dedicated Mermaid Render</div><StatusPill label={mermaidConfigured ? 'Ready' : mermaidConfigured === null ? 'Checking' : 'Unavailable'} ok={mermaidConfigured} /><p className="text-xs font-medium text-text-secondary">Mermaid docs and rendering execute inside the same backend environment.</p></div>
                <div className="p-5 rounded-2xl border border-border bg-background/50 space-y-3"><div className="flex items-center gap-2 text-text-primary font-bold"><AlertCircle size={18} className="text-accent-primary" /> Operational Notes</div><div className="space-y-2 text-xs font-medium text-text-secondary"><div className="p-3 bg-surface rounded-lg border border-border">Data streams inherit your session cookie, gating access to the logged-in user.</div><div className="p-3 bg-surface rounded-lg border border-border">Imports are authenticated, keeping external data securely attached to the workspace.</div></div></div>
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="rounded-2xl border border-border bg-background/50 p-6 shadow-sm space-y-5">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-accent-primary/10 text-accent-primary flex items-center justify-center shrink-0"><FileLock2 size={20} /></div>
                  <div>
                    <h3 className="text-lg font-bold text-text-primary">Privacy & Cookies</h3>
                    <p className="text-sm text-text-secondary mt-1 max-w-2xl leading-6">This app currently uses an essential session cookie for authentication. It is there to keep your signed-in workspace working, not for advertising or third-party tracking.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
                    <h4 className="text-sm font-bold text-text-primary">What cookie is used</h4>
                    <p className="text-sm text-text-secondary leading-6">The backend sets one HTTP-only session cookie after login or signup. The browser sends it back on future requests so the server can identify the signed-in user.</p>
                    <div className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">Essential session cookie</div>
                  </div>

                  <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
                    <h4 className="text-sm font-bold text-text-primary">Why it exists</h4>
                    <p className="text-sm text-text-secondary leading-6">It keeps account routes, chat state, imports, SSE streams, and profile actions tied to the correct authenticated workspace. Without it, signed-in features would not work properly.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-200/60 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-900/10 p-5 space-y-3">
                  <h4 className="text-sm font-bold text-blue-800 dark:text-blue-200">Current product stance</h4>
                  <div className="space-y-2 text-sm text-blue-900 dark:text-blue-100 leading-6">
                    <p>We use an essential session cookie to keep you signed in.</p>
                    <p>We do not show a blocking cookie consent popup for this cookie because it is used for authentication and core app functionality.</p>
                    <p>If non-essential cookies are added later, such as analytics, advertising, or tracking tools, the app should be revisited for banner and consent requirements.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
                  <h4 className="text-sm font-bold text-text-primary">What is not being used here</h4>
                  <ul className="space-y-2 text-sm text-text-secondary leading-6 list-disc pl-5">
                    <li>No advertising cookie flow is wired here.</li>
                    <li>No consent-management banner is currently required for the existing auth cookie alone.</li>
                    <li>No cookie is being used here as a cross-site marketing tracker.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-black/5 dark:bg-black/20 flex items-center justify-between shrink-0">
          <div>
            {activeTab === 'profile' ? (
              <button onClick={() => void handleLogout()} disabled={isLoggingOut} className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${isLoggingOut ? 'bg-red-500/10 text-red-500/50 cursor-not-allowed' : 'text-red-600 hover:bg-red-500/10 dark:text-red-400'}`}><LogOut size={16} />{isLoggingOut ? 'Signing out...' : 'Log Out Account'}</button>
            ) : activeTab === 'backend' ? (
              <button onClick={() => void onRefreshStatus()} className="px-5 py-2.5 rounded-xl font-bold text-sm border border-border text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 transition-all flex items-center gap-2"><RefreshCw size={16} />Refresh Status</button>
            ) : (
              <div className="text-xs font-medium text-text-secondary max-w-md leading-5">This tab documents the current cookie usage in the app. It does not enable non-essential trackers or consent tooling.</div>
            )}
          </div>

          <button onClick={onClose} className="px-8 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm active:scale-95 bg-text-primary text-background hover:scale-[1.02]">Done</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
