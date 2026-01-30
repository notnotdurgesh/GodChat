import React, { useState, useEffect } from 'react';
import { HexColorPicker } from 'react-colorful';
import "./ColorPicker.css";
import { Pipette, Plus, X } from 'lucide-react';

interface ColorPickerProps {
    color: string;
    onChange: (color: string) => void;
    className?: string;
}

const SYSTEM_PRESETS = [
    '#4F87ED', '#DB4437', '#F4B400', '#0F9D58', // Gemini
    '#06b6d4', '#d946ef', '#84cc16', '#8b5cf6', // Neon
    '#ffffff', '#a1a1aa', '#27272a', '#000000', // Mono
];

const STORAGE_KEY = 'nexus_custom_colors';

const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, className = '' }) => {
    const [hexInput, setHexInput] = useState(color);
    const [customPresets, setCustomPresets] = useState<string[]>([]);
    const [deleteMode, setDeleteMode] = useState(false);

    useEffect(() => {
        setHexInput(color);
    }, [color]);

    // Load presets
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setCustomPresets(JSON.parse(stored));
            }
        } catch (e) {
            console.error("Failed to load presets", e);
        }
    }, []);

    const savePreset = () => {
        // Don't duplicate
        if (customPresets.includes(color)) return;

        const newPresets = [...customPresets, color];
        setCustomPresets(newPresets);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newPresets));
    };

    const deletePreset = (colorToDelete: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newPresets = customPresets.filter(c => c !== colorToDelete);
        setCustomPresets(newPresets);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newPresets));
    };

     
    const _handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setHexInput(val);
        if (/^#[0-9A-F]{6}$/i.test(val)) {
            onChange(val);
        }
    };

    const hasEyeDropper = 'EyeDropper' in window;
    const handleEyeDropper = async () => {
        if (!hasEyeDropper) return;
        try {
            const eyeDropper = new (window as any).EyeDropper();
            const result = await eyeDropper.open();
            onChange(result.sRGBHex);
        } catch (_e) { /* ignore */ }
    };

    return (
        <div className={`p-4 bg-surface/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200 w-[280px] select-none ${className}`}>

            {/* Header */}
            <div className="flex items-center justify-between text-xs font-medium text-text-secondary uppercase tracking-wider">
                <span>Color</span>
                <button
                    onClick={handleEyeDropper}
                    disabled={!hasEyeDropper}
                    className={`p-1.5 rounded-md transition-colors ${hasEyeDropper ? 'hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary' : 'opacity-30 cursor-not-allowed'}`}
                    title="Pick from screen"
                >
                    <Pipette size={14} />
                </button>
            </div>

            {/* Main Picker */}
            <div className="custom-color-picker relative">
                <HexColorPicker color={color} onChange={onChange} style={{ width: '100%', height: '160px' }} />
            </div>

            {/* Hex Input */}
            <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary font-mono text-xs">#</div>
                <input
                    type="text"
                    value={hexInput.replace('#', '')}
                    onChange={(e) => {
                        const clean = e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
                        setHexInput('#' + clean);
                        if (clean.length === 6) onChange('#' + clean);
                    }}
                    onBlur={() => { if (hexInput.length < 7) setHexInput(color); }}
                    className="w-full bg-background border border-border rounded-lg pl-6 pr-10 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-accent-primary uppercase transition-all"
                />
                <div
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md border border-border/50 shadow-sm"
                    style={{ backgroundColor: color }}
                />
            </div>

            {/* Divider */}
            <div className="h-px bg-border/50" />

            {/* Presets Section */}
            <div className="space-y-3">

                {/* System Presets */}
                <div className="grid grid-cols-8 gap-2">
                    {SYSTEM_PRESETS.map(c => (
                        <button
                            key={c}
                            onClick={() => onChange(c)}
                            className={`aspect-square rounded-full border border-black/5 dark:border-white/5 transition-all hover:scale-110 active:scale-95 ${color === c ? 'ring-2 ring-offset-1 ring-accent-primary' : ''}`}
                            style={{ backgroundColor: c }}
                            title={c}
                        />
                    ))}
                </div>

                {/* Custom Presets Grid */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-text-secondary font-bold opacity-80">
                        <span>Saved ({customPresets.length})</span>
                        {customPresets.length > 0 && (
                            <button
                                onClick={() => setDeleteMode(!deleteMode)}
                                className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${deleteMode ? 'bg-red-500/10 text-red-500' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                            >
                                {deleteMode ? 'Done' : 'Edit'}
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-7 gap-2">
                        {/* Add Button */}
                        <button
                            onClick={savePreset}
                            className="aspect-square rounded-full border border-dashed border-text-secondary/40 text-text-secondary hover:text-accent-primary hover:border-accent-primary hover:bg-accent-primary/5 flex items-center justify-center transition-all group"
                            title="Save current color"
                        >
                            <Plus size={14} className="group-active:scale-90 transition-transform" />
                        </button>

                        {/* Saved Items */}
                        {customPresets.map((c, i) => (
                            <div key={i} className="relative group/item aspect-square">
                                <button
                                    onClick={() => !deleteMode && onChange(c)}
                                    className={`w-full h-full rounded-full border border-black/5 dark:border-white/5 transition-all ${deleteMode ? 'opacity-80' : 'hover:scale-110 active:scale-95'} ${color === c && !deleteMode ? 'ring-2 ring-offset-1 ring-accent-primary' : ''}`}
                                    style={{ backgroundColor: c }}
                                    title={c}
                                />
                                {/* Delete Badge */}
                                {(deleteMode) && (
                                    <button
                                        onClick={(e) => deletePreset(c, e)}
                                        className="absolute -top-1 -right-1 bg-neutral-900 border border-neutral-700 text-white w-4 h-4 rounded-full flex items-center justify-center hover:bg-red-500 hover:border-red-500 transition-colors shadow-sm z-10"
                                    >
                                        <X size={8} strokeWidth={3} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default ColorPicker;
