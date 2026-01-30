import React, { useRef, useEffect } from 'react';
import { GraphNote, NoteFontFamily, NoteFontSize, NoteTextAlign } from '../types';
import {
    Bold, Italic, Underline,
    AlignLeft, AlignCenter, AlignRight,
    Trash2, Copy, X,
    Type, Palette, MoreHorizontal
} from 'lucide-react';
import ColorPicker from './ColorPicker';

interface GraphNoteEditorModalProps {
    note: GraphNote;
    onUpdate: (updates: Partial<GraphNote>) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onClose: () => void;
    position?: { x: number, y: number }; // Optional override for desktop context menu
    isMobile?: boolean; // Mobile mode centers it or puts it at bottom
}

const FONT_FAMILIES: { value: NoteFontFamily, label: string }[] = [
    { value: 'Virgil', label: 'Handwritten' },
    { value: 'Helvetica', label: 'Clean' },
    { value: 'Cascadia', label: 'Code' }
];

const FONT_SIZES: { value: NoteFontSize, label: string }[] = [
    { value: 'S', label: 'Small' },
    { value: 'M', label: 'Medium' },
    { value: 'L', label: 'Large' },
    { value: 'XL', label: 'X-Large' }
];

export const GraphNoteEditorModal: React.FC<GraphNoteEditorModalProps> = ({
    note,
    onUpdate,
    onDelete,
    onDuplicate,
    onClose,
    position,
    isMobile
}) => {
    const modalRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        // Delay to prevent immediate closing if triggered by click
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    // Calculate Position style
    const style: React.CSSProperties = isMobile
        ? {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '90%',
            maxWidth: '400px',
            zIndex: 1000
        }
        : {
            position: 'fixed',
            left: position ? position.x : '50%',
            top: position ? position.y : '50%',
            transform: position ? 'translate(10px, 10px)' : 'translate(-50%, -50%)',
            zIndex: 1000
        };

    // Prevent off-screen rendering for desktop
    if (!isMobile && position) {
        if (position.x + 300 > window.innerWidth) {
            style.left = 'auto';
            style.right = '20px';
            style.transform = `translate(0, ${style.top ? '10px' : '0'})`;
        }
        if (position.y + 400 > window.innerHeight) {
            style.top = 'auto';
            style.bottom = '20px';
            style.transform = `translate(${style.left !== 'auto' ? '10px' : '0'}, 0)`;
        }
    }

    return (
        <div
            ref={modalRef}
            className="bg-surface/95 backdrop-blur-xl border border-border shadow-2xl rounded-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
            style={style}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/50">
                <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-accent-primary/10 text-accent-primary">
                        <Edit2 size={14} />
                    </div>
                    <span className="text-sm font-semibold text-text-primary">Style Note</span>
                </div>
                <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
                    <X size={16} />
                </button>
            </div>

            <div className="p-4 flex flex-col gap-5 overflow-y-auto max-h-[80vh] custom-scrollbar">

                {/* Visual Style Section */}
                <div className="w-full">
                    <ColorPicker
                        color={note.style.color || '#ffffff'}
                        onChange={(c) => onUpdate({ style: { ...note.style, color: c } })}
                        className="w-full"
                    />
                </div>

                {/* Typography Section */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                            <Type size={12} /> Typography
                        </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        {/* Font Family */}
                        <div className="col-span-2 flex p-1 bg-background/50 rounded-lg border border-border">
                            {FONT_FAMILIES.map(font => (
                                <button
                                    key={font.value}
                                    onClick={() => onUpdate({ style: { ...note.style, fontFamily: font.value } })}
                                    className={`flex-1 text-xs py-1.5 rounded-md transition-all ${(note.style.fontFamily || 'Virgil') === font.value
                                        ? 'bg-surface shadow text-accent-primary font-medium'
                                        : 'text-text-secondary hover:text-text-primary'
                                        }`}
                                >
                                    {font.label}
                                </button>
                            ))}
                        </div>

                        {/* Font Size */}
                        <div className="col-span-2 flex items-center justify-between bg-background/50 rounded-lg border border-border p-1">
                            {FONT_SIZES.map(size => (
                                <button
                                    key={size.value}
                                    onClick={() => onUpdate({ style: { ...note.style, fontSize: size.value } })}
                                    className={`flex-1 text-xs py-1.5 rounded-md transition-all ${(note.style.fontSize || 'M') === size.value
                                        ? 'bg-surface shadow text-accent-primary font-medium'
                                        : 'text-text-secondary hover:text-text-primary'
                                        }`}
                                >
                                    {size.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Formatting Row */}
                    <div className="flex items-center gap-2 p-1 bg-background/50 rounded-lg border border-border">
                        {/* Alignment */}
                        <div className="flex border-r border-border pr-2 mr-1 gap-1">
                            <button onClick={() => onUpdate({ style: { ...note.style, textAlign: 'left' } })} className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 ${note.style.textAlign === 'left' ? 'text-accent-primary bg-accent-primary/10' : 'text-text-secondary'}`}><AlignLeft size={16} /></button>
                            <button onClick={() => onUpdate({ style: { ...note.style, textAlign: 'center' } })} className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 ${note.style.textAlign === 'center' ? 'text-accent-primary bg-accent-primary/10' : 'text-text-secondary'}`}><AlignCenter size={16} /></button>
                            <button onClick={() => onUpdate({ style: { ...note.style, textAlign: 'right' } })} className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 ${note.style.textAlign === 'right' ? 'text-accent-primary bg-accent-primary/10' : 'text-text-secondary'}`}><AlignRight size={16} /></button>
                        </div>

                        {/* Styles */}
                        <button
                            onClick={() => onUpdate({ style: { ...note.style, fontWeight: note.style.fontWeight === 'bold' ? 'normal' : 'bold' } })}
                            className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 ${note.style.fontWeight === 'bold' ? 'text-accent-primary bg-accent-primary/10 font-bold' : 'text-text-secondary'}`}
                        >
                            <Bold size={16} />
                        </button>
                        <button
                            onClick={() => onUpdate({ style: { ...note.style, fontStyle: note.style.fontStyle === 'italic' ? 'normal' : 'italic' } })}
                            className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 ${note.style.fontStyle === 'italic' ? 'text-accent-primary bg-accent-primary/10 italic' : 'text-text-secondary'}`}
                        >
                            <Italic size={16} />
                        </button>
                        <button
                            onClick={() => onUpdate({ style: { ...note.style, textDecoration: note.style.textDecoration === 'underline' ? 'none' : 'underline' } })}
                            className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 ${note.style.textDecoration === 'underline' ? 'text-accent-primary bg-accent-primary/10 underline' : 'text-text-secondary'}`}
                        >
                            <Underline size={16} />
                        </button>
                    </div>
                </div>

                {/* Actions
                <div className="pt-2 border-t border-border grid grid-cols-2 gap-3">
                    <button
                        onClick={onDuplicate}
                        className="py-2 px-3 rounded-lg border border-border bg-surface hover:bg-black/5 dark:hover:bg-white/5 text-xs font-medium text-text-primary flex items-center justify-center gap-2 transition-colors"
                    >
                        <Copy size={14} />
                    </button>
                    <button
                        onClick={onDelete}
                        className="py-2 px-3 rounded-lg border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20 text-xs font-medium text-red-600 dark:text-red-400 flex items-center justify-center gap-2 transition-colors"
                    >
                        <Trash2 size={14} />
                    </button>
                </div> */}
            </div>
        </div>
    );
};

// Simple Icon fallback
const Edit2 = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
);
