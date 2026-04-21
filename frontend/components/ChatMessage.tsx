import React, { useState, useRef, useEffect } from 'react';
import { MessageNode, Role, Attachment } from '../types';
import MarkdownRenderer, { ImageWithPreview } from './MarkdownRenderer';
import { GitBranch, Edit2, Check, Copy, Sparkles, GitFork, BrainCircuit, ChevronDown, ChevronRight, Loader2, MessageSquarePlus, Terminal, CheckCircle2, XCircle, AlertTriangle, FileText, X, Download, ExternalLink, Paperclip, HelpCircle, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vscLightPlus } from './MarkdownRenderer';
import { ThemeContext } from '../contexts/ThemeContext';
import AttachmentPreviewArea from './AttachmentPreviewModal';
import { CognitiveMapView } from './CognitiveMapView';

const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  'get_syntax_docs': 'Reading documentation',
  'get_config_docs': 'Reading configuration',
  'render_diagram': 'Drawing diagram',
  'generate_cognitive_map': 'Building X-Ray Map',
};

const ToolCallBlock = ({ name, args, status, errorMessage }: { name: string, args: any, status: 'running' | 'success' | 'error', errorMessage?: string }) => {
  const [isExpanded, setIsExpanded] = useState(status === 'running' || status === 'error');
  const themeContext = React.useContext(ThemeContext);
  const isDarkMode = (themeContext?.theme ?? 'dark') === 'dark';

  const friendlyName = TOOL_FRIENDLY_NAMES[name] || name;
  const displayName = status === 'running' ? `${friendlyName} . . .` :
    status === 'success' ? `${friendlyName}` :
      `Failed ${friendlyName}`;

  // Auto-collapse on success, expand on error/running
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    setIsExpanded(status === 'error' || status === 'running');
  }

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
  sessionId?: string;
  isHead: boolean;
  onBranch: (nodeId: string) => void;
  onQuote: (content: string, nodeId: string, shouldBranch?: boolean) => void;
  onEdit: (nodeId: string, newContent: string, attachments?: any[]) => void;
  onDelete?: (nodeId: string) => void;
  onClarify?: (nodeId: string, selectedText: string, question: string, threadId?: string) => Promise<void>;
  isActivePath: boolean;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
  isThinkingEnabled: boolean;
  onSuggestionClick?: (suggestion: string, nodeId: string) => void;
  isAnyEditing?: boolean;
}

const ChatMessagePoly: React.FC<ChatMessageProps> = ({ node, sessionId, isHead, onBranch, onQuote, onEdit, onDelete: _onDelete, onClarify, isActivePath, isEditing = false, setIsEditing, isThinkingEnabled: _isThinkingEnabled, onSuggestionClick, isAnyEditing = false }) => {
  const isUser = node.role === Role.USER;

  // Hydrate content: Decode hidden artifacts and replace references
  const { hydratedContent, cognitiveMaps } = React.useMemo(() => {
    let content = node.content;
    const mappings = new Map<string, string>();
    const cogMaps = new Map<string, any>();

    // Extract hidden data url
    const hiddenDataRegexUrl = /<hidden_data key="([^"]+)" type="url">([^<]+)<\/hidden_data>/g;
    let match;
    while ((match = hiddenDataRegexUrl.exec(content)) !== null) {
      mappings.set(match[1], match[2]);
    }

    // Extract hidden data cognitive map
    const hiddenDataRegexCog = /<hidden_data key="([^"]+)" type="cognitive-map">([^<]+)<\/hidden_data>/g;
    while ((match = hiddenDataRegexCog.exec(content)) !== null) {
      try {
        cogMaps.set(match[1], JSON.parse(match[2]));
      } catch (e) {
        console.error("Failed to parse cognitive map JSON", e);
      }
    }

    // Remove hidden tags
    content = content.replace(/<hidden_data[^>]*>.*?<\/hidden_data>/gs, '');

    // Replace aliases with full URLs (globally in the text)
    mappings.forEach((fullUrl, alias) => {
      content = content.split(alias).join(fullUrl);
    });

    // Highlight clarified text (handle overlaps and multi-paragraphs flawlessly)
    if (node.clarifications && node.clarifications.length > 0) {
      type Chunk = { text: string; isLink: boolean; id: string };
      let chunks: Chunk[] = [{ text: content, isLink: false, id: '' }];

      // Sort by length descending so larger selections get priority and don't get broken by inner substrings
      const sorted = [...node.clarifications].sort((a, b) => (b.selectedText?.length || 0) - (a.selectedText?.length || 0));

      sorted.forEach(c => {
        const sel = c.selectedText;
        if (sel && sel.trim().length > 0) {
          const newChunks: Chunk[] = [];
          let replaced = false;
          for (const chunk of chunks) {
            if (replaced || chunk.isLink || !chunk.text.includes(sel)) {
              newChunks.push(chunk);
              continue;
            }
            // Replace ONLY the first occurrence in the eligible chunk
            const idx = chunk.text.indexOf(sel);
            const before = chunk.text.slice(0, idx);
            const after = chunk.text.slice(idx + sel.length);

            if (before) newChunks.push({ text: before, isLink: false, id: '' });
            newChunks.push({ text: sel, isLink: true, id: c.id });
            if (after) newChunks.push({ text: after, isLink: false, id: '' });
            replaced = true;
          }
          chunks = newChunks;
        }
      });
 
      content = chunks.map(chunk => {
        if (chunk.isLink) {
          // Splitting by \n\n boundaries because markdown links cannot span across paragraphs
          const paragraphs = chunk.text.split(/(\n\n+)/);
          return paragraphs.map(p => {
            if (p.trim().length === 0) return p; // Preserve exact whitespace/newlines
            const safeP = p.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
            return `[${safeP}](#clarify-${chunk.id})`;
          }).join('');
        }
        return chunk.text;
      }).join('');
    }

    return { hydratedContent: content, cognitiveMaps: Array.from(cogMaps.values()) };
  }, [node.content, node.clarifications]);

  // Local state for the content being typed, but visibility is controlled by parent prop
  const [editContent, setEditContent] = useState(hydratedContent);
  const [editAttachments, setEditAttachments] = useState<Attachment[]>(node.attachments || []);
  const [isCopied, setIsCopied] = useState(false);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selection / Diverge State
  const [selectionRect, setSelectionRect] = useState<{ top: number, left: number } | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  // Clarification State
  const [clarifyMode, setClarifyMode] = useState<{ top: number, left: number, text: string } | null>(null);
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [isClarifying, setIsClarifying] = useState(false);
  const [clarificationError, setClarificationError] = useState<string | null>(null);
  const [activeClarificationId, setActiveClarificationId] = useState<string | null>(null);

  useEffect(() => {
    const handleClarifyClick = (e: Event) => {
      const id = (e as CustomEvent).detail;
      // Only set if this ID belongs to the current node
      if (node.clarifications?.some(c => c.id === id)) {
        setActiveClarificationId(prev => prev === id ? null : id);
      }
    };
    window.addEventListener('clarify-click', handleClarifyClick);
    return () => window.removeEventListener('clarify-click', handleClarifyClick);
  }, [node.clarifications]);

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
    onEdit(node.id, editContent, editAttachments);
    setIsEditing?.(false);
  };

  const handleCancelEdit = () => {
    setIsEditing?.(false);
    setEditContent(node.content);
    setEditAttachments(node.attachments || []);
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
        setEditAttachments(prev => [...prev, ...data.data]);
      } else {
        setUploadError(data.error || 'Upload failed. Please try again.');
        setTimeout(() => setUploadError(null), 4000);
      }
    } catch (err) {
      console.error('[Upload Error]', err);
      setUploadError('Upload failed. Please try again.');
      setTimeout(() => setUploadError(null), 4000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(mainContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  useEffect(() => {
    const handleSelection = () => {
      // Do nothing globally if clarifying, we don't want to dismiss the clarify box from normal selections.
      if (clarifyMode) {
        return;
      }

      if (!contentRef.current || !messageRef.current || isAnyEditing) {
        setSelectionRect(null);
        return;
      }

      const selection = window.getSelection();

      // If we have an active suggestion or clarification context menu open, don't clear it on text selection change
      if (activeSuggestion || clarifyMode) {
        return;
      }

      if (!selection || selection.isCollapsed) {
        setSelectionRect(null);
        return;
      }

      // Check if selection is inside this message
      if (contentRef.current.contains(selection.anchorNode)) {
        // Exclude selections inside the clarify box
        const anchorElement = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
        if (anchorElement && anchorElement.closest('.clarify-box-content')) {
          setSelectionRect(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const parentRect = messageRef.current.getBoundingClientRect();
        
        let safeLeft = rect.left - parentRect.left + (rect.width / 2);
        // Constrain left position so the popup doesn't overflow parent
        safeLeft = Math.max(120, Math.min(safeLeft, parentRect.width - 150));

        let topPos = rect.top - parentRect.top - 48; // default to above selection
        
        // If the popup would hit the top of the viewport and clip, place it below the selection instead
        if (rect.top < 60) {
          topPos = rect.bottom - parentRect.top + 8;
        }

        setSelectionRect({
          top: topPos,
          left: safeLeft
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
      
      // If clicking outside clarify mode popover, we might want to close it, 
      // but only if it's not during interaction. A simpler approach is to rely 
      // on the Esc key or 'X' button to prevent lost text. So we leave it open.
    };

    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('selectionchange', handleSelection);
    document.addEventListener('click', handleGlobalClick);

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (clarifyMode) {
          setClarifyMode(null);
          setClarifyQuestion('');
          setClarificationError(null);
        }
        if (activeSuggestion) {
          setActiveSuggestion(null);
          setSelectionRect(null);
        }
      }
    };
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('selectionchange', handleSelection);
      document.removeEventListener('click', handleGlobalClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [activeSuggestion, clarifyMode, isAnyEditing, isUser]);

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
        let diagramUrl: string | undefined = undefined;

        // Simple parser: check if the string immediately following this tag (in the original or next part) contains the result
        if (i + 1 < parts.length) {
          const resultMatch = parts[i + 1].match(/<function_result\s+status="([^"]*)"(?:>([\s\S]*?)<\/function_result>)?/);
          if (resultMatch) {
            status = resultMatch[1] as 'success' | 'error' | 'success';
            if (status === 'error') {
              errorMessage = resultMatch[2];
            } else if (status === 'success' && name === 'render_diagram' && resultMatch[2]) {
              // The hydratedContent has already replaced the alias with the full mermaid.ink URL
              const urlMatch = resultMatch[2].match(/https?:\/\/[^\s<"']+/);
              if (urlMatch) diagramUrl = urlMatch[0];
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

        // Render diagram image inline immediately after the tool block
        if (diagramUrl) {
          components.push(
            <div key={`diagram-${i}`} className="my-2">
              <ImageWithPreview src={diagramUrl} alt="Generated Diagram" title="Generated Diagram" />
            </div>
          );
        }
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

    if (cognitiveMaps && cognitiveMaps.length > 0) {
      cognitiveMaps.forEach((cogMap, idx) => {
        components.push(
          <div key={`cogmap-${idx}`} className="my-3">
            <CognitiveMapView data={cogMap} />
          </div>
        );
      });
    }

    return components;

  }, [hydratedContent, cognitiveMaps]);




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
          style={{ top: selectionRect.top, left: selectionRect.left, transform: 'translateX(-50%)' }}
          className="absolute z-50 bg-surface border border-border shadow-lg rounded-lg p-1 animate-in fade-in zoom-in duration-200 pointer-events-auto flex gap-1 select-none"
          onMouseDown={(e) => e.preventDefault()} // Prevent clicking the menu from altering text selection
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
              <div className="w-px bg-border my-1" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedText = window.getSelection()?.toString() || '';
                  if (selectedText && selectionRect) {
                    setClarifyMode({ ...selectionRect, text: selectedText });
                  }
                  setSelectionRect(null);
                  setActiveSuggestion(null);
                }}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
                title="Get an inline AI clarification for this text"
              >
                <BrainCircuit size={14} className="text-accent-primary" />
                Clarify
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

      {/* Clarification Input Popover */}
      {clarifyMode && (
        <div
          style={{ top: clarifyMode.top, left: clarifyMode.left, transform: 'translateX(-50%)' }}
          className="absolute z-50 bg-surface border border-border shadow-xl rounded-lg p-3 animate-in fade-in zoom-in duration-200 pointer-events-auto flex flex-col gap-2 min-w-[250px] sm:min-w-[300px] max-w-[80vw]"
        >
          <div className="text-[0.8rem] font-medium text-text-secondary w-full border-l-2 border-accent-primary pl-2 italic overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            "{clarifyMode.text}"
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={clarifyQuestion}
              onChange={(e) => setClarifyQuestion(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Escape') {
                  setClarifyMode(null);
                  setClarifyQuestion('');
                  setClarificationError(null);
                } else if (e.key === 'Enter' && clarifyQuestion.trim() && !isClarifying) {
                  setIsClarifying(true);
                  setClarificationError(null);
                  try {
                    if (onClarify) {
                      await onClarify(node.id, clarifyMode.text, clarifyQuestion.trim());
                      setClarifyMode(null);
                      setClarifyQuestion('');
                    } else {
                      setClarificationError("Clarify callback missing");
                    }
                  } catch (err: any) {
                    setClarificationError(err.message || 'Failed to clarify');
                  } finally {
                    setIsClarifying(false);
                  }
                }
              }}
              placeholder="Ask for clarification..."
              className="flex-1 bg-background text-text-primary text-sm px-3 py-1.5 rounded-md outline-none border border-border focus:border-accent-primary transition-colors"
              autoFocus
            />
            <button
              onClick={async () => {
                 if (clarifyQuestion.trim() && !isClarifying) {
                   setIsClarifying(true);
                   setClarificationError(null);
                   try {
                     if (onClarify) {
                       await onClarify(node.id, clarifyMode.text, clarifyQuestion.trim());
                       setClarifyMode(null);
                       setClarifyQuestion('');
                     } else {
                       setClarificationError("Clarify callback missing");
                     }
                   } catch (err: any) {
                     setClarificationError(err.message || 'Failed to clarify');
                   } finally {
                     setIsClarifying(false);
                   }
                 }
              }}
              disabled={!clarifyQuestion.trim() || isClarifying}
              className="p-1.5 bg-accent-primary hover:bg-accent-secondary disabled:opacity-50 text-white rounded-md transition-colors"
            >
              {isClarifying ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
            </button>
            <button
              onClick={() => {
                setClarifyMode(null);
                setClarifyQuestion('');
                setClarificationError(null);
              }}
              className="p-1.5 text-text-secondary hover:text-red-500 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          {clarificationError && (
             <div className="text-xs text-red-500 mt-1">{clarificationError}</div>
          )}
        </div>
      )}

      <div className={`flex w-full ${isUser ? 'max-w-[85%] sm:max-w-[75%]' : 'max-w-full'} gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start`}>

        {/* Content Container */}
        <div className={`flex flex-col min-w-0 flex-1 ${isUser ? 'items-end' : 'items-start'}`}>

          {/* Attachments Area */}
          {!isEditing && node.attachments && node.attachments.length > 0 && (
            <AttachmentPreviewArea attachments={node.attachments} isUser={isUser} />
          )}

          {/* Bubble / Text Area */}
          <div
            ref={contentRef}
            className={`
                relative text-[0.95rem] leading-7 transition-all duration-300 min-w-0 max-w-full
                ${isUser
                ? 'bg-black/5 dark:bg-white/10 text-text-primary px-5 py-3 rounded-3xl rounded-tr-md'
                  : 'text-text-primary px-0 py-0 bg-transparent flex-1'}
                ${isActivePath ? 'opacity-100' : 'opacity-60 grayscale-[0.3]'}
              `}
            >
              {isEditing ? (
                <div className="flex flex-col w-full">
                  {(editAttachments.length > 0 || isUploading) && (
                    <div className="mb-3">
                    <div className="flex flex-wrap gap-2 p-1">
                      {editAttachments.map((att: Attachment) => {
                        const isImage = att.mimeType?.startsWith('image/');
                        const isPdf = att.mimeType === 'application/pdf';
                        const isExcel = att.mimeType?.includes('spreadsheet') || att.mimeType?.includes('excel');
                        const isWord = att.mimeType?.includes('word') || att.mimeType?.includes('wordprocessing');
                        const iconBg = isPdf ? 'bg-red-500/10 text-red-500' : isExcel ? 'bg-green-500/10 text-green-600' : isWord ? 'bg-blue-500/10 text-blue-500' : isImage ? 'bg-purple-500/10 text-purple-500' : 'bg-accent-primary/10 text-accent-primary';
                        const label = isPdf ? 'PDF' : isExcel ? 'Excel' : isWord ? 'Word' : isImage ? 'Image' : 'Doc';
                        return (
                          <div key={att.id} className="relative flex items-center gap-2 p-1.5 pr-8 bg-background border border-border rounded-xl shadow-sm text-xs cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
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
                              <span className="text-[10px] text-text-secondary uppercase tracking-wide">{label}</span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setEditAttachments(prev => prev.filter(p => p.id !== att.id)); }} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 transition-all shadow-sm" title="Remove"><X size={11} /></button>
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
                {uploadError && (
                  <div className="flex items-center justify-between p-2 mb-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <span className="text-xs text-red-600 dark:text-red-400 font-medium">⚠ {uploadError}</span>
                    <button onClick={() => setUploadError(null)} className="p-1 text-red-400 hover:text-red-600"><X size={14} /></button>
                  </div>
                )}
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-transparent border-none focus:ring-0 resize-none min-h-[100px] text-text-primary p-1 text-sm font-sans"
                />
                <div className="flex justify-between items-center mt-2">
                  <div className="flex items-center">
                    <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ''; }} />
                    <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex items-center justify-center w-8 h-8 text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 rounded-lg transition-colors disabled:opacity-50">
                      <Paperclip size={16} />
                    </button>
                  </div>
                  <div className="flex gap-2">
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
              </div>
            ) : (
              <div className={`${isUser ? 'whitespace-pre-wrap' : 'w-full markdown-content'}`}>
                {!isUser && node?.isStreaming && !node.wasThinkingEnabled && (
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

                {/* User messages: plain text. AI messages: full markdown */}
                {isUser ? (
                  <span>{hydratedContent}</span>
                ) : (
                  renderedContentComponents
                )}

                {/* Inline Clarifications display */}
                {node.clarifications && activeClarificationId && (
                  (() => {
                    const clarification = node.clarifications.find(c => c.id === activeClarificationId);
                    if (!clarification) return null;
                    return (
                      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 animate-in slide-in-from-top-2 fade-in duration-300 clarify-box-content">
                        <div className="text-sm bg-black/5 dark:bg-white/5 rounded-xl px-4 py-3 flex flex-col gap-2 relative shadow-sm border border-border">
                          <button 
                            onClick={() => setActiveClarificationId(null)}
                            className="absolute top-2 right-2 p-1 text-text-secondary hover:bg-black/10 dark:hover:bg-white/10 rounded transition-colors"
                          >
                            <X size={14} />
                          </button>
                          
                          {/* Thread Heading / Source Context */}
                          <div className="text-[0.8rem] text-text-secondary italic border-l-2 border-border pl-2 my-1 bg-black/5 dark:bg-zinc-800/50 py-2 px-3 rounded-r-md overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {clarification.selectedText}
                          </div>

                          {/* Initial Turn */}
                          <div className="flex flex-col gap-2 mt-3">
                            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-black/5 dark:bg-white-[0.03] rounded-xl border border-border/50 shrink-0">
                              <HelpCircle size={16} className="text-accent-primary shrink-0 opacity-80 mt-0.5" />
                              <div className="flex-1 font-medium text-text-primary text-[0.9rem] leading-tight">
                                {clarification.question}
                              </div>
                            </div>
                            <div className="text-[0.9rem] leading-6 text-text-primary px-1 pt-1 pb-3">
                               <MarkdownRenderer content={clarification.answer} />
                            </div>
                          </div>

                          {/* Follow-up Turns */}
                          {clarification.followUps && clarification.followUps.length > 0 && (
                            <div className="flex flex-col border-t border-border/50 pt-1 mt-1">
                              {clarification.followUps.map(fu => (
                                <div key={fu.id} className="flex flex-col gap-2 mt-4">
                                  <div className="flex items-start gap-2.5 px-3 py-2.5 bg-black/5 dark:bg-white-[0.03] rounded-xl border border-border/50 shrink-0">
                                    <HelpCircle size={16} className="text-accent-primary shrink-0 opacity-80 mt-0.5" />
                                    <div className="flex-1 font-medium text-text-primary text-[0.9rem] leading-tight">
                                      {fu.question}
                                    </div>
                                  </div>
                                  <div className="text-[0.9rem] leading-6 text-text-primary px-1 pt-1 pb-2">
                                    <MarkdownRenderer content={fu.answer} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Follow-up Composer */}
                          <div className="mt-3 border-t border-border/50 pt-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={followUpQuestion}
                                onChange={(e) => setFollowUpQuestion(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter' && followUpQuestion.trim() && !isClarifying) {
                                    setIsClarifying(true);
                                    try {
                                      if (onClarify) {
                                        await onClarify(node.id, clarification.selectedText, followUpQuestion.trim(), clarification.id);
                                        setFollowUpQuestion('');
                                      }
                                    } catch (err) {
                                       setClarificationError(err instanceof Error ? err.message : 'Failed');
                                    } finally {
                                      setIsClarifying(false);
                                    }
                                  }
                                }}
                                placeholder="Ask a follow-up..."
                                className="flex-1 bg-background text-text-primary text-sm px-3 py-1.5 rounded-md outline-none border border-border focus:border-accent-primary transition-colors"
                              />
                              <button
                                onClick={async () => {
                                  if (followUpQuestion.trim() && !isClarifying) {
                                    setIsClarifying(true);
                                    try {
                                      if (onClarify) {
                                        await onClarify(node.id, clarification.selectedText, followUpQuestion.trim(), clarification.id);
                                        setFollowUpQuestion('');
                                      }
                                    } catch (err) {
                                       setClarificationError(err instanceof Error ? err.message : 'Failed');
                                    } finally {
                                      setIsClarifying(false);
                                    }
                                  }
                                }}
                                disabled={!followUpQuestion.trim() || isClarifying}
                                className="p-1.5 bg-accent-primary hover:bg-accent-secondary disabled:opacity-50 text-white rounded-md transition-colors"
                              >
                                {isClarifying ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            )}

          </div>

          {/* Action Bar (Below message) */}
          {!node.isStreaming && (
            <div className={`flex items-center justify-between gap-4 mt-1.5 select-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex items-center gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
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
                    className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors pr-2"
                    title="Edit and test variants"
                  >
                    <Edit2 size={13} />
                  </button>
                )}
              </div>
              
              {!isUser && node.tokenUsage && (
                <div className="flex items-center gap-2.5 px-1 ml-2 transition-all duration-300 cursor-default">
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-600/80 dark:text-emerald-400/80 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" title="Model Completion Output">
                    <ArrowUpCircle size={13} className="shrink-0 opacity-90" />
                    <span className="font-mono font-medium tracking-tight">
                      {((node.tokenUsage.candidatesTokens / 1000000) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500/80 dark:text-zinc-400/80 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors" title="Prompt Input Context">
                    <ArrowDownCircle size={13} className="shrink-0 opacity-90" />
                    <span className="font-mono font-medium tracking-tight">
                      {((node.tokenUsage.promptTokens / 1000000) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default React.memo(ChatMessagePoly);