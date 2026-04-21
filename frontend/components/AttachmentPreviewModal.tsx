import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Download, FileText, Loader2, X,
  ZoomIn, ZoomOut, RotateCw, Maximize2,
} from 'lucide-react';


// ─── Attachment Preview Modal ──────────────────────────────────────────────────
// Full-screen lightbox with proper image zoom/pan/rotate, PDF iframe, and download fallback.
const AttachmentPreviewModal = ({ att, onClose }: { att: any; onClose: () => void }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Image zoom/pan/rotate state
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  const isImage = att.mimeType?.startsWith('image/');
  const isPdf = att.mimeType === 'application/pdf';
  const isExcel = att.mimeType?.includes('spreadsheet') || att.mimeType?.includes('excel');
  const isWord = att.mimeType?.includes('word') || att.mimeType?.includes('wordprocessing');
  const isText = att.mimeType?.startsWith('text/') || att.name.endsWith('.txt') || att.name.endsWith('.csv') || att.name.endsWith('.md');

  // Determine the URL to fetch the attachment binary from
  const fetchUrl = att.url || `/api/attachments/${att.id}`;

  useEffect(() => {
    let cancelled = false;

    // Defer state reset to avoid synchronous setState warning in effect
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setObjectUrl(null);
      setTextContent(null);
      // Reset image controls
      setScale(1);
      setRotation(0);
      setPosition({ x: 0, y: 0 });
    });

    fetch(fetchUrl, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}: ${r.statusText}`);
        
        // If it's pure text, just grab the text directly
        if (isText) {
          const text = await r.text();
          if (!cancelled) setTextContent(text);
          return null; // bypass blob logic
        }
        
        return r.blob();
      })
      .then(blob => {
        if (cancelled || !blob) return;
        // Force correct MIME type on the blob if we know it
        const correctedBlob = att.mimeType
          ? new Blob([blob], { type: att.mimeType })
          : blob;
        const url = URL.createObjectURL(correctedBlob);
        objectUrlRef.current = url;
        setObjectUrl(url);
      })
      .catch(e => {
        if (!cancelled) setError(e.message || 'Failed to load attachment');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [att.id, fetchUrl, att.mimeType, isText]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Downloads ──
  const handleDownload = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!objectUrl) return;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = att.name || 'attachment';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ── Image controls ──
  const zoomIn = (e?: React.MouseEvent) => { e?.stopPropagation(); setScale(s => Math.min(s + 0.5, 5)); };
  const zoomOut = (e?: React.MouseEvent) => { e?.stopPropagation(); setScale(s => Math.max(s - 0.5, 0.5)); };
  const rotateRight = (e?: React.MouseEvent) => { e?.stopPropagation(); setRotation(r => (r + 90) % 360); };
  const resetView = (e?: React.MouseEvent) => { e?.stopPropagation(); setScale(1); setRotation(0); setPosition({ x: 0, y: 0 }); };

  // ── Drag handlers ──
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    hasMoved.current = false;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    hasMoved.current = true;
    setPosition({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const handleMouseUp = () => setIsDragging(false);

  // Touch
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      hasMoved.current = false;
      dragStart.current = { x: e.touches[0].clientX - position.x, y: e.touches[0].clientY - position.y };
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    hasMoved.current = true;
    setPosition({ x: e.touches[0].clientX - dragStart.current.x, y: e.touches[0].clientY - dragStart.current.y });
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY * -0.001;
    setScale(s => Math.min(Math.max(s + delta, 0.5), 5));
  };

  const fileTypeLabel = isPdf ? 'PDF Document'
    : isExcel ? 'Excel Spreadsheet'
    : isWord ? 'Word Document'
    : isImage ? 'Image'
    : isText ? 'Text Document'
    : 'File';

  const fileIcon = isPdf
    ? <FileText size={18} className="text-red-400 shrink-0" />
    : isExcel
    ? <FileText size={18} className="text-green-400 shrink-0" />
    : isWord
    ? <FileText size={18} className="text-blue-400 shrink-0" />
    : isImage
    ? <FileText size={18} className="text-purple-400 shrink-0" />
    : isText
    ? <FileText size={18} className="text-orange-400 shrink-0" />
    : <FileText size={18} className="text-white/60 shrink-0" />;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-2xl flex flex-col"
      style={{ animation: 'attachFadeIn 0.2s ease' }}
      onClick={(e) => { if (e.target === e.currentTarget && !hasMoved.current) onClose(); }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-zinc-950/80 shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {fileIcon}
          <div className="min-w-0">
            <p className="text-white/90 font-semibold text-sm truncate leading-tight">{att.name}</p>
            <p className="text-white/30 text-[10px]">{fileTypeLabel}{isImage && scale !== 1 ? ` · ${Math.round(scale * 100)}%` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Image-specific controls */}
          {!loading && !error && objectUrl && isImage && (
            <>
              <button onClick={zoomOut} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all" title="Zoom out"><ZoomOut size={15} /></button>
              <button onClick={zoomIn} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all" title="Zoom in"><ZoomIn size={15} /></button>
              <button onClick={rotateRight} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all" title="Rotate"><RotateCw size={15} /></button>
              <button onClick={resetView} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all" title="Reset view"><Maximize2 size={15} /></button>
              <div className="h-4 w-px bg-white/10 mx-1" />
            </>
          )}
          {(objectUrl || textContent) && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-all text-xs border border-white/10"
            >
              <Download size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div
        className="flex-1 overflow-hidden flex items-center justify-center p-4 sm:p-6"
        onClick={e => e.stopPropagation()}
        onWheel={isImage ? handleWheel : undefined}
      >
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 text-white/40">
            <Loader2 size={36} className="animate-spin" />
            <span className="text-sm">Loading {fileTypeLabel}…</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle size={28} className="text-red-400" />
            </div>
            <div>
              <p className="text-white/80 font-semibold text-sm mb-1">Preview Failed</p>
              <p className="text-red-400/80 text-xs max-w-xs">{error}</p>
            </div>
          </div>
        )}

        {/* ── Image Preview with zoom/pan/rotate ── */}
        {!loading && !error && objectUrl && isImage && (
          <div
            className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => setIsDragging(false)}
          >
            <img
              src={objectUrl}
              alt={att.name}
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl ring-1 ring-white/10 pointer-events-none"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
                transition: isDragging ? 'none' : 'transform 0.3s ease',
                userSelect: 'none',
              }}
              draggable={false}
            />
          </div>
        )}

        {/* ── PDF Preview ── */}
        {!loading && !error && objectUrl && isPdf && (
          <iframe
            src={objectUrl}
            title={att.name}
            className="w-full h-full rounded-xl border-0 shadow-2xl bg-white"
            style={{ minHeight: '70vh' }}
          />
        )}

        {/* ── Text Preview ── */}
        {!loading && !error && textContent && isText && (
          <div className="w-full h-full max-w-5xl mx-auto bg-[#1E1E1E] rounded-xl overflow-auto p-6 md:p-8 m-4 shadow-xl border border-white/10 dark:text-white text-black text-left">
            <pre className="text-sm sm:text-base opacity-90 whitespace-pre-wrap font-mono leading-relaxed" style={{ wordBreak: 'break-word', tabSize: 4 }}>
              {textContent}
            </pre>
          </div>
        )}

        {/* ── Other files — download prompt ── */}
        {!loading && !error && objectUrl && !isImage && !isPdf && !isText && (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
              <FileText size={36} className="text-white/30" />
            </div>
            <div>
              <p className="text-white/80 font-semibold text-sm mb-1">{att.name}</p>
              <p className="text-white/30 text-xs">In-browser preview is not available for {fileTypeLabel}.</p>
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all text-sm border border-white/10 font-medium"
            >
              <Download size={16} />
              Download {fileTypeLabel}
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes attachFadeIn { from { opacity:0 } to { opacity:1 } }`}</style>
    </div>,
    document.body
  );
};


// ─── Attachment Preview Area (for ChatMessage) ────────────────────────────────
// Shows clickable chips for each attachment. Images show a tiny thumbnail.
const AttachmentPreviewArea = ({ attachments, isUser }: { attachments: any[]; isUser: boolean }) => {
  const [previewAtt, setPreviewAtt] = useState<any | null>(null);

  return (
    <>
      <div className={`flex flex-wrap gap-2 mb-2 w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
        {attachments.map(att => {
          const isImage = att.mimeType?.startsWith('image/');
          const isPdf = att.mimeType === 'application/pdf';
          const isExcel = att.mimeType?.includes('spreadsheet') || att.mimeType?.includes('excel');
          const isWord = att.mimeType?.includes('word') || att.mimeType?.includes('wordprocessing');

          const iconBg = isPdf
            ? 'bg-red-500/10 text-red-500'
            : isExcel
            ? 'bg-green-500/10 text-green-600'
            : isWord
            ? 'bg-blue-500/10 text-blue-500'
            : isImage
            ? 'bg-purple-500/10 text-purple-500'
            : 'bg-accent-primary/10 text-accent-primary';

          const label = isPdf ? 'PDF' : isExcel ? 'Excel' : isWord ? 'Word' : isImage ? 'Image' : 'Document';
          const thumbUrl = att.url || `/api/attachments/${att.id}`;

          return (
            <button
              key={att.id}
              onClick={() => setPreviewAtt(att)}
              className="flex items-center gap-2 p-1.5 pr-3 bg-surface border border-border rounded-xl shadow-sm text-xs cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 transition-all hover:scale-[1.02] active:scale-95 text-left"
            >
              {/* Show actual thumbnail for images */}
              {isImage ? (
                <div className="w-9 h-9 rounded-lg shrink-0 overflow-hidden border border-border/50 bg-black/5 dark:bg-white/5">
                  <img
                    src={thumbUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    crossOrigin="use-credentials"
                  />
                </div>
              ) : (
                <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${iconBg}`}>
                  <FileText size={16} />
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="truncate max-w-[140px] font-medium text-text-primary leading-tight">{att.name}</span>
                <span className="text-[10px] text-text-secondary uppercase tracking-wide">{label} · preview</span>
              </div>
            </button>
          );
        })}
      </div>

      {previewAtt && (
        <AttachmentPreviewModal att={previewAtt} onClose={() => setPreviewAtt(null)} />
      )}
    </>
  );
};

export { AttachmentPreviewModal };
export default AttachmentPreviewArea;
