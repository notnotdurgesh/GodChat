import React, { useState, useRef, useEffect, useCallback } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { GraphNote, NoteResizeMode } from '../types';
import { Trash2, Copy, Move, Edit2 } from 'lucide-react';

interface GraphNoteProps {
    note: GraphNote;
    isSelected: boolean;
    isEditing: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onDoubleClick: (e: React.MouseEvent) => void;
    onUpdate: (updates: Partial<GraphNote>) => void;
    onDelete: () => void;
    scale: number; // Current zoom scale
    enableTouch?: boolean;
    onEditRequested?: (e: React.MouseEvent | React.TouchEvent) => void;
}

const HANDLE_SIZE = 8;
const MIN_WIDTH = 20;
const MIN_HEIGHT = 20;

export const GraphNoteComponent: React.FC<GraphNoteProps> = ({
    note,
    isSelected,
    isEditing,
    onSelect,
    onDoubleClick,
    onUpdate,
    onDelete,
    scale,
    enableTouch = false,
    onEditRequested
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [localContent, setLocalContent] = useState(note.content);

    // Performance: Local state for drag/resize to avoid global re-renders
    const [preview, setPreview] = useState({
        x: note.x,
        y: note.y,
        width: note.width,
        height: note.height
    });
    const [isInteracting, setIsInteracting] = useState(false);

    // Internal state for drag/resize start positions to avoid re-renders during gestures
    const gestureRef = useRef<{
        startX: number;
        startY: number;
        initialX: number;
        initialY: number;
        initialWidth: number;
        initialHeight: number;
    } | null>(null);

    // Long Press Logic for Mobile
    const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isLongPressRef = useRef(false);

    // Sync content if changed externally
    useEffect(() => {
        setLocalContent(note.content);
    }, [note.content]);

    // Sync preview if note changes (and we aren't dragging)
    useEffect(() => {
        if (!isInteracting) {
            setPreview({ x: note.x, y: note.y, width: note.width, height: note.height });
        }
    }, [note.x, note.y, note.width, note.height]);


    // Handle Resize
    const handleResizeStart = (e: React.MouseEvent, handle: string) => {
        e.stopPropagation();
        e.preventDefault();
        setIsInteracting(true);

        const startX = e.clientX;
        const startY = e.clientY;

        // Measure current dimensions if not in state
        const startWidth = preview.width || containerRef.current?.offsetWidth || MIN_WIDTH;
        const startHeight = preview.height || containerRef.current?.offsetHeight || MIN_HEIGHT;

        const initialNoteX = preview.x;
        const initialNoteY = preview.y;


        const handleMouseMove = (mv: MouseEvent) => {
            const deltaX = (mv.clientX - startX) / scale;
            const deltaY = (mv.clientY - startY) / scale;

            let nextWidth = startWidth;
            let nextHeight = startHeight;
            let nextX = initialNoteX;
            let nextY = initialNoteY;

            const isLeft = handle.includes('w');
            const isRight = handle.includes('e');
            const isTop = handle.includes('n');
            const isBottom = handle.includes('s');

            if (isLeft) {
                const w = Math.max(MIN_WIDTH, startWidth - deltaX);
                nextWidth = w;
                nextX = initialNoteX + (startWidth - w);
            } else if (isRight) {
                nextWidth = Math.max(MIN_WIDTH, startWidth + deltaX);
            }

            if (isTop) {
                const h = Math.max(MIN_HEIGHT, startHeight - deltaY);
                nextHeight = h;
                nextY = initialNoteY + (startHeight - h);
            } else if (isBottom) {
                nextHeight = Math.max(MIN_HEIGHT, startHeight + deltaY);
            }

            setPreview(prev => ({
                ...prev,
                width: nextWidth,
                height: nextHeight,
                x: nextX,
                y: nextY
            }));
        };

        const handleMouseUp = (mv: MouseEvent) => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            setIsInteracting(false);

            // Re-calculate final state to sync with React
            const deltaX = (mv.clientX - startX) / scale;
            const deltaY = (mv.clientY - startY) / scale;

            const isLeft = handle.includes('w');
            const isRight = handle.includes('e');
            const isTop = handle.includes('n');
            const isBottom = handle.includes('s');

            let finalUpdate: Partial<GraphNote> = { resizeMode: 'FIXED' };
            let finalWidth = startWidth;
            let finalHeight = startHeight;
            let finalX = initialNoteX;
            let finalY = initialNoteY;

            if (isLeft) {
                const w = Math.max(MIN_WIDTH, startWidth - deltaX);
                finalWidth = w;
                finalX = initialNoteX + (startWidth - w);
            } else if (isRight) {
                finalWidth = Math.max(MIN_WIDTH, startWidth + deltaX);
            }

            if (isTop) {
                const h = Math.max(MIN_HEIGHT, startHeight - deltaY);
                finalHeight = h;
                finalY = initialNoteY + (startHeight - h);
            } else if (isBottom) {
                finalHeight = Math.max(MIN_HEIGHT, startHeight + deltaY);
            }

            finalUpdate.width = finalWidth;
            finalUpdate.height = finalHeight;
            finalUpdate.x = finalX;
            finalUpdate.y = finalY;

            setPreview({ x: finalX, y: finalY, width: finalWidth, height: finalHeight });
            onUpdate(finalUpdate);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleResizeTouchStart = (e: React.TouchEvent, handle: string) => {
        e.stopPropagation();
        // Prevent default to stop scrolling/zooming while resizing
        // e.preventDefault(); // Note: passive listener issue might occur if not careful, but React handles this.
        setIsInteracting(true);
        const touch = e.touches[0];

        const startWidth = preview.width || containerRef.current?.offsetWidth || MIN_WIDTH;
        const startHeight = preview.height || containerRef.current?.offsetHeight || MIN_HEIGHT;

        gestureRef.current = {
            startX: touch.clientX,
            startY: touch.clientY,
            initialX: preview.x,
            initialY: preview.y,
            initialWidth: startWidth,
            initialHeight: startHeight
        };

        const handleTouchMove = (tm: TouchEvent) => {
            if (tm.cancelable) tm.preventDefault(); // Stop scrolling
            const t = tm.touches[0];
            const state = gestureRef.current;
            if (!state) return;

            const deltaX = (t.clientX - state.startX) / scale;
            const deltaY = (t.clientY - state.startY) / scale;

            let nextWidth = state.initialWidth;
            let nextHeight = state.initialHeight;
            let nextX = state.initialX;
            let nextY = state.initialY;

            const isLeft = handle.includes('w');
            const isRight = handle.includes('e');
            const isTop = handle.includes('n');
            const isBottom = handle.includes('s');

            if (isLeft) {
                const w = Math.max(MIN_WIDTH, state.initialWidth - deltaX);
                nextWidth = w;
                nextX = state.initialX + (state.initialWidth - w);
            } else if (isRight) {
                nextWidth = Math.max(MIN_WIDTH, state.initialWidth + deltaX);
            }

            if (isTop) {
                const h = Math.max(MIN_HEIGHT, state.initialHeight - deltaY);
                nextHeight = h;
                nextY = state.initialY + (state.initialHeight - h);
            } else if (isBottom) {
                nextHeight = Math.max(MIN_HEIGHT, state.initialHeight + deltaY);
            }

            setPreview(prev => ({
                ...prev,
                width: nextWidth,
                height: nextHeight,
                x: nextX,
                y: nextY
            }));
        };

        const handleTouchEnd = (te: TouchEvent) => {
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
            setIsInteracting(false);

            const state = gestureRef.current;
            gestureRef.current = null;
            if (!state) return;

            // Calculate final
            const t = te.changedTouches[0];
            const deltaX = (t.clientX - state.startX) / scale;
            const deltaY = (t.clientY - state.startY) / scale;

            const isLeft = handle.includes('w');
            const isRight = handle.includes('e');
            const isTop = handle.includes('n');
            const isBottom = handle.includes('s');

            let finalUpdate: Partial<GraphNote> = { resizeMode: 'FIXED' };
            let finalWidth = state.initialWidth;
            let finalHeight = state.initialHeight;
            let finalX = state.initialX;
            let finalY = state.initialY;

            if (isLeft) {
                const newWidth = Math.max(MIN_WIDTH, state.initialWidth - deltaX);
                finalWidth = newWidth;
                finalX = state.initialX + (state.initialWidth - newWidth);
            } else if (isRight) {
                finalWidth = Math.max(MIN_WIDTH, state.initialWidth + deltaX);
            }

            if (isTop) {
                const newHeight = Math.max(MIN_HEIGHT, state.initialHeight - deltaY);
                finalHeight = newHeight;
                finalY = state.initialY + (state.initialHeight - newHeight);
            } else if (isBottom) {
                finalHeight = Math.max(MIN_HEIGHT, state.initialHeight + deltaY);
            }

            finalUpdate.width = finalWidth;
            finalUpdate.height = finalHeight;
            finalUpdate.x = finalX;
            finalUpdate.y = finalY;

            setPreview({ x: finalX, y: finalY, width: finalWidth, height: finalHeight });
            onUpdate(finalUpdate);
        };

        window.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.addEventListener('touchend', handleTouchEnd);
    };

    // Drag Move Node
    const handleMoveStart = (e: React.MouseEvent) => {
        if (isEditing) return;
        if (e.button !== 0) return; // Only left click
        e.stopPropagation();
        onSelect(e);
        setIsInteracting(true);

        const startX = e.clientX;
        const startY = e.clientY;
        const initialNoteX = preview.x;
        const initialNoteY = preview.y;

        const handleMouseMove = (mv: MouseEvent) => {
            const dx = (mv.clientX - startX) / scale;
            const dy = (mv.clientY - startY) / scale;

            setPreview(prev => ({
                ...prev,
                x: initialNoteX + dx,
                y: initialNoteY + dy
            }));
        };

        const handleMouseUp = (mv: MouseEvent) => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            setIsInteracting(false);

            // Commit
            const dx = (mv.clientX - startX) / scale;
            const dy = (mv.clientY - startY) / scale;
            const finalX = initialNoteX + dx;
            const finalY = initialNoteY + dy;

            setPreview(prev => ({ ...prev, x: finalX, y: finalY }));
            onUpdate({ x: finalX, y: finalY });
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const mapFontSize = (s: string) => {
        switch (s) {
            case 'S': return '16px';
            case 'M': return '20px';
            case 'L': return '28px';
            case 'XL': return '36px';
            default: return '20px';
        }
    };

    const mapFontFamily = (f: string) => {
        switch (f) {
            case 'Virgil': return '"Virgil", "Comic Sans MS", cursive';
            case 'Helvetica': return 'Inter, sans-serif';
            case 'Cascadia': return 'monospace';
            default: return '"Virgil", "Comic Sans MS", cursive';
        }
    };

    const style: React.CSSProperties = {
        position: 'relative',
        willChange: 'transform, width, height',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        width: note.resizeMode === 'FIXED' ? preview.width : 'fit-content',
        height: note.resizeMode === 'FIXED' && preview.height ? preview.height : 'auto',
        maxWidth: note.resizeMode === 'AUTO' ? '400px' : undefined,

        // Remove minWidth to allow shrinking, or set very low
        minWidth: '20px',
        minHeight: '20px',

        fontFamily: mapFontFamily(note.style.fontFamily || 'Virgil'),
        fontSize: mapFontSize(note.style.fontSize || 'M'),
        color: note.style.color || 'var(--text-primary)',
        textAlign: note.style.textAlign || 'left',
        fontWeight: note.style.fontWeight || 'normal',
        fontStyle: note.style.fontStyle || 'normal',
        textDecoration: note.style.textDecoration || 'none',

        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',

        // Let the children handle overflow scrolling to avoid double scrollbars
        // overflowY: 'hidden', 
        // actually we need the CONTAINER to constrain them.
        // For View Mode: overflow-y auto on plain div.
        // For Edit Mode: overflow-y auto on textarea.

        lineHeight: 1.5,
        cursor: isEditing ? 'text' : 'grab',
        zIndex: isSelected ? 50 : 10,
        backgroundColor: isEditing ? (note.style.color === '#ffffff' ? '#333' : 'transparent') : 'transparent',
        touchAction: 'none', // Critical for mobile to prevent scrolling while interacting
    };

    // Apply transform via style (or could be direct inline)
    // Actually we removed transform in favor of foreignObject x/y.
    // BUT foreignObject x/y are set by React render.
    // We can't update foreignObject props easily from here without re-render of parent.
    // OPTION: We apply a TRANSLATE transform HERE on the DIV, and keep foreignObject static?
    // No, foreignObject x/y are updated via props.
    // If we update local state, we can't change parent's foreignObject x/y.
    // So the note will move INSIDE the foreignObject (which is fixed at old pos).
    // This is OKAY visually as long as overflow is visible.
    // We just need to offset by (preview.x - note.x, preview.y - note.y).

    const deltaX = preview.x - note.x;
    const deltaY = preview.y - note.y;
    // We add this delta to the style transform
    const transformStyle = {
        ...style,
        transform: `translate(${deltaX}px, ${deltaY}px)`
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation(); // CRITICAL: Stop parent (Chart) from seeing this
        onSelect(e);
        onEditRequested?.(e);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        // Prepare Long Press
        isLongPressRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            onEditRequested?.(e);
        }, 500);

        // Prepare Drag
        if (isEditing) return; // Don't drag if editing

        e.stopPropagation();
        // Prevent default to prevent scrolling/zooming immediately if we are dragging
        // With touch-action: none, this might be redundant but explicit is safe
        // e.preventDefault(); 

        const touch = e.touches[0];
        const startX = touch.clientX;
        const startY = touch.clientY;
        const initialX = preview.x;
        const initialY = preview.y;

        gestureRef.current = {
            startX,
            startY,
            initialX,
            initialY,
            initialWidth: 0,
            initialHeight: 0
        };
        setIsInteracting(true);

        const handleWindowTouchMove = (tm: TouchEvent) => {
            if (tm.cancelable) tm.preventDefault(); // Stop scrolling
            const t = tm.touches[0];
            const state = gestureRef.current;

            if (!state) return;

            // Check if moved significantly to cancel long press
            if (Math.abs(t.clientX - state.startX) > 5 || Math.abs(t.clientY - state.startY) > 5) {
                if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                }
            }

            // Perform Drag
            const deltaX = (t.clientX - state.startX) / scale;
            const deltaY = (t.clientY - state.startY) / scale;

            setPreview(prev => ({
                ...prev,
                x: state.initialX + deltaX,
                y: state.initialY + deltaY
            }));
        };

        const handleWindowTouchEnd = (te: TouchEvent) => {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
            }
            setIsInteracting(false);

            window.removeEventListener('touchmove', handleWindowTouchMove);
            window.removeEventListener('touchend', handleWindowTouchEnd);

            const state = gestureRef.current;
            gestureRef.current = null;

            // Commit Drag if not long press
            if (!isLongPressRef.current && state) {
                // Calculate final position robustly
                const t = te.changedTouches[0];
                const deltaX = (t.clientX - state.startX) / scale;
                const deltaY = (t.clientY - state.startY) / scale;
                const finalX = state.initialX + deltaX;
                const finalY = state.initialY + deltaY;

                setPreview(prev => ({ ...prev, x: finalX, y: finalY }));
                onUpdate({ x: finalX, y: finalY });
            }
        };

        window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
        window.addEventListener('touchend', handleWindowTouchEnd);
    };

    return (
        <div
            ref={containerRef}
            className={`graph-note group select-none pointer-events-auto border-0 outline-none ring-0`}
            style={transformStyle}
            onMouseDown={handleMoveStart}
            onContextMenu={handleContextMenu}
            onTouchStart={enableTouch ? handleTouchStart : undefined}
            onClick={(e) => {
                e.stopPropagation(); // Prevent canvas click (deselect/create)
                // NOTE: Logic for selection is in onMouseDown/onSelect passed from parent, 
                // but we ensure click doesn't bubble.
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                onDoubleClick(e);
            }}
        >
            {isEditing ? (
                <TextareaAutosize
                    autoFocus
                    value={localContent}
                    onChange={(e) => {
                        setLocalContent(e.target.value);
                        onUpdate({ content: e.target.value });
                    }}
                    onBlur={() => {
                        onUpdate({ content: localContent });
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            e.currentTarget.blur();
                        }
                    }}
                    style={{
                        resize: 'none',
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        font: 'inherit',
                        color: 'inherit',
                        textAlign: 'inherit',
                        padding: '4px', // Slight padding for edit mode availability
                        margin: 0,
                        overflow: 'hidden'
                    }}
                    className={`w-full min-h-[20px] custom-scrollbar ${note.resizeMode === 'FIXED' ? 'h-full resize-none overflow-y-auto' : ''}`}
                />
            ) : (
                <div
                    className={`w-full min-h-[20px] p-[4px] break-words custom-scrollbar ${note.resizeMode === 'FIXED' && preview.height ? 'h-full overflow-y-auto' : ''}`}
                >
                    {note.content || <span className="opacity-50 italic">Empty note</span>}
                </div>
            )}

            {/* Selection Box & Handles - Always show if selected, even when editing */}
            {isSelected && (
                <div className="absolute -inset-1 border border-blue-500 rounded pointer-events-none">
                    {/* 4 Corners */}
                    {['nw', 'ne', 'sw', 'se'].map(pos => (
                        <div key={pos}
                            className={`absolute w-2 h-2 bg-background border border-blue-500 pointer-events-auto cursor-${pos}-resize`}
                            style={{
                                top: pos.startsWith('n') ? -4 : 'auto',
                                bottom: pos.startsWith('s') ? -4 : 'auto',
                                left: pos.endsWith('w') ? -4 : 'auto',
                                right: pos.endsWith('e') ? -4 : 'auto',
                            }}
                            onMouseDown={(e) => handleResizeStart(e, pos)}
                        />
                    ))}
                    {/* Side Handles (Show for both, allow switching) */}
                    {['n', 's', 'e', 'w'].map(pos => {
                        const isVertical = pos === 'n' || pos === 's';
                        return (
                            <div key={pos}
                                className={`absolute bg-background border border-blue-500 pointer-events-auto cursor-${pos}-resize ${isVertical ? 'w-4 h-2 left-1/2 -translate-x-1/2' : 'w-2 h-4 top-1/2 -translate-y-1/2'}`}
                                style={{
                                    top: pos === 'n' ? -4 : 'auto',
                                    bottom: pos === 's' ? -4 : 'auto',
                                    left: pos === 'w' ? -4 : (isVertical ? '50%' : 'auto'),
                                    right: pos === 'e' ? -4 : 'auto',
                                }}
                                onMouseDown={(e) => handleResizeStart(e, pos)}
                                onTouchStart={enableTouch ? (e) => handleResizeTouchStart(e, pos) : undefined}
                            />
                        );
                    })}

                    {/* Toolbar Actions (Delete & Edit) */}
                    <div className="absolute -top-10 right-0 flex gap-2 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200">
                        {/* Edit Button */}
                        <button
                            className="p-1.5 bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300 rounded shadow-sm hover:scale-110 hover:shadow-md transition-all duration-200 border border-blue-200 dark:border-blue-800"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditRequested?.(e);
                            }}
                            title="Edit Style"
                        >
                            <Edit2 size={14} strokeWidth={2.5} />
                        </button>

                        {/* Delete Button */}
                        <button
                            className="p-1.5 bg-red-100 text-red-500 dark:bg-red-900/50 dark:text-red-300 rounded shadow-sm hover:scale-110 hover:shadow-md transition-all duration-200 border border-red-200 dark:border-red-800"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                            title="Delete Note"
                        >
                            <Trash2 size={14} strokeWidth={2.5} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
