import React, { useState, useRef, useEffect } from 'react';
import { MessageNode, Role } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { GitBranch, Edit2, Check, Copy, Sparkles, GitFork, BrainCircuit, ChevronDown, ChevronRight, Loader2, MessageSquarePlus, Terminal, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vscLightPlus } from './MarkdownRenderer';
import { ThemeContext } from '../contexts/ThemeContext';

const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  'get_syntax_docs': 'Reading documentation',
  'get_config_docs': 'Reading configuration',
  'render_diagram': 'Drawing diagram',
};

const ToolCallBlock = ({ name, args, status, errorMessage }: { name: string, args: any, status: 'running' | 'success' | 'error', errorMessage?: string }) => {
  const [isExpanded, setIsExpanded] = useState(status === 'running' || status === 'error');
  const themeContext = React.useContext(ThemeContext);
  const isDarkMode = (themeContext?.theme ?? 'dark') === 'dark';

  const friendlyName = TOOL_FRIENDLY_NAMES[name] || name;
  const displayName = status === 'running' ? `${friendlyName} . . .` :
    status === 'success' ? `Used ${friendlyName}` :
      `Failed ${friendlyName}`;

  // Auto-collapse on success, expand on error/running
  useEffect(() => {
    if (status === 'success') {
      setIsExpanded(false);
    } else if (status === 'error' || status === 'running') {
      setIsExpanded(true);
    }
  }, [status]);

  // Match the Reasoning gradient style
  const gradientClass = "bg-clip-text text-transparent bg-gradient-to-r from-zinc-500 via-zinc-800 to-zinc-500 dark:from-zinc-400 dark:via-zinc-100 dark:to-zinc-400 bg-[length:200%_auto]";
  const errorClass = "text-red-500 dark:text-red-400"; // Fallback for errors if we want them distinct, or just use gradient? User said "same as thinking". I'll use gradient for consistency but maybe error should be distinct. I'll stick to gradient for "Used" and "Running", error distinct.

  return (
    <div className="mb-2 group/tool">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 py-1 select-none transition-opacity opacity-80 hover:opacity-100"
      >
        {/* Shimmering Text Effect for Label */}
        <span className={`text-sm font-medium ${status === 'error' ? errorClass : gradientClass} ${status === 'running' ? 'animate-shimmer' : ''}`}>
          {displayName}
        </span>

        {/* Status Indicator / Toggle */}
        <div className="flex items-center gap-2">
          {status === 'running' && <Loader2 size={12} className="animate-spin text-text-secondary" />}
          {isExpanded ? <ChevronDown size={14} className="text-text-secondary" /> : <ChevronRight size={14} className="text-text-secondary" />}
        </div>
      </button>

      {isExpanded && (
        <div className="relative mt-1 pl-4 ml-2.5 border-l-2 border-border/60 animate-in slide-in-from-top-1 fade-in duration-300">
          <div className="text-xs font-mono opacity-80 py-1 overflow-x-auto">
            <SyntaxHighlighter
              style={(isDarkMode ? vscDarkPlus : vscLightPlus) as any}
              language="json"
              PreTag="div"
              customStyle={{
                margin: 0,
                padding: '0',
                fontSize: '11px',
                lineHeight: '1.5',
                background: 'transparent'
              }}
              wrapLongLines={true}
            >
              {JSON.stringify(args, null, 2)}
            </SyntaxHighlighter>

            {status === 'error' && errorMessage && (
              <div className="mt-2 text-red-500 break-words font-sans text-xs">
                Error: {errorMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface ChatMessageProps {
  node: MessageNode;
  isHead: boolean;
  onBranch: (nodeId: string) => void;
  onQuote: (content: string, nodeId: string, shouldBranch?: boolean) => void;
  onEdit: (nodeId: string, newContent: string) => void;
  onDelete?: (nodeId: string) => void;
  isActivePath: boolean;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
  isThinkingEnabled: boolean;
  onSuggestionClick?: (suggestion: string, nodeId: string) => void;
  isAnyEditing?: boolean;
}

const ChatMessagePoly: React.FC<ChatMessageProps> = ({ node, isHead, onBranch, onQuote, onEdit, onDelete: _onDelete, isActivePath, isEditing = false, setIsEditing, isThinkingEnabled: _isThinkingEnabled, onSuggestionClick, isAnyEditing = false }) => {
  const isUser = node.role === Role.USER;

  // Hydrate content: Decode hidden artifacts and replace references
  const hydratedContent = React.useMemo(() => {
    let content = node.content;
    const mappings = new Map<string, string>();

    // Extract hidden data
    const hiddenDataRegex = /<hidden_data key="([^"]+)" type="url">([^<]+)<\/hidden_data>/g;
    let match;
    while ((match = hiddenDataRegex.exec(content)) !== null) {
      mappings.set(match[1], match[2]);
    }

    // Remove hidden tags
    content = content.replace(/<hidden_data[^>]*>.*?<\/hidden_data>/gs, '');

    // Replace aliases with full URLs (globally in the text)
    mappings.forEach((fullUrl, alias) => {
      content = content.split(alias).join(fullUrl);
    });

    return content;
  }, [node.content]);

  // Local state for the content being typed, but visibility is controlled by parent prop
  const [editContent, setEditContent] = useState(hydratedContent);
  const [isCopied, setIsCopied] = useState(false);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  // Selection / Diverge State
  const [selectionRect, setSelectionRect] = useState<{ top: number, left: number } | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  // Logic to handle thoughts (prefer native node.thought, fallback to <think> parsing)
  const nativeThought = node.thought;
  const thinkMatch = hydratedContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
  const parsedThought = thinkMatch ? thinkMatch[1] : null;

  const thoughtContent = nativeThought || parsedThought;

  // Logic to handle suggestions
  const suggestionsMatch = hydratedContent.match(/<suggestions>([\s\S]*?)(?:<\/suggestions>|$)/);

  // Chain replacements to clean main content
  let mainContent = typeof nativeThought === 'string'
    ? hydratedContent
    : (thinkMatch ? hydratedContent.replace(/<think>[\s\S]*?<\/think>/, '').replace(/<think>[\s\S]*/, '').trim() : hydratedContent);

  // Remove suggestions
  if (suggestionsMatch) {
    mainContent = mainContent.replace(/<suggestions>[\s\S]*?<\/suggestions>/, '').replace(/<suggestions>[\s\S]*/, '').trim();
  }

  // Remove summary
  const summaryMatch = mainContent.match(/<summary[\s\S]*?>([\s\S]*?)(?:<\/summary>|$)/i);
  if (summaryMatch) {
    mainContent = mainContent.replace(/<summary[\s\S]*?>[\s\S]*?<\/summary>/gi, '').replace(/<summary[\s\S]*?>[\s\S]*/gi, '').trim();
  }

  // Format timestamp
  const time = new Date(node.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleSaveEdit = () => {
    if (editContent.trim() !== node.content) {
      onEdit(node.id, editContent);
    }
    setIsEditing?.(false);
  };

  const handleCancelEdit = () => {
    setIsEditing?.(false);
    setEditContent(node.content);
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(mainContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  useEffect(() => {
    const handleSelection = () => {
      if (!contentRef.current || !messageRef.current || isAnyEditing || isUser) {
        setSelectionRect(null);
        return;
      }

      const selection = window.getSelection();

      // If we have an active suggestion context menu, don't clear it on selection change unless clicking away
      if (activeSuggestion) {
        // This is handled by the document click listener usually, but we need to be careful
        return;
      }

      if (!selection || selection.isCollapsed) {
        setSelectionRect(null);
        return;
      }

      // Check if selection is inside this message
      if (contentRef.current.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const parentRect = messageRef.current.getBoundingClientRect();

        setSelectionRect({
          top: rect.top - parentRect.top - 44, // position above with a bit more offset
          left: rect.left - parentRect.left + (rect.width / 2) - 35 // centered
        });
        setActiveSuggestion(null); // Clear suggestion focus
      }
      else {
        setSelectionRect(null);
      }
    };

    const handleGlobalClick = (e: MouseEvent) => {
      // Clear selection rect on click if it was from a suggestion context menu
      if (activeSuggestion) {
        setSelectionRect(null);
        setActiveSuggestion(null);
      }
    };

    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('selectionchange', handleSelection);
    document.addEventListener('click', handleGlobalClick);

    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('selectionchange', handleSelection);
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [activeSuggestion, isAnyEditing, isUser]);

  const handleSelectionAction = (e: React.MouseEvent, shouldBranch: boolean) => {
    e.stopPropagation();

    if (activeSuggestion) {
      onQuote(activeSuggestion, node.id, true);
    } else {
      const selection = window.getSelection();
      const text = selection?.toString();
      if (text) {
        onQuote(text, node.id, shouldBranch);
      } else {
        onBranch(node.id);
      }
    }

    setSelectionRect(null);
    setActiveSuggestion(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleSuggestionRightClick = (e: React.MouseEvent, suggestion: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!messageRef.current) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const parentRect = messageRef.current.getBoundingClientRect();

    setSelectionRect({
      top: rect.top - parentRect.top - 40,
      left: rect.left - parentRect.left + (rect.width / 2) - 30
    });
    setActiveSuggestion(suggestion);
  };

  // UseMemo for rendering content with tool blocks
  const renderedContentComponents = React.useMemo(() => {
    // Regex matches: text... <function_call name="..." args="..." /> ...text... <function_result>...</function_result>
    // We need to split by tags and reconstruct the sequence

    // Split by function_call tag
    const parts = hydratedContent.split(/(<function_call\s+name="[^"]*"\s+args='[^']*'\s*\/>)/g);

    const components: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // Check if this part is a function call tag
      const callMatch = part.match(/<function_call\s+name="([^"]*)"\s+args='([^']*)'\s*\/>/);

      if (callMatch) {
        const name = callMatch[1];
        const argsRaw = callMatch[2].replace(/&#39;/g, "'");
        let args = {};
        try {
          args = JSON.parse(argsRaw);
        } catch (e) {
          console.error("Failed to parse args", e);
          args = { raw: argsRaw };
        }

        // Look ahead for the result in the *next* parts 
        let status: 'running' | 'success' | 'error' = 'running';
        let errorMessage = undefined;

        // Simple parser: check if the string immediately following this tag (in the original or next part) contains the result
        if (i + 1 < parts.length) {
          const resultMatch = parts[i + 1].match(/<function_result\s+status="([^"]*)"(?:>([\s\S]*?)<\/function_result>)?/);
          if (resultMatch) {
            status = resultMatch[1] as 'success' | 'error' | 'success';
            if (status === 'error') {
              errorMessage = resultMatch[2];
            }

            // Consume the result tag
            parts[i + 1] = parts[i + 1].replace(/<function_result\s+status="[^"]*"(?:>[\s\S]*?<\/function_result>)?/, '');
          }
        }

        components.push(
          <ToolCallBlock
            key={`tool-${i}`}
            name={name}
            args={args}
            status={status}
            errorMessage={errorMessage}
          />
        );
      } else {
        // It's normal text (or empty)
        // Handle suggestions stripping here or in main render
        let contentPart = part;
        const suggestionsMatch = contentPart.match(/<suggestions>([\s\S]*?)(?:<\/suggestions>|$)/);
        if (suggestionsMatch) {
          contentPart = contentPart.replace(/<suggestions>[\s\S]*?<\/suggestions>/, '').replace(/<suggestions>[\s\S]*/, '').trim();
        }

        // Remove summary from rendered parts
        const summaryPartMatch = contentPart.match(/<summary>([\s\S]*?)(?:<\/summary>|$)/);
        if (summaryPartMatch) {
          contentPart = contentPart.replace(/<summary>[\s\S]*?<\/summary>/, '').replace(/<summary>[\s\S]*/, '').trim();
        }

        if (contentPart && contentPart.trim() !== '') {
          components.push(
            <MarkdownRenderer key={`text-${i}`} content={contentPart} />
          );
        }
      }
    }

    return components;

  }, [hydratedContent]);




  const isThinking = node.isStreaming && (
    (node.wasThinkingEnabled && node.content.length === 0) || // Currently streaming native thoughts
    (parsedThought && !node.content.includes('<\/think>')) // Currently streaming <think> tags
  );

  // Auto-expand/collapse based on thinking state transitions
  const wasThinkingRef = useRef(false);
  // Sync thinking state with ref to avoid effect loop
  useEffect(() => {
    if (isThinking && !wasThinkingRef.current) {
      // We only want to auto-expand on transition
      setTimeout(() => setIsThinkingExpanded(true), 0);
    } else if (!isThinking && wasThinkingRef.current) {
      setTimeout(() => setIsThinkingExpanded(false), 0);
    }
    wasThinkingRef.current = !!isThinking;
  }, [isThinking]);

  return (
    <div ref={messageRef} className={`w-full flex ${isUser ? 'justify-end' : 'justify-start'} group mb-6 relative`}>

      {/* Floating Selection Menu */}
      {selectionRect && (
        <div
          style={{ top: selectionRect.top, left: selectionRect.left }}
          className="absolute z-50 bg-surface border border-border shadow-lg rounded-lg p-1 animate-in fade-in zoom-in duration-200 pointer-events-auto flex gap-1"
        >
          {activeSuggestion ? (
            <button
              onClick={(e) => handleSelectionAction(e, true)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
            >
              <GitFork size={14} className="text-accent-primary" />
              Diverge
            </button>
          ) : (
            <>
              <button
                onClick={(e) => handleSelectionAction(e, false)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
                title="Ask about this selection in the current chat"
              >
                <MessageSquarePlus size={14} className="text-accent-primary" />
                Ask
              </button>
              {!isHead && (
                <>
                  <div className="w-px bg-border my-1" />
                  <button
                    onClick={(e) => handleSelectionAction(e, true)}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
                    title="Start a new branch from here"
                  >
                    <GitFork size={14} className="text-accent-primary" />
                    Diverge
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className={`flex w-full ${isUser ? 'max-w-[85%] sm:max-w-[75%]' : 'max-w-full'} gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start`}>

        {/* Content Container */}
        <div className={`flex flex-col min-w-0 flex-1 ${isUser ? 'items-end' : 'items-start'}`}>

          {/* Bubble / Text Area */}
          <div
            ref={contentRef}
            className={`
                relative text-[0.95rem] leading-7 transition-all duration-300 min-w-0 max-w-full
                ${isUser
                ? 'bg-black/5 dark:bg-white/10 text-text-primary px-5 py-3 rounded-3xl rounded-tr-md'
                : 'text-text-primary px-0 py-0 bg-transparent'}
                ${isActivePath ? 'opacity-100' : 'opacity-60 grayscale-[0.3]'}
              `}
          >

            {isEditing ? (
              <div className="w-full min-w-[300px] bg-surface border border-amber-500/50 rounded-xl p-3 shadow-[0_0_15px_rgba(245,158,11,0.15)] ring-1 ring-amber-500/20 animate-in fade-in zoom-in-95 duration-200">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-transparent border-none focus:ring-0 resize-none min-h-[100px] text-text-primary p-1 text-sm font-sans"
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-primary text-white hover:brightness-110"
                  >
                    Save & Branch
                  </button>
                </div>
              </div>
            ) : (
              <div className={`break-words ${isUser ? '' : 'w-full markdown-content'}`}>
                {node?.isStreaming && !node.wasThinkingEnabled && (
                  <div className="mb-2 group/think">
                    <div
                      className="flex items-center gap-2 py-1 select-none transition-opacity opacity-80 hover:opacity-100"
                    >
                      {/* Shimmering Text Effect for Label */}
                      <span className={`text-sm font-medium bg-clip-text text-transparent bg-gradient-to-r from-zinc-500 via-zinc-800 to-zinc-500 dark:from-zinc-400 dark:via-zinc-100 dark:to-zinc-400 bg-[length:200%_auto] animate-shimmer`}>
                        Thinking . . .
                      </span>

                    </div>
                  </div>
                )}

                {/* Thinking Block */}
                {(node.wasThinkingEnabled || parsedThought) && (!isUser && (thoughtContent || (node.isStreaming && node.content.length === 0))) && (
                  <div className="mb-2 group/think">
                    <button
                      onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                      className="flex items-center gap-2 py-1 select-none transition-opacity opacity-80 hover:opacity-100"
                    >
                      {/* Shimmering Text Effect for Label */}
                      <span className={`text-sm font-medium bg-clip-text text-transparent bg-gradient-to-r from-zinc-500 via-zinc-800 to-zinc-500 dark:from-zinc-400 dark:via-zinc-100 dark:to-zinc-400 bg-[length:200%_auto] ${isThinking ? 'animate-shimmer' : ''}`}>
                        {thoughtContent ? 'Reasoning' : 'Thinking . . .'}
                      </span>
                      {thoughtContent ? (isThinkingExpanded ? <ChevronDown size={14} className="text-text-secondary" /> : <ChevronRight size={14} className="text-text-secondary" />) : null}
                    </button>

                    {isThinkingExpanded && thoughtContent && (
                      <div className="relative mt-1 pl-4 ml-2.5 border-l-2 border-border/60 animate-in slide-in-from-top-1 fade-in duration-300">
                        <div className="text-sm text-zinc-500 dark:text-zinc-500 opacity-70 leading-relaxed font-normal py-1 [&_p]:text-inherit [&_li]:text-inherit [&_h1]:text-inherit [&_h2]:text-inherit [&_strong]:text-inherit">
                          <MarkdownRenderer content={thoughtContent} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {renderedContentComponents}
              </div>
            )}

          </div>

          {/* Action Bar (Below message) */}
          {!node.isStreaming && (
            <div className={`flex items-center gap-2 mt-1.5 select-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
              <span className="text-[10px] text-text-secondary/50 font-medium font-mono">{time}</span>

              {node.childrenIds.length > 0 && !isUser && (
                <button
                  onClick={() => { /* Navigation logic handled by graph or parent */ }}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-accent-primary mr-2"
                  title="This message has branches"
                >
                  <GitBranch size={12} />
                  <span>{node.childrenIds.length} alt</span>
                </button>
              )}

              <button
                onClick={handleCopyMessage}
                className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
                title="Copy"
              >
                {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>

              {!isUser && !isHead && (
                <button
                  onClick={(e) => { e.stopPropagation(); onBranch(node.id); }}
                  className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
                  title="Diverge / Branch from here"
                >
                  <GitFork size={14} />
                </button>
              )}

              {isUser && !isEditing && (
                <button
                  onClick={() => setIsEditing?.(true)}
                  className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
                  title="Edit"
                >
                  <Edit2 size={14} />
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default React.memo(ChatMessagePoly);