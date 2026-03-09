import React, { useState, useEffect, useRef } from 'react';
import { X, Import, AlertCircle, Link, Loader2 } from 'lucide-react';
import { validateImportUrl, extractUuid, fetchClaudeChat, fetchChatGPTChat, fetchGeminiChat, ImportedChat } from '../services/importService';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (chat: ImportedChat) => void;
}

const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const EXAMPLES = [
    'https://chatgpt.com/share/...',
    'https://claude.ai/share/...',
    'https://gemini.google.com/share/...'
  ];

  const [url, setUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [displayText, setDisplayText] = useState('');
  const [exampleIndex, setExampleIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);

  // ... (Typing Animation Logic same as before)
  useEffect(() => {
    if (!isOpen) return;

    let timeout: NodeJS.Timeout;
    const currentExample = EXAMPLES[exampleIndex];

    if (isTyping) {
      if (displayText.length < currentExample.length) {
        timeout = setTimeout(() => {
          setDisplayText(currentExample.slice(0, displayText.length + 1));
        }, 50);
      } else {
        timeout = setTimeout(() => setIsTyping(false), 2000); // Pause at end
      }
    } else {
      if (displayText.length > 0) {
        timeout = setTimeout(() => {
          setDisplayText(displayText.slice(0, -1));
        }, 30);
      } else {
        setExampleIndex((prev) => (prev + 1) % EXAMPLES.length);
        setIsTyping(true);
      }
    }

    return () => clearTimeout(timeout);
  }, [isOpen, displayText, isTyping, exampleIndex]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 400);
    } else {
      setUrl('');
      setIsProcessing(false);
      setError(null);
      setDisplayText('');
      setExampleIndex(0);
      setIsTyping(true);
    }
  }, [isOpen]);

  const handleImport = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    setError(null);
    setIsProcessing(true);

    try {
      const provider = validateImportUrl(trimmedUrl);
      if (!provider) {
        throw new Error('Please provide a valid ChatGPT, Claude, or Gemini share URL.');
      }

      const uuid = extractUuid(trimmedUrl, provider);
      if (!uuid) {
        throw new Error('Could not extract conversation ID from the URL.');
      }

      if (provider === 'claude') {
        const importedChat = await fetchClaudeChat(uuid);
        onImport(importedChat);
        onClose();
      } else if (provider === 'chatgpt') {
        const importedChat = await fetchChatGPTChat(uuid);
        onImport(importedChat);
        onClose();
      } else if (provider === 'gemini') {
        // Gemini needs the full URL for Playwright-based server-side scraping
        const importedChat = await fetchGeminiChat(trimmedUrl);
        onImport(importedChat);
        onClose();
      } else {
        throw new Error('Unsupported provider');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during import.');
    } finally {
      setIsProcessing(false);
    }
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
      <div className="relative w-full max-w-xl bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between bg-black/5 dark:bg-black/20">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-3">
            <div className="p-2 bg-accent-primary/10 rounded-lg text-accent-primary">
              <Import size={20} />
            </div>
            Import Chat
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-text-secondary hover:bg-black/10 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          <div className="space-y-4">
            <p className="text-sm text-text-secondary leading-relaxed">
              Import shared conversations from other AI platforms directly into your workspace.
            </p>
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-200/80 leading-relaxed">{error}</p>
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider">
                  Shared URL
                </label>
              </div>
              <div className="relative group">
                <input
                  ref={inputRef}
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={url ? "" : displayText}
                  className="w-full bg-surface border border-border rounded-xl pl-11 pr-4 py-3.5 text-sm text-text-primary focus:outline-none focus:border-accent-primary focus:ring-4 focus:ring-accent-primary/10 transition-all shadow-sm"
                />
                <div className="absolute left-4 top-3.5 text-text-secondary transition-colors group-focus-within:text-accent-primary">
                  <Link size={18} />
                </div>
              </div>
            </div>
          </div>

          {/* Disclaimer Banner */}
          <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-4 rounded-2xl flex gap-3 transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20">
            <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-lg h-fit text-amber-600 dark:text-amber-400">
              <AlertCircle size={18} />
            </div>
            <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <strong className="block mb-1 font-bold text-amber-700 dark:text-amber-300">Important</strong>
              Please ensure the sharing ability is enabled on the provider (<span className="font-semibold text-text-primary">ChatGPT, Claude, or Gemini</span>) before pasting the URL here.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-black/5 dark:bg-black/20 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 hover:shadow-sm border border-transparent hover:border-border/50 transition-all active:scale-95"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!url.trim() || isProcessing}
            className={`px-8 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 flex items-center gap-2 relative overflow-hidden group border border-border
              ${!url.trim() || isProcessing
                ? 'bg-text-secondary/20 text-text-secondary cursor-not-allowed'
                : 'bg-gradient-to-r from-accent-primary to-accent-secondary text-white hover:shadow-accent-primary/40 hover:scale-[1.02] shadow-[0_0_20px_rgba(76,139,250,0.3)]'}
            `}
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            {isProcessing ? <Loader2 size={18} className="animate-spin" /> : (
              <>
                <Import size={18} />
                <span>Import Chat</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportModal;
