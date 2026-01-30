import React, { useState, useEffect } from 'react';
import { X, Key, ExternalLink, Settings, ShieldCheck, AlertCircle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Toast {
  message: string;
  type: 'success' | 'error' | 'info';
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('general');
  const [apiKey, setApiKey] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const storedKey = localStorage.getItem('nexus_api_key');
      if (storedKey) {
        setApiKey(storedKey);
        setToast(null);
      } else {
        setApiKey('');
        setToast({ message: "Set API key first to start using chat", type: 'info' });
        setTimeout(() => setToast(null), 4000);

        // Auto-focus after animation
        setTimeout(() => {
          inputRef.current?.focus();
        }, 400);
      }
    }
  }, [isOpen]);

  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleVerify = async () => {
    if (!apiKey.trim()) {
      showToast("Please enter an API key to verify.", 'error');
      return;
    }

    setIsVerifying(true);
    try {
      // Use the new @google/genai SDK syntax
      const client = new GoogleGenAI({ apiKey: apiKey.trim() });
      await client.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: { role: 'user', parts: [{ text: 'Ping' }] }
      });

      showToast("API Key verified successfully! Connected to Gemini.", 'success');
    } catch (error: unknown) {
      console.error("Verification failed", error);
      showToast("Verification failed. Please check your key.", 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSave = () => {
    if (!apiKey.trim()) {
      showToast("Please enter an API key to save.", 'error');
      return;
    }
    if (apiKey.trim()) {
      localStorage.setItem('nexus_api_key', apiKey.trim());
    } else {
      localStorage.removeItem('nexus_api_key');
    }
    showToast("Settings saved successfully.", 'success');
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-4xl bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[600px] max-h-[90vh] animate-in fade-in zoom-in-95 duration-300">

        {/* Sidebar */}
        <div className="w-full md:w-72 bg-black/5 dark:bg-black/20 border-r border-border p-5 flex flex-col gap-2 shrink-0 md:h-auto">
          <h2 className="text-xl font-bold text-text-primary px-3 mb-6 flex items-center gap-2.5">
            <Settings size={22} className="text-accent-primary" />
            Settings
          </h2>

          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${activeTab === 'general'
                ? 'bg-accent-primary dark:text-white light:text-black shadow-lg shadow-accent-primary/20 border border-accent-primary/20'
                : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary border border-border'
              }`}
          >
            <Key size={18} />
            API Configuration
          </button>

          {/* Future tabs can be added here */}
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col bg-background relative overflow-hidden">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-full text-text-secondary hover:bg-black/10 dark:hover:bg-white/10 hover:text-text-primary transition-colors z-10"
          >
            <X size={22} />
          </button>

          <div className="flex-1 overflow-y-auto p-8 md:p-10 scroll-smooth">
            {activeTab === 'general' && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h3 className="text-2xl font-bold text-text-primary mb-2">API Configuration</h3>
                  <p className="text-text-secondary leading-relaxed">
                    Configure your connection to Google's Gemini models. Your key allows this application to "think" and generate responses.
                  </p>
                </div>

                {/* Security Banner */}
                <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 p-5 rounded-2xl flex gap-4">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg h-fit text-blue-600 dark:text-blue-400">
                    <ShieldCheck size={20} />
                  </div>
                  <div className="text-sm text-blue-900 dark:text-blue-100 leading-relaxed flex-1">
                    <strong className="block mb-1 font-semibold text-blue-700 dark:text-blue-300">Your Privacy is Priority</strong>
                    Your API key is stored strictly in your browser's <code>localStorage</code>. It connects directly to Google's servers and is never transmitted to any third-party intermediary.
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-sm font-medium text-text-primary">
                    Gemini API Key
                  </label>

                  <div className="relative group">
                    <input
                      ref={inputRef}
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full bg-surface border border-border rounded-xl pl-11 pr-4 py-3.5 text-sm text-text-primary focus:outline-none focus:border-accent-primary focus:ring-4 focus:ring-accent-primary/10 transition-all font-mono shadow-sm"
                    />
                    <div className="absolute left-4 top-3.5 text-text-secondary transition-colors group-focus-within:text-accent-primary">
                      <Key size={18} />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-6 border-t border-border/50">
                  <button
                    onClick={handleSave}
                    className="px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-sm active:scale-95 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Save Changes
                  </button>

                  <button
                    onClick={handleVerify}
                    disabled={isVerifying || !apiKey}
                    className={`px-5 py-3 rounded-xl font-medium text-sm border transition-all flex items-center gap-2
                      ${isVerifying
                        ? 'bg-transparent border-zinc-200 dark:border-zinc-800 text-zinc-400 cursor-wait'
                        : 'bg-transparent border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'}
                    `}
                  >
                    {isVerifying ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} className={apiKey ? "text-emerald-500" : "text-zinc-400"} />}
                    {isVerifying ? 'Checking...' : 'Verify Key'}
                  </button>

                  <div className="flex-1" />

                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-xs font-medium text-accent-primary hover:text-accent-secondary hover:underline underline-offset-4 transition-colors"
                  >
                    Get an API Key
                    <ExternalLink size={14} />
                  </a>
                </div>

                {/* Troubleshooting Section */}
                <div className="mt-8 pt-6">
                  <h4 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2 opacity-80">
                    <AlertCircle size={16} />
                    Connection Help
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-text-secondary">
                    <div className="p-3 bg-surface rounded-lg border border-border">
                      If responses stall, verify your <strong>Quota Limits</strong> in Google AI Studio.
                    </div>
                    <div className="p-3 bg-surface rounded-lg border border-border">
                      Ensure <strong>Gemini API</strong> is enabled in your Google Cloud Console.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Toast Notification */}
          {toast && (
            <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-3 rounded-full shadow-2xl border animate-in slide-in-from-bottom-4 fade-in duration-300
              ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400' : ''}
              ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400' : ''}
              ${toast.type === 'info' ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400' : ''}
              bg-surface/95 backdrop-blur-xl
            `}>
              {toast.type === 'success' && <CheckCircle2 size={18} />}
              {toast.type === 'error' && <XCircle size={18} />}
              {toast.type === 'info' && <AlertCircle size={18} />}
              <span className="text-sm font-medium pr-1">{toast.message}</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsModal;