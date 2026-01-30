import React, { useState, useRef } from 'react';
import { Send, Quote, X, BrainCircuit, Square, FastForward, GitFork, ArrowDown } from 'lucide-react';
import { hasApiKey } from '../services/geminiService';

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
    onSendMessage: (content: string) => void;
    onStop: () => void;
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
}) => {
    const [input, setInput] = useState('');

    // --- Drag to Scroll Hook Logic (Moved from App.tsx) ---
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
        const walk = (x - startX.current) * 1.5; // Scroll-fast
        scrollRef.current.scrollLeft = scrollLeft.current - walk;
    };

    const handleSend = () => {
        if (!input.trim() && !selectedContext) return;
        onSendMessage(input);
        setInput('');
        // Reset textarea height
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
        <div className="p-4 bg-background z-20 shrink-0">
            <div className={`mx-auto ${isSidebarOpen ? 'max-w-3xl' : 'max-w-5xl'} transition-all duration-300 ease-in-out relative`}>

                {/* Scroll To Bottom Button - Floating Action Button */}
                {!isAtBottom && (
                    <div className="absolute -top-20 left-1/2 -translate-x-1/2 z-30 animate-in fade-in zoom-in slide-in-from-bottom-2 duration-300 pointer-events-auto">
                        <button
                            onClick={onScrollToBottom}
                            className="flex items-center justify-center w-10 h-10 bg-surface/80 backdrop-blur-md border border-border/50 rounded-full shadow-lg text-text-secondary hover:text-accent-primary hover:border-accent-primary/30 hover:bg-surface hover:scale-110 transition-all duration-300 group"
                            title="Resume Auto-Scroll"
                        >
                            <ArrowDown size={18} className="group-hover:scale-110 transition-transform duration-300" />

                            {/* Pulse ring if active generation */}
                            {isCurrentPathStreaming && (
                                <span className="absolute inset-0 rounded-full border-2 border-accent-primary/30 animate-ping opacity-20 pointer-events-none"></span>
                            )}
                        </button>
                    </div>
                )}

                {/* Suggestions Bar (Absolute positioned above input) */}
                <div className={`
            absolute bottom-full left-0 right-0 z-20 
            transition-all duration-500 ease-out
            ${suggestions.length > 0 && !selectedContext && isAtBottom && !editingNodeId
                        ? 'opacity-100 translate-y-0 visible'
                        : 'opacity-0 translate-y-4 invisible pointer-events-none'}
        `}>
                    {/* Floating Container matching input width */}
                    <div className="relative w-full">
                        {/* Gradient Masks */}
                        <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
                        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />

                        <div
                            ref={scrollRef}
                            onMouseDown={handleMouseDown}
                            onMouseLeave={handleMouseLeave}
                            onMouseUp={handleMouseUp}
                            onMouseMove={handleMouseMove}
                            className="flex overflow-x-auto gap-3 py-4 w-full px-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] cursor-grab active:cursor-grabbing mask-image-linear-gradient"
                        >
                            {suggestions.map((suggestion, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        if (!isDragging.current) {
                                            setInput(suggestion);
                                            // Handle auto-height for textarea
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
                                    className={`
                                whitespace-nowrap flex-shrink-0
                                px-5 py-2.5 text-xs sm:text-sm font-medium rounded-xl
                                bg-surface border border-border/50
                                text-text-secondary hover:text-text-primary
                                hover:border-accent-primary/50 hover:shadow-[0_2px_8px_rgba(0,0,0,0.05)]
                                transition-all duration-300 ease-out select-none
                                shadow-sm
                                animate-in slide-in-from-bottom-4 fade-in fill-mode-backwards
                            `}
                                    style={{ animationDelay: `${200 + (idx * 100)}ms` }}
                                >
                                    {suggestion}
                                </button>
                            ))}
                            <div className="w-4 flex-shrink-0" />
                        </div>
                    </div>
                </div>

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
                        <button
                            onClick={onClearContext}
                            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}

                <div className={`
            relative flex flex-col p-3 rounded-2xl border transition-all duration-300 shadow-sm
            bg-surface focus-within:shadow-md
            ${showDivergeUI
                        ? 'border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.1)] ring-1 ring-amber-500/20'
                        : 'border-border focus-within:border-accent-primary/50 focus-within:ring-1 focus-within:ring-accent-primary/20'}
         `}>

                    {showDivergeUI && (
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
                        placeholder={!hasApiKey() ? "Say Hi to get started" : (editingNodeId ? "Finish editing above..." : (isThinkingEnabled ? "Reason away  .  .  .  ." : (showDivergeUI ? "Branch from here..." : "Ask away  .  .  .")))}
                        className="w-full bg-transparent text-text-primary placeholder-text-secondary text-base focus:outline-none resize-none max-h-48 min-h-[44px] leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!!editingNodeId}
                        rows={1}
                    />

                    <div className="flex items-center justify-between">
                        <button
                            onClick={onToggleThinking}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${isThinkingEnabled ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5'}`}
                            title="Toggle Reasoning Model"
                            disabled={!!editingNodeId}
                        >
                            <BrainCircuit size={14} />
                            <span>Reasoning {isThinkingEnabled ? 'On' : 'Off'}</span>
                        </button>

                        <button
                            onClick={isCurrentPathStreaming ? onStop : handleSend}
                            disabled={(!input.trim() && !selectedContext && !isCurrentPathStreaming) || (!!editingNodeId && !isCurrentPathStreaming)}
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
                                        {/* The Stop Square */}
                                        <Square size={12} fill="currentColor" className="relative z-10 transition-transform duration-300 group-hover:scale-90" />

                                        {/* The Spinning Loading Ring around it */}
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
                <div className="text-center mt-2">
                    <span className="text-[11px] text-text-secondary opacity-60">AI can make mistakes. Check important info.</span>
                </div>
            </div>
        </div>
    );
};

export default ChatInput;
