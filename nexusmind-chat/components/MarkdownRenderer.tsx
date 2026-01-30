import React, { useState, useContext, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Copy, Check, Edit2, Maximize2, Download, X, Loader2, ZoomIn, ZoomOut, RotateCcw, RotateCw } from 'lucide-react';
import { ThemeContext } from '../contexts/ThemeContext';
import { createPortal } from 'react-dom';

interface MarkdownRendererProps {
  content: string;
  compact?: boolean;
  isStatic?: boolean;
  forcedTheme?: 'dark' | 'light';
}

// Inlined vscDarkPlus theme
export const vscDarkPlus = {
  "code[class*=\"language-\"]": {
    "color": "#d4d4d4",
    "background": "none",
    "textShadow": "0 1px rgba(0, 0, 0, 0.3)",
    "fontFamily": "Menlo, Monaco, Consolas, \"Courier New\", monospace",
    "fontSize": "13px",
    "textAlign": "left",
    "whiteSpace": "pre",
    "wordSpacing": "normal",
    "wordBreak": "normal",
    "lineHeight": "1.5",
    "tabSize": "4",
    "hyphens": "none"
  },
  "pre[class*=\"language-\"]": {
    "color": "#d4d4d4",
    "background": "transparent",
    "textShadow": "0 1px rgba(0, 0, 0, 0.3)",
    "fontFamily": "Menlo, Monaco, Consolas, \"Courier New\", monospace",
    "fontSize": "13px",
    "textAlign": "left",
    "whiteSpace": "pre",
    "wordSpacing": "normal",
    "wordBreak": "normal",
    "lineHeight": "1.5",
    "tabSize": "4",
    "hyphens": "none",
    "padding": "0",
    "margin": "0",
    "overflow": "auto",
    "borderRadius": "0.3em"
  },
  ":not(pre) > code[class*=\"language-\"]": {
    "background": "transparent",
    "padding": ".1em",
    "borderRadius": ".3em",
    "whiteSpace": "normal"
  },
  "comment": { "color": "#6a9955" },
  "prolog": { "color": "#6a9955" },
  "doctype": { "color": "#6a9955" },
  "cdata": { "color": "#6a9955" },
  "punctuation": { "color": "#d4d4d4" },
  "namespace": { "opacity": ".7" },
  "property": { "color": "#9cdcfe" },
  "keyword": { "color": "#569cd6" },
  "tag": { "color": "#569cd6" },
  "class-name": { "color": "#4ec9b0" },
  "boolean": { "color": "#569cd6" },
  "constant": { "color": "#9cdcfe" },
  "symbol": { "color": "#4ec9b0" },
  "deleted": { "color": "#ce9178" },
  "number": { "color": "#b5cea8" },
  "selector": { "color": "#d7ba7d" },
  "attr-name": { "color": "#9cdcfe" },
  "string": { "color": "#ce9178" },
  "char": { "color": "#ce9178" },
  "builtin": { "color": "#4ec9b0" },
  "inserted": { "color": "#b5cea8" },
  "variable": { "color": "#9cdcfe" },
  "operator": { "color": "#d4d4d4" },
  "entity": { "color": "#4ec9b0", "cursor": "help" },
  "url": { "color": "#9cdcfe" },
  "language-css .token.string": { "color": "#ce9178" },
  "style .token.string": { "color": "#ce9178" },
  "atrule": { "color": "#c586c0" },
  "attr-value": { "color": "#ce9178" },
  "function": { "color": "#dcdcaa" },
  "regex": { "color": "#d16969" },
  "important": { "color": "#569cd6", "fontWeight": "bold" },
  "bold": { "fontWeight": "bold" },
  "italic": { "fontStyle": "italic" }
};

// Premium Light Theme for Light Mode
export const vscLightPlus = {
  "code[class*=\"language-\"]": {
    "color": "#1f2937",
    "background": "none",
    "fontFamily": "Menlo, Monaco, Consolas, \"Courier New\", monospace",
    "fontSize": "13px",
    "textAlign": "left",
    "whiteSpace": "pre",
    "wordSpacing": "normal",
    "wordBreak": "normal",
    "lineHeight": "1.5",
    "tabSize": "4",
    "hyphens": "none"
  },
  "pre[class*=\"language-\"]": {
    "color": "#1f2937",
    "background": "transparent",
    "fontFamily": "Menlo, Monaco, Consolas, \"Courier New\", monospace",
    "fontSize": "13px",
    "textAlign": "left",
    "whiteSpace": "pre",
    "wordSpacing": "normal",
    "wordBreak": "normal",
    "lineHeight": "1.5",
    "tabSize": "4",
    "hyphens": "none",
    "padding": "0",
    "margin": "0",
    "overflow": "auto",
    "borderRadius": "0.3em"
  },
  ":not(pre) > code[class*=\"language-\"]": {
    "background": "transparent",
    "padding": ".1em",
    "borderRadius": ".3em",
    "whiteSpace": "normal"
  },
  "comment": { "color": "#008000" },
  "prolog": { "color": "#008000" },
  "doctype": { "color": "#008000" },
  "cdata": { "color": "#008000" },
  "punctuation": { "color": "#393a34" },
  "namespace": { "opacity": ".7" },
  "property": { "color": "#005cc5" },
  "keyword": { "color": "#d73a49" },
  "tag": { "color": "#22863a" },
  "class-name": { "color": "#6f42c1" },
  "boolean": { "color": "#d73a49" },
  "constant": { "color": "#005cc5" },
  "symbol": { "color": "#6f42c1" },
  "deleted": { "color": "#b31d28" },
  "number": { "color": "#005cc5" },
  "selector": { "color": "#22863a" },
  "attr-name": { "color": "#6f42c1" },
  "string": { "color": "#032f62" },
  "char": { "color": "#032f62" },
  "builtin": { "color": "#e36209" },
  "inserted": { "color": "#22863a" },
  "variable": { "color": "#e36209" },
  "operator": { "color": "#d73a49" },
  "entity": { "color": "#6f42c1", "cursor": "help" },
  "url": { "color": "#005cc5" },
  "atrule": { "color": "#d73a49" },
  "attr-value": { "color": "#032f62" },
  "function": { "color": "#6f42c1" },
  "regex": { "color": "#032f62" },
  "important": { "color": "#d73a49", "fontWeight": "bold" },
  "bold": { "fontWeight": "bold" },
  "italic": { "fontStyle": "italic" }
};

const CodeBlock = ({ inline, className, children, compact, isStatic, currentTheme, ...props }: any) => {
  const isDarkMode = currentTheme === 'dark';
  const [isCopied, setIsCopied] = useState(false);

  if (isStatic) {
    if (inline) {
      return <code className="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-[10px] font-mono break-all">{children}</code>;
    }
    return (
      <div className={`rounded overflow-hidden my-1 border border-border ${isDarkMode ? 'bg-[#1e1e1e]' : 'bg-zinc-50'}`}>
        <div className={`px-2 py-1 text-[8px] font-mono border-b uppercase ${isDarkMode ? 'text-zinc-500 border-white/5' : 'text-zinc-400 border-black/5'}`}>Code</div>
        <pre className={`p-2 text-[8px] font-mono overflow-hidden whitespace-pre-wrap ${isDarkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>{children}</pre>
      </div>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (compact) {
    return <code className="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-[10px] font-mono break-all">{children}</code>;
  }

  return !inline && match ? (
    <div className="rounded-xl overflow-hidden my-6 border border-border shadow-sm bg-surface group">
      <div className="flex justify-between items-center bg-black/5 dark:bg-white/5 px-4 py-2 text-xs text-text-secondary font-mono border-b border-border/50">
        <span className="uppercase tracking-wider font-semibold">{match[1]}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 hover:text-text-primary transition-colors p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
          title="Copy code"
        >
          {isCopied ? (
            <>
              <Check size={14} className="text-green-500" />
              <span className="text-green-500">Copied</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={(isDarkMode ? vscDarkPlus : vscLightPlus) as any}
        language={match[1]}
        PreTag="div"
        customStyle={{ margin: 0, padding: '1.25rem', fontSize: '0.85rem', lineHeight: '1.6', background: 'transparent' }}
        {...props}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  ) : (
    <code className={`${className} bg-black/5 dark:bg-white/10 text-accent-primary px-1.5 py-0.5 rounded text-[0.9em] font-mono font-medium`} {...props}>
      {children}
    </code>
  );
};

const ImageWithPreview = ({ src, alt, title }: { src: string, alt?: string, title?: string }) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Zoom & Pan State
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const containerRef = React.useRef<HTMLDivElement>(null);
  const hasMovedRef = React.useRef(false);

  // Derive Edit URL if Mermaid
  const isMermaid = src.includes('mermaid.ink/img/');
  let editUrl = null;
  if (isMermaid) {
    try {
      // pako:XYZ -> https://mermaid.live/edit#pako:XYZ
      const parts = src.split('pako:');
      if (parts.length > 1) {
        editUrl = `https://mermaid.live/edit#pako:${parts[1]}`;
      }
    } catch (e) { console.error("Error parsing mermaid URL", e); }
  }

  // Reset zoom when preview opens/closes
  useEffect(() => {
    if (!isPreviewOpen) {
      setScale(1);
      setRotation(0);
      setPosition({ x: 0, y: 0 });
    }
  }, [isPreviewOpen]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = alt || 'image.png';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      const a = document.createElement('a');
      a.href = src;
      a.download = alt || 'image.png';
      a.target = '_blank';
      a.click();
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editUrl) window.open(editUrl, '_blank');
  };

  // Actions
  const zoomIn = (e?: React.MouseEvent) => { e?.stopPropagation(); setScale(s => Math.min(s + 0.5, 5)); };
  const zoomOut = (e?: React.MouseEvent) => { e?.stopPropagation(); setScale(s => Math.max(s - 0.5, 0.5)); };
  const rotateRight = (e?: React.MouseEvent) => { e?.stopPropagation(); setRotation(r => (r + 90) % 360); };
  const resetView = (e?: React.MouseEvent) => { e?.stopPropagation(); setScale(1); setRotation(0); setPosition({ x: 0, y: 0 }); };

  // Drag Handlers (Mouse & Touch)
  const handleStart = (clientX: number, clientY: number) => {
    setIsDragging(true);
    hasMovedRef.current = false;
    setDragStart({ x: clientX - position.x, y: clientY - position.y });
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    hasMovedRef.current = true;
    setPosition({ x: clientX - dragStart.x, y: clientY - dragStart.y });
  };

  const handleEnd = () => {
    setIsDragging(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    e.preventDefault();
    handleMove(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  // Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (isPreviewOpen) {
      e.stopPropagation();
      const delta = e.deltaY * -0.001;
      setScale(s => Math.min(Math.max(s + delta, 0.5), 5));
    }
  };

  return (
    <div className="my-6 group/image">
      <div
        className={`
          relative rounded-xl overflow-hidden border border-border/50 bg-black/5 dark:bg-white/5 
          transition-all duration-300 hover:shadow-xl hover:border-accent-primary/30
        `}
      >
        <img
          src={src}
          alt={alt}
          onClick={() => setIsPreviewOpen(true)}
          className={`
            w-full h-auto object-contain max-h-[400px] cursor-zoom-in
            transition-all duration-700 ease-out
            bg-white/50 dark:bg-black/20
          `}
          loading="lazy"
        />
      </div>

      {title && (
        <div className="text-center text-xs text-text-secondary mt-2.5 font-medium italic opacity-80">
          {title}
        </div>
      )}

      {/* Lightbox Preview */}
      {isPreviewOpen && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/98 backdrop-blur-2xl animate-in fade-in duration-300 flex flex-col"
          onClick={() => setIsPreviewOpen(false)}
          onWheel={handleWheel}
        >
          {/* Header Actions */}
          <div
            className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-white/5 bg-black/60 relative z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-white/90 text-sm font-semibold truncate flex-1 mr-4">
              {title || 'Image Preview'}
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {editUrl && (
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-all text-xs sm:text-sm font-medium border border-white/5"
                >
                  <Edit2 size={14} />
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-all text-xs sm:text-sm font-medium border border-white/5"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Download</span>
              </button>
              <div className="h-4 w-px bg-white/10 mx-1.5"></div>
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="p-2 rounded-full hover:bg-white/10 text-white transition-all active:scale-90"
                title="Close (Esc/Click away)"
              >
                <X size={22} />
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div
            className="flex-1 relative overflow-hidden flex items-center justify-center p-2 sm:p-4 cursor-grab active:cursor-grabbing touch-none"
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleEnd}
            onClick={(e) => {
              if (hasMovedRef.current) e.stopPropagation();
            }}
          >
            <div
              style={{
                transform: `translate(${position.x}px, ${position.y}px) rotate(${rotation}deg) scale(${scale})`,
                transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)'
              }}
              className="will-change-transform flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={src}
                alt={alt}
                className="max-w-[95vw] max-h-[75vh] sm:max-h-[85vh] object-contain shadow-[0_30px_100px_rgba(0,0,0,0.5)] rounded-md bg-white/5 ring-1 ring-white/10"
                draggable={false}
              />
            </div>
          </div>

          {/* Floating Zoom Controls */}
          <div
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 rounded-2xl bg-zinc-900/90 border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5)] z-50 px-3 backdrop-blur-md scale-110 sm:scale-100"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={zoomOut} className="p-2 rounded-xl hover:bg-white/10 text-white/80 hover:text-white transition-all active:scale-75" title="Zoom Out">
              <ZoomOut size={18} />
            </button>
            <span className="text-xs font-bold font-mono text-white/90 min-w-[4ch] text-center select-none">
              {Math.round(scale * 100)}%
            </span>
            <button onClick={zoomIn} className="p-2 rounded-xl hover:bg-white/10 text-white/80 hover:text-white transition-all active:scale-75" title="Zoom In">
              <ZoomIn size={18} />
            </button>
            <div className="w-px h-5 bg-white/10 mx-2"></div>
            <button onClick={rotateRight} className="p-2 rounded-xl hover:bg-white/10 text-white/80 hover:text-white transition-all active:scale-75" title="Reset View">
              <RotateCcw size={18} />
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};


const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, compact = false, isStatic = false, forcedTheme }) => {
  const themeContext = useContext(ThemeContext);
  const currentTheme = forcedTheme || (themeContext?.theme ?? 'dark');

  if (compact) {
    return (
      <div className="text-[10px] leading-relaxed text-text-primary/90 font-sans break-words w-full">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            h1: ({ children }) => <h1 className="font-bold text-xs border-b border-border/50 pb-1 mt-1 mb-1">{children}</h1>,
            h2: ({ children }) => <h2 className="font-bold text-xs mt-1 mb-0.5">{children}</h2>,
            h3: ({ children }) => <h3 className="font-semibold text-[10px] mt-1 mb-0.5">{children}</h3>,
            p: ({ children }) => <div className="my-1">{children}</div>,
            ul: ({ children }) => <ul className="list-disc pl-3 my-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-3 my-1">{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            code: (props) => <CodeBlock {...props} compact={true} isStatic={isStatic} currentTheme={currentTheme} />,
            blockquote: ({ children }) => <blockquote className="border-l-2 border-accent-primary/50 pl-2 italic my-1 opacity-80">{children}</blockquote>,
            sup: ({ children }) => <sup className="text-[8px] align-super text-accent-secondary">{children}</sup>,
            sub: ({ children }) => <sub className="text-[8px] align-sub text-accent-secondary">{children}</sub>,
            table: () => <div className="text-[8px] italic opacity-60">[Table]</div>,
            img: ({ src, alt }) => (
              <div className="relative inline-block my-1 rounded overflow-hidden border border-border/50 group">
                <img src={src} alt={alt} className="max-h-[60px] max-w-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
              </div>
            ),
            a: ({ children, href, ...props }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-primary hover:underline"
                {...props}
              >
                {children}
              </a>
            )
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none break-words font-sans leading-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: ({ children }) => <>{children}</>,
          img: (props) => (
            <ImageWithPreview src={props.src || ''} alt={props.alt} title={props.title} />
          ),
          code: (props) => <CodeBlock {...props} isStatic={isStatic} currentTheme={currentTheme} />,
          a: ({ children, href, ...props }) => {
            const isMermaidEdit = href?.includes('mermaid.live/edit');
            if (isMermaidEdit) {
              return null; // Hidden as it is now integrated into the Image overlay
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-primary hover:underline"
                {...props}
              >
                {children}
              </a>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default React.memo(MarkdownRenderer);