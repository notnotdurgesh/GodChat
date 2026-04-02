import React, { useState, useEffect } from 'react';
import { X, FileText, Download, Target, GitMerge } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatSession, MessageNode } from '../types';
import { buildThreadMarkdown, buildAllBranchesMarkdown, downloadMarkdown } from '../services/exportService';
import MarkdownRenderer from './MarkdownRenderer';
import { useSnackbar } from '../contexts/SnackbarContext';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: ChatSession | null;
  threadPath: MessageNode[];
}

const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, session, threadPath }) => {
  const [scope, setScope] = useState<'current' | 'all'>('all');
  const [format, setFormat] = useState<'markdown' | 'pdf'>('markdown');
  const [isPreparingPDF, setIsPreparingPDF] = useState(false);
  const [pdfReadyContent, setPdfReadyContent] = useState<string | null>(null);

  const { showSnackbar } = useSnackbar();

  // Handle PDF generation via printing overlay
  useEffect(() => {
    if (pdfReadyContent) {
      // Need a small delay to let React render the MarkdownRenderer overlay fully
      const timer = setTimeout(() => {
        setIsPreparingPDF(false); 
        window.print();
        setPdfReadyContent(null);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [pdfReadyContent]);

  if (!isOpen || !session) return null;

  const handleExport = () => {
    const titleBase = session.title.replace(/[^a-zA-Z0-9_-]/g, '_');
    const mdContent = scope === 'current' 
      ? buildThreadMarkdown(threadPath, session.title)
      : buildAllBranchesMarkdown(session);

    if (format === 'markdown') {
      const scopeName = scope === 'current' ? 'thread' : 'all_branches';
      downloadMarkdown(`${titleBase}_${scopeName}`, mdContent);
      onClose();
      showSnackbar('Markdown exported successfully', 'success');
    } else {
      setIsPreparingPDF(true);
      setPdfReadyContent(mdContent);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-md bg-surface-light border border-surface-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-surface-border/50 bg-surface/50 backdrop-blur">
              <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <FileText className="w-5 h-5 text-accent-primary" />
                Export Chat
              </h2>
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-border transition-colors"
                disabled={isPreparingPDF}
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 flex flex-col gap-6">
              
              {/* Scope Selection */}
              <div className="flex flex-col gap-3">
                <label className="text-sm font-medium text-text-secondary uppercase tracking-wider">
                  Content Scope
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setScope('current')}
                    className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                      scope === 'current'
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-surface-border bg-surface-dark/50 text-text-secondary hover:bg-surface/80 hover:text-text-primary'
                    }`}
                  >
                    <Target size={20} />
                    <span className="text-sm font-medium">Current Thread</span>
                  </button>
                  <button
                    onClick={() => setScope('all')}
                    className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                      scope === 'all'
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-surface-border bg-surface-dark/50 text-text-secondary hover:bg-surface/80 hover:text-text-primary'
                    }`}
                  >
                    <GitMerge size={20} />
                    <span className="text-sm font-medium">All Branches</span>
                  </button>
                </div>
              </div>

              {/* Format Selection */}
              <div className="flex flex-col gap-3">
                <label className="text-sm font-medium text-text-secondary uppercase tracking-wider">
                  File Format
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setFormat('markdown')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                      format === 'markdown'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-surface-border bg-surface-dark/50 text-text-secondary hover:bg-surface/80 hover:text-text-primary'
                    }`}
                  >
                    <FileText size={18} />
                    <span className="text-sm font-medium">Markdown</span>
                  </button>
                  <button
                    onClick={() => setFormat('pdf')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                      format === 'pdf'
                        ? 'border-red-500 bg-red-500/10 text-red-400'
                        : 'border-surface-border bg-surface-dark/50 text-text-secondary hover:bg-surface/80 hover:text-text-primary'
                    }`}
                  >
                    <Download size={18} />
                    <span className="text-sm font-medium">PDF Document</span>
                  </button>
                </div>
              </div>

              {/* Export Button */}
              <button
                onClick={handleExport}
                disabled={isPreparingPDF}
                className="w-full flex items-center justify-center gap-2 mt-2 px-4 py-3 bg-accent-primary hover:bg-accent-primary-hover active:bg-accent-primary-active text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPreparingPDF ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Preparing PDF...
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    Export Now
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Hidden Print Area */}
      {pdfReadyContent && (
        <div className="print-only-container">
          <div className="print-content prose prose-slate max-w-none">
            <MarkdownRenderer content={pdfReadyContent} forcedTheme="light" />
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ExportModal;
