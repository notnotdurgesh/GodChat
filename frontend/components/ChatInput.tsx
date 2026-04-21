import React, { useState, useRef, useEffect } from 'react';
import { Send, Quote, X, BrainCircuit, Square, FastForward, ArrowDown, Paperclip, FileText, Loader2, ArrowUpFromLine, Edit3 } from 'lucide-react';
import { Attachment } from '../types';
import { AttachmentPreviewModal } from './AttachmentPreviewModal';

interface ChatInputProps {
    isSidebarOpen: boolean;
    isAtBottom: boolean;
    onScrollToBottom: () => void;
    isCurrentPathStreaming: boolean;
    suggestions: string[];
    onSuggestionClick: (suggestion: string) => void;
    onSuggestionRightClick: (e: React.MouseEvent, suggestion: string) => void;
    selectedContext: { content: string; sourceId: string } | null;
    onClearContext: () => void;
    showDivergeUI: boolean;
    onExitDiverge: () => void;
    editingNodeId: string | null;
    isThinkingEnabled: boolean;
    onToggleThinking: () => void;
    onSendMessage: (content: string, attachments?: Attachment[]) => void;
    onStop: () => void;
    threadTokenUsage?: import('../../frontend/types').TokenUsage;
    lastTokenUsage?: import('../../frontend/types').TokenUsage;
}

const ChatInput: React.FC<ChatInputProps> = ({
    isSidebarOpen,
    isAtBottom,
    onScrollToBottom,
    isCurrentPathStreaming,
    suggestions,
    onSuggestionClick,
    onSuggestionRightClick,
    selectedContext,
    onClearContext,
    showDivergeUI,
    onExitDiverge,
    editingNodeId,
    isThinkingEnabled,
    onToggleThinking,
    onSendMessage,
    onStop,
    threadTokenUsage,
    lastTokenUsage,
}) => {
    const [input, setInput] = useState('');
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
    const [inlinePreviewAtt, setInlinePreviewAtt] = useState<Attachment | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Large pasted text logic
    const [pastedTexts, setPastedTexts] = useState<Record<string, string>>({});
    const [editingDocId, setEditingDocId] = useState<string | null>(null);
    const [editingDocText, setEditingDocText] = useState<string>('');

    // --- Drag to Scroll Hook Logic ---
    const scrollRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const startX = useRef(0);
    const scrollLeft = useRef(0);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!scrollRef.current) return;
        isDragging.current = true;
        startX.current = e.pageX - scrollRef.current.offsetLeft;
        scrollLeft.current = scrollRef.current.scrollLeft;
        scrollRef.current.style.cursor = 'grabbing';
        scrollRef.current.style.userSelect = 'none';
    };

    const handleMouseLeave = () => {
        isDragging.current = false;
        if (scrollRef.current) {
            scrollRef.current.style.cursor = 'grab';
            scrollRef.current.style.removeProperty('user-select');
        }
    };

    const handleMouseUp = () => {
        isDragging.current = false;
        if (scrollRef.current) {
            scrollRef.current.style.cursor = 'grab';
            scrollRef.current.style.removeProperty('user-select');
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging.current || !scrollRef.current) return;
        e.preventDefault();
        const x = e.pageX - scrollRef.current.offsetLeft;
        const walk = (x - startX.current) * 1.5;
        scrollRef.current.scrollLeft = scrollLeft.current - walk;
    };

    const handleUpload = async (files: FileList | File[]) => {
        setIsUploading(true);
        setUploadError(null);
        const formData = new FormData();
        Array.from(files).forEach((f) => formData.append('files', f));

        try {
            const res = await fetch('/api/chat/upload', {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                setPendingAttachments(prev => [...prev, ...data.data]);
                return data.data;
            } else {
                setUploadError(data.error || 'Upload failed. Please try again.');
                setTimeout(() => setUploadError(null), 4000);
                return null;
            }
        } catch (err) {
            console.error('[Upload Error]', err);
            setUploadError('Upload failed. Please try again.');
            setTimeout(() => setUploadError(null), 4000);
            return null;
        } finally {
            setIsUploading(false);
        }
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (e.clipboardData.files.length > 0) {
            e.preventDefault();
            await handleUpload(e.clipboardData.files);
            return;
        }

        const text = e.clipboardData.getData('text');
        if (!text) return;

        const wordCount = text.trim().split(/\s+/).length;
        if (wordCount > 150) {
            e.preventDefault();
            const filename = `Document_Fragment_${new Date().toLocaleTimeString().replace(/:/g, '-')}.txt`;
            const file = new File([text], filename, { type: 'text/plain' });
            const uploadedAtts = await handleUpload([file]);
            
            if (uploadedAtts && uploadedAtts.length > 0) {
                const newAtt = uploadedAtts[0];
                setPastedTexts(prev => ({ ...prev, [newAtt.id]: text }));
            }
        }
    };

    const handleSaveEditedDoc = async () => {
        if (!editingDocId) return;
        const newText = editingDocText;
        const filename = `Document_Fragment_${new Date().toLocaleTimeString().replace(/:/g, '-')}.txt`;
        const updatedFile = new File([newText], filename, { type: 'text/plain' });
        
        setIsUploading(true);
        // Remove the old attachment
        setPendingAttachments(prev => prev.filter(p => p.id !== editingDocId));
        setPastedTexts(prev => {
            const copy = { ...prev };
            delete copy[editingDocId];
            return copy;
        });
        
        setEditingDocId(null);
        setEditingDocText('');

        const newAtts = await handleUpload([updatedFile]);
        if (newAtts && newAtts.length > 0) {
            setPastedTexts(prev => ({ ...prev, [newAtts[0].id]: newText }));
        }
    };

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files?.length) handleUpload(e.dataTransfer.files);
    };

    const handleSend = () => {
        if (!input.trim() && !selectedContext && pendingAttachments.length === 0) return;
        onSendMessage(input, pendingAttachments);
        setInput('');
        setPendingAttachments([]);
        const textarea = document.querySelector('textarea');
        if (textarea) textarea.style.height = 'auto';
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <>
            <div className="p-4 bg-background z-20 shrink-0">
                <div className={`mx-auto ${isSidebarOpen ? 'max-w-4xl' : 'max-w-6xl'} transition-all duration-300 ease-in-out relative`}>

                    {/* Scroll To Bottom Button */}
                    {!isAtBottom && (
                        <div className="absolute -top-14 right-4 z-30 animate-in fade-in zoom-in slide-in-from-right-2 duration-300 pointer-events-auto">
                            <button
                                onClick={onScrollToBottom}
                                className="flex items-center justify-center w-7 h-7 bg-surface/80 backdrop-blur-md border border-border/50 rounded-full shadow-md text-text-secondary hover:text-accent-primary hover:border-accent-primary/30 hover:bg-surface hover:scale-105 transition-all duration-300 group"
                                title="Scroll to Bottom"
                            >
                                <ArrowDown size={13} strokeWidth={3} className="group-hover:translate-y-0.5 transition-transform duration-300" />
                                {isCurrentPathStreaming && (
                                    <span className="absolute inset-0 rounded-full border border-accent-primary/40 animate-ping opacity-30 pointer-events-none"></span>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Suggestions Bar */}
                    <div className={`
                        absolute bottom-full left-0 right-0 z-20
                        transition-all duration-500 ease-out
                        ${suggestions.length > 0 && !selectedContext && isAtBottom && !editingNodeId
                            ? 'opacity-100 translate-y-0 visible'
                            : 'opacity-0 translate-y-4 invisible pointer-events-none'}
                    `}>
                        <div className="relative w-full">
                            <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
                            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
                            <div
                                ref={scrollRef}
                                onMouseDown={handleMouseDown}
                                onMouseLeave={handleMouseLeave}
                                onMouseUp={handleMouseUp}
                                onMouseMove={handleMouseMove}
                                className="flex overflow-x-auto gap-3 py-4 w-full px-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] cursor-grab active:cursor-grabbing"
                            >
                                {suggestions.map((suggestion, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            if (!isDragging.current) {
                                                setInput(suggestion);
                                                setTimeout(() => {
                                                    const textarea = document.querySelector('textarea');
                                                    if (textarea) {
                                                        textarea.style.height = 'auto';
                                                        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
                                                        textarea.focus();
                                                    }
                                                }, 0);
                                            }
                                        }}
                                        onContextMenu={(e) => onSuggestionRightClick(e, suggestion)}
                                        className="whitespace-nowrap flex-shrink-0 px-5 py-2.5 text-xs sm:text-sm font-medium rounded-xl bg-surface border border-border/50 text-text-secondary hover:text-text-primary hover:border-accent-primary/50 hover:shadow-[0_2px_8px_rgba(0,0,0,0.05)] transition-all duration-300 ease-out select-none shadow-sm animate-in slide-in-from-bottom-4 fade-in fill-mode-backwards"
                                        style={{ animationDelay: `${200 + (idx * 100)}ms` }}
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                                <div className="w-4 flex-shrink-0" />
                            </div>
                        </div>
                    </div>

                    {/* Upload Error Snackbar */}
                    {uploadError && (
                        <div className="flex items-center justify-between p-2.5 mb-2 bg-red-500/10 border border-red-500/30 rounded-xl shadow-sm animate-in slide-in-from-bottom-2 duration-200">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <div className="shrink-0 w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center text-red-500">
                                    <X size={14} />
                                </div>
                                <span className="text-xs text-red-600 dark:text-red-400 font-medium truncate">
                                    ⚠ Upload failed — {uploadError}
                                </span>
                            </div>
                            <button onClick={() => setUploadError(null)} className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-500/10 transition-colors shrink-0">
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {/* Quote Context Banner */}
                    {selectedContext && (
                        <div className="flex items-center justify-between p-2.5 mb-2 bg-surface border border-border rounded-xl shadow-sm animate-in slide-in-from-bottom-2 duration-200">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <div className="shrink-0 w-8 h-8 rounded-lg bg-accent-primary/10 flex items-center justify-center text-accent-primary">
                                    <Quote size={16} />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Replying to selection</span>
                                    <span className="text-xs text-text-primary truncate font-medium italic">"{selectedContext.content}"</span>
                                </div>
                            </div>
                            <button onClick={onClearContext} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors">
                                <X size={16} />
                            </button>
                        </div>
                    )}

                    {/* Main Input Box */}
                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`
                            relative flex flex-col p-3 rounded-2xl border transition-all duration-300 shadow-sm
                            bg-surface focus-within:shadow-md
                            ${isDragOver ? 'border-accent-primary bg-accent-primary/5 ring-2 ring-accent-primary/30' : ''}
                            ${showDivergeUI && !isDragOver
                                ? 'border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.1)] ring-1 ring-amber-500/20'
                                : (!isDragOver ? 'border-border focus-within:border-accent-primary/50 focus-within:ring-1 focus-within:ring-accent-primary/20' : '')}
                        `}
                    >
                        {/* Pending Attachments */}
                        {(pendingAttachments.length > 0 || isUploading) && (
                            <div className="mb-3">
                                <div className="flex flex-wrap gap-2 p-1">
                                    {pendingAttachments.map(att => {
                                        const isImage = att.mimeType?.startsWith('image/');
                                        const isPdf = att.mimeType === 'application/pdf';
                                        const isExcel = att.mimeType?.includes('spreadsheet') || att.mimeType?.includes('excel');
                                        const isWord = att.mimeType?.includes('word') || att.mimeType?.includes('wordprocessing');
                                        const isPasted = !!pastedTexts[att.id];
                                        
                                        const iconBg = isPdf ? 'bg-red-500/10 text-red-500'
                                            : isExcel ? 'bg-green-500/10 text-green-600'
                                            : isWord ? 'bg-blue-500/10 text-blue-500'
                                            : isImage ? 'bg-purple-500/10 text-purple-500'
                                            : isPasted ? 'bg-amber-500/10 text-amber-500'
                                            : 'bg-accent-primary/10 text-accent-primary';
                                        const label = isPdf ? 'PDF' : isExcel ? 'Excel' : isWord ? 'Word' : isImage ? 'Image' : isPasted ? 'Pasted Text' : 'Doc';

                                        return (
                                            <div
                                                key={att.id}
                                                className={`relative flex items-center gap-2 p-1.5 ${isPasted ? 'pr-16' : 'pr-8'} bg-background border border-border rounded-xl shadow-sm text-xs animate-in zoom-in-95 duration-200 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors`}
                                                onClick={() => {
                                                    if (isPasted) {
                                                        setEditingDocText(pastedTexts[att.id]);
                                                        setEditingDocId(att.id);
                                                    } else {
                                                        setInlinePreviewAtt(att);
                                                    }
                                                }}
                                                title={isPasted ? "Click to edit text" : "Click to preview"}
                                            >
                                                {isImage && att.url ? (
                                                    <div className="w-9 h-9 rounded-lg shrink-0 overflow-hidden border border-border/50">
                                                        <img src={att.url} alt="" className="w-full h-full object-cover" />
                                                    </div>
                                                ) : (
                                                    <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${iconBg}`}>
                                                        <FileText size={16} />
                                                    </div>
                                                )}
                                                <div className="flex flex-col min-w-0">
                                                    <span className="truncate max-w-[120px] font-medium text-text-primary leading-tight">{att.name}</span>
                                                    <span className="text-[10px] text-text-secondary uppercase tracking-wide flex items-center gap-1">
                                                        {label} {isPasted && <Edit3 size={10} className="inline opacity-70" />}
                                                    </span>
                                                </div>
                                                
                                                {/* Revert to Text Button */}
                                                {isPasted && (
                                                    <button
                                                        onClick={e => {
                                                            e.stopPropagation();
                                                            const txt = pastedTexts[att.id];
                                                            setInput(prev => prev + (prev.trim() ? '\n\n' : '') + txt);
                                                            setPendingAttachments(prev => prev.filter(p => p.id !== att.id));
                                                            // adjust textarea height
                                                            setTimeout(() => {
                                                                const textarea = document.querySelector('textarea');
                                                                if (textarea) {
                                                                    textarea.style.height = 'auto';
                                                                    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
                                                                }
                                                            }, 0);
                                                        }}
                                                        className="absolute top-1 right-7 w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-amber-500 hover:border-amber-500/30 hover:bg-amber-500/10 transition-all shadow-sm"
                                                        title="Extract back to input"
                                                    >
                                                        <ArrowUpFromLine size={11} strokeWidth={2.5} />
                                                    </button>
                                                )}
                                                
                                                {/* Always-visible X */}
                                                <button
                                                    onClick={e => { e.stopPropagation(); setPendingAttachments(prev => prev.filter(p => p.id !== att.id)); }}
                                                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 transition-all shadow-sm"
                                                    title="Remove"
                                                >
                                                    <X size={11} />
                                                </button>
                                            </div>
                                        );
                                    })}

                                    {isUploading && (
                                        <div className="flex items-center gap-2 p-2 px-3 bg-background border border-border rounded-xl shadow-sm text-xs text-text-secondary animate-pulse">
                                            <Loader2 size={14} className="animate-spin" />
                                            <span>Uploading...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {showDivergeUI && !isDragOver && (
                            <div className="absolute -top-10 right-0 animate-in fade-in slide-in-from-bottom-2 duration-300 z-30">
                                <button
                                    onClick={onExitDiverge}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface/90 backdrop-blur-md border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-full shadow-sm text-xs font-medium transition-all"
                                >
                                    <FastForward size={12} />
                                    <span>{' Return to latest'}</span>
                                </button>
                            </div>
                        )}

                        <textarea
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                e.target.style.height = 'auto';
                                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                            }}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder={editingNodeId ? "Finish editing above..." : (isThinkingEnabled ? "Reason away  .  .  .  ." : (showDivergeUI ? "Branch from here..." : "Ask away  .  .  ."))}
                            className="w-full bg-transparent text-text-primary placeholder-text-secondary text-base focus:outline-none resize-none max-h-48 min-h-[44px] leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!!editingNodeId}
                            rows={1}
                        />

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    multiple
                                    onChange={(e) => {
                                        if (e.target.files?.length) handleUpload(e.target.files);
                                        e.target.value = '';
                                    }}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={!!editingNodeId || isUploading}
                                    className="flex items-center justify-center w-8 h-8 text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Attach File"
                                >
                                    <Paperclip size={16} strokeWidth={2.5} />
                                </button>

                                <button
                                    onClick={onToggleThinking}
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${isThinkingEnabled ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5'}`}
                                    title="Toggle Reasoning Model"
                                    disabled={!!editingNodeId}
                                >
                                    <BrainCircuit size={14} />
                                    <span>Reasoning {isThinkingEnabled ? 'On' : 'Off'}</span>
                                </button>
                            </div>

                            <div className="flex items-center gap-3">
                                

                                <button
                                    onClick={isCurrentPathStreaming ? onStop : handleSend}
                                disabled={(!input.trim() && !selectedContext && pendingAttachments.length === 0 && !isCurrentPathStreaming) || (!!editingNodeId && !isCurrentPathStreaming)}
                                className={`
                                    h-9 px-4 flex items-center justify-center rounded-xl transition-all duration-300 gap-2 shadow-sm group
                                    ${isCurrentPathStreaming
                                        ? 'bg-red-500 text-white hover:bg-red-600 hover:shadow-red-500/30 hover:shadow-md'
                                        : (!input.trim() && !selectedContext || !!editingNodeId
                                            ? 'bg-transparent text-text-secondary cursor-not-allowed opacity-50'
                                            : 'bg-text-primary text-background hover:scale-105 hover:shadow-md')
                                    }
                                `}
                            >
                                {isCurrentPathStreaming ? (
                                    <>
                                        <div className="relative flex items-center justify-center w-3.5 h-3.5">
                                            <Square size={12} fill="currentColor" className="relative z-10 transition-transform duration-300 group-hover:scale-90" />
                                            <div className="absolute -inset-1.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xs font-bold">Send</span>
                                        <Send size={14} />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                    <div className="flex items-center justify-between mt-2 px-1 relative">
                        <div className="text-center flex-[2] z-10 pointer-events-none">
                            <span className="text-[11px] text-text-secondary opacity-60">AI can make mistakes. Check important info.</span>
                        </div>

                        {/* Token Tracker pinned nicely to the bottom right under the input */}
                        <div className="flex-[0.5] flex justify-end">
                            {threadTokenUsage && threadTokenUsage.totalTokens > 0 && (
                                <div 
                                    className="relative flex items-center group/stats"
                                >
                                    <div className="flex items-center gap-1.5 px-1 py-1 rounded-full cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-300">
                                        <div className="relative flex items-center justify-center w-[16px] h-[16px] shrink-0">
                                            <svg className="w-full h-full transform -rotate-90 group-hover/stats:scale-105 transition-transform" viewBox="0 0 14 14">
                                                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="2" fill="transparent" className="opacity-20 text-text-secondary" />
                                                <circle
                                                    cx="7" cy="7" r="6"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    fill="transparent"
                                                    strokeDasharray={2 * Math.PI * 6}
                                                    strokeDashoffset={(2 * Math.PI * 6) - (Math.min((threadTokenUsage.totalTokens / 1000000), 1) * (2 * Math.PI * 6))}
                                                    className="text-accent-primary transition-all duration-500 ease-out"
                                                    strokeLinecap="round"
                                                />
                                            </svg>
                                        </div>
                                        <div className="overflow-hidden min-w-0 max-w-0 opacity-0 group-hover/stats:max-w-[40px] group-hover/stats:opacity-100 transition-all duration-500 ease-in-out text-right flex justify-end">
                                            <span className="text-[11px] font-mono font-medium text-text-secondary whitespace-nowrap pl-0.5">
                                                {((threadTokenUsage.totalTokens / 1000000) * 100).toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Inline preview modal for pending attachments (click to preview before sending) */}
            {inlinePreviewAtt && (
                <AttachmentPreviewModal
                    att={inlinePreviewAtt}
                    onClose={() => setInlinePreviewAtt(null)}
                />
            )}

            {/* Edit Pasted Document Modal */}
            {editingDocId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-surface border border-border shadow-2xl rounded-2xl w-full max-w-4xl flex flex-col h-[85vh] animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-background/50">
                            <div>
                                <h3 className="font-semibold text-text-primary text-lg flex items-center gap-2">
                                    <FileText size={18} className="text-amber-500" />
                                    Edit Document Fragment
                                </h3>
                                <p className="text-xs text-text-secondary mt-0.5">
                                    Update the pasted context before the AI analyzes it.
                                </p>
                            </div>
                            <button onClick={() => setEditingDocId(null)} className="text-text-secondary hover:text-text-primary p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 flex flex-col p-4 bg-background overflow-hidden relative">
                            <textarea 
                                className="w-full h-full bg-surface border border-border/50 rounded-xl p-5 text-text-primary focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 resize-none font-mono text-sm leading-loose shadow-inner overflow-y-auto"
                                value={editingDocText}
                                onChange={(e) => setEditingDocText(e.target.value)}
                                placeholder="Pasted content goes here..."
                            />
                        </div>
                        <div className="p-4 border-t border-border/50 flex justify-between items-center bg-background/50">
                            <div className="text-xs text-text-secondary font-medium px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5">
                                {editingDocText.trim().split(/\s+/).filter(x => x.length > 0).length.toLocaleString()} words
                            </div>
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setEditingDocId(null)}
                                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleSaveEditedDoc}
                                    disabled={isUploading || !editingDocText.trim()}
                                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isUploading ? <Loader2 size={16} className="animate-spin"/> : <Edit3 size={16}/>}
                                    Save Changes
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default ChatInput;
