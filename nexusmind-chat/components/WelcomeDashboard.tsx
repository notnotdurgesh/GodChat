import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, BrainCircuit } from 'lucide-react';
import { ChatSession } from '../types';

interface WelcomeDashboardProps {
    onStartChat: (query: string) => void;
    recentChats: ChatSession[];
    onSelectSession: (id: string) => void;
    formatTimeAgo: (ts: number) => string;
    isThinkingEnabled: boolean;
    onToggleThinking: () => void;
}

const EXAMPLES = [
    "Explain quantum computing in simple terms",
    "How to make a perfect omelette?",
    "Write a poem about a lonely robot",
    "What are the best places to visit in Japan?",
    "Help me plan a 3rd birthday party",
    "Explain the theory of relativity"
];

// --- Ripple simulation ---
interface Ripple {
    x: number;
    y: number;
    age: number;          // ms since spawn
    maxAge: number;       // total lifetime in ms
    maxRadius: number;    // max expansion radius
    amplitude: number;    // initial wave strength
    damping: number;      // energy decay rate (0-1, higher = faster decay)
    wavelength: number;   // distance between wave crests
    speed: number;        // expansion speed px/frame
}

const WelcomeDashboard: React.FC<WelcomeDashboardProps> = ({ 
    onStartChat, 
    recentChats, 
    onSelectSession,
    formatTimeAgo,
    isThinkingEnabled,
    onToggleThinking
}) => {
    const [input, setInput] = useState('');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ripplesRef = useRef<Ripple[]>([]);
    const animFrameRef = useRef<number>(0);
    const lastAutoSpawnRef = useRef<number>(0);
    const mouseThrottleRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    
    // Rolling Placeholder logic
    const [displayText, setDisplayText] = useState('');
    const [exampleIndex, setExampleIndex] = useState(0);
    const [isTyping, setIsTyping] = useState(true);
    const [showCursor, setShowCursor] = useState(true);

    // Viewport-proportional sizing — use larger dimension for desktop benefit
    const getScale = useCallback(() => {
        const base = Math.max(window.innerWidth, window.innerHeight);
        return Math.max(0.5, base / 1200);
    }, []);

    // --- Ripple spawn ---
    const spawnRipple = useCallback((x: number, y: number, intensity: number = 1) => {
        const scale = getScale();
        const baseRadius = (250 + Math.random() * 200) * scale;
        
        ripplesRef.current.push({
            x,
            y,
            age: 0,
            maxAge: 5000 + Math.random() * 2500, // 5-7.5s lifetime
            maxRadius: baseRadius * intensity,
            amplitude: (0.22 + Math.random() * 0.13) * intensity,
            damping: 0.975 + Math.random() * 0.012, // 0.975-0.987 — slow decay
            wavelength: (22 + Math.random() * 14) * scale,
            speed: (0.7 + Math.random() * 0.35) * scale,
        });
    }, [getScale]);

    // --- Full-screen ripple animation ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: true })!;
        let w = 0, h = 0;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);

        // Theme-aware color and opacity modifier
        const getThemeParams = (): { color: [number, number, number], isLight: boolean } => {
            const style = getComputedStyle(document.documentElement);
            const hex = (style.getPropertyValue('--text-secondary').trim() || '#6b7280').replace('#', '');
            const n = parseInt(hex, 16);
            const isLight = !document.documentElement.classList.contains('dark');
            return { color: [(n >> 16) & 255, (n >> 8) & 255, n & 255], isLight };
        };

        const draw = (now: number) => {
            const dt = lastTimeRef.current ? now - lastTimeRef.current : 16;
            lastTimeRef.current = now;

            ctx.clearRect(0, 0, w, h);
            const { color, isLight } = getThemeParams();
            
            // In light mode, override with a darker color (e.g., deep gray/black) for better visibility
            const [cr, cg, cb] = isLight ? [40, 40, 40] : color;

            // Adjust alpha for visibility without blowing out. Light mode can take a bit more now that it's darker.
            const alphaMultiplier = isLight ? 0.65 : 1.0;

            // Auto-spawn across full viewport — more frequently for desktop
            if (now - lastAutoSpawnRef.current > 1000 + Math.random() * 1000) {
                const pad = 60;
                spawnRipple(
                    pad + Math.random() * Math.max(1, w - pad * 2),
                    pad + Math.random() * Math.max(1, h - pad * 2),
                    0.6 + Math.random() * 0.4
                );
                lastAutoSpawnRef.current = now;
            }

            // Additive blending for wave interference (screen for dark, multiply or normal for light to look like ink/shadows instead of light)
            ctx.globalCompositeOperation = isLight ? 'source-over' : 'screen';

            const alive: Ripple[] = [];
            for (const rip of ripplesRef.current) {
                rip.age += dt;
                if (rip.age >= rip.maxAge) continue;

                const lifeProgress = rip.age / rip.maxAge;
                const currentRadius = rip.speed * rip.age * 0.06;
                if (currentRadius > rip.maxRadius) continue;

                // Exponential damping — amplitude decays naturally over time
                const energy = rip.amplitude * Math.pow(rip.damping, rip.age * 0.06);
                if (energy < 0.003) continue;

                // Envelope fade: smooth in and out over lifetime
                const envelope = Math.sin(lifeProgress * Math.PI);

                // Draw multiple wavefronts (like real water - multiple crests per drop)
                const numWaves = Math.floor(currentRadius / rip.wavelength);
                for (let i = 0; i <= numWaves; i++) {
                    const waveRadius = currentRadius - i * rip.wavelength;
                    if (waveRadius < 2) continue;

                    // Each successive wavefront is weaker
                    const waveFalloff = Math.pow(0.7, i);
                    // Inner waves are slightly stronger (fresher)
                    const alpha = energy * envelope * waveFalloff * alphaMultiplier;
                    if (alpha < 0.003) continue;

                    // Soft gradient ring width scales with viewport — wider for visibility
                    const ringHalf = (5 + (1 - lifeProgress) * 8) * (rip.wavelength / 18);
                    const innerR = Math.max(0, waveRadius - ringHalf);
                    const outerR = waveRadius + ringHalf;

                    const grad = ctx.createRadialGradient(rip.x, rip.y, innerR, rip.x, rip.y, outerR);
                    grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0)`);
                    grad.addColorStop(0.3, `rgba(${cr}, ${cg}, ${cb}, ${alpha * 0.4})`);
                    grad.addColorStop(0.5, `rgba(${cr}, ${cg}, ${cb}, ${alpha})`);
                    grad.addColorStop(0.7, `rgba(${cr}, ${cg}, ${cb}, ${alpha * 0.4})`);
                    grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

                    ctx.beginPath();
                    ctx.arc(rip.x, rip.y, outerR, 0, Math.PI * 2);
                    if (innerR > 0) {
                        ctx.arc(rip.x, rip.y, innerR, 0, Math.PI * 2, true);
                    }
                    ctx.fillStyle = grad;
                    ctx.fill();
                }

                alive.push(rip);
            }
            ripplesRef.current = alive;

            ctx.globalCompositeOperation = 'source-over';
            animFrameRef.current = requestAnimationFrame(draw);
        };
        animFrameRef.current = requestAnimationFrame(draw);

        // Mouse → gentle trail
        const onMove = (e: MouseEvent) => {
            const now = performance.now();
            if (now - mouseThrottleRef.current < 350) return;
            mouseThrottleRef.current = now;
            spawnRipple(e.clientX, e.clientY, 0.3);
        };

        // Click → full drop
        const onClick = (e: MouseEvent) => {
            spawnRipple(e.clientX, e.clientY, 1.0);
        };

        // Touch
        const onTouch = (e: TouchEvent) => {
            const t = e.touches[0];
            if (t) spawnRipple(t.clientX, t.clientY, 0.6);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('click', onClick);
        window.addEventListener('touchstart', onTouch, { passive: true });

        return () => {
            cancelAnimationFrame(animFrameRef.current);
            window.removeEventListener('resize', resize);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('click', onClick);
            window.removeEventListener('touchstart', onTouch);
        };
    }, [spawnRipple]);

    // Typing Logic
    useEffect(() => {
        let timeout: NodeJS.Timeout;
        const currentExample = EXAMPLES[exampleIndex];

        if (isTyping) {
            if (displayText.length < currentExample.length) {
                timeout = setTimeout(() => {
                    setDisplayText(currentExample.slice(0, displayText.length + 1));
                }, 40);
            } else {
                timeout = setTimeout(() => setIsTyping(false), 2500);
            }
        } else {
            if (displayText.length > 0) {
                timeout = setTimeout(() => {
                    setDisplayText(displayText.slice(0, -1));
                }, 25);
            } else {
                setExampleIndex((prev) => (prev + 1) % EXAMPLES.length);
                setIsTyping(true);
            }
        }

        return () => clearTimeout(timeout);
    }, [displayText, isTyping, exampleIndex]);

    // Cursor Logic
    useEffect(() => {
        const interval = setInterval(() => {
            setShowCursor(prev => !prev);
        }, 530);
        return () => clearInterval(interval);
    }, []);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (input.trim()) {
            onStartChat(input.trim());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const containerVariants: any = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
                delayChildren: 0.2
            }
        },
        exit: {
            opacity: 0,
            y: -20,
            transition: { duration: 0.3, ease: "easeInOut" }
        }
    };

    const itemVariants: any = {
        hidden: { opacity: 0, y: 20 },
        visible: {
            opacity: 1,
            y: 0,
            transition: { type: "spring", stiffness: 100, damping: 15 }
        }
    };

    return (
        <>
            {/* Full-screen ripple canvas */}
            <canvas
                ref={canvasRef}
                className="fixed inset-0 w-full h-full pointer-events-none"
                style={{ zIndex: 5 }}
            />

            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="w-full max-w-4xl px-6 flex flex-col items-center justify-center min-h-[85vh] relative z-10 py-12"
            >
                {/* Header / Greeting */}
                <motion.div variants={itemVariants} className="text-center mb-8 md:mb-12 space-y-4">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight text-text-primary leading-tight">
                        Where should we start?
                    </h1>
                </motion.div>

                {/* Central Input Bar */}
                <motion.div 
                    variants={itemVariants} 
                    className="w-full max-w-2xl relative mb-10 md:mb-16"
                >
                    <div className="relative flex flex-col p-2.5 sm:p-3 rounded-2xl border border-border bg-surface transition-colors duration-200 focus-within:border-accent-primary/40">
                        <textarea
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                e.target.style.height = 'auto';
                                e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px';
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder={input ? "" : (displayText + (showCursor ? '|' : ' '))}
                            className="w-full bg-transparent text-text-primary placeholder-text-secondary/40 text-sm sm:text-base py-2.5 sm:py-3 px-4 sm:px-5 focus:outline-none resize-none min-h-[44px] sm:min-h-[52px] max-h-60 leading-relaxed"
                            rows={1}
                            onInput={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = 'auto';
                                target.style.height = `${target.scrollHeight}px`;
                            }}
                        />

                        <div className="flex items-center justify-between px-2 pt-1">
                            <button
                                onClick={onToggleThinking}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${isThinkingEnabled ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5'}`}
                                title="Toggle Reasoning Model"
                            >
                                <BrainCircuit size={14} />
                                <span>Reasoning {isThinkingEnabled ? 'On' : 'Off'}</span>
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={!input.trim()}
                                className={`
                                    h-8 sm:h-9 px-4 sm:px-5 flex items-center justify-center rounded-xl transition-all duration-300 gap-2
                                    ${!input.trim() 
                                        ? 'bg-transparent text-text-secondary cursor-not-allowed opacity-40' 
                                        : 'bg-text-primary text-background hover:scale-105 hover:shadow-md'
                                    }
                                `}
                            >
                                <span className="text-xs sm:text-sm font-medium">Send</span>
                                <Send size={14} />
                            </button>
                        </div>
                    </div>
                </motion.div>

                {/* Recent Chats */}
                {recentChats.length > 0 && (
                    <motion.div variants={itemVariants} className="w-full max-w-lg mx-auto">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="h-px flex-1 bg-border/50" />
                            <span className="text-[11px] uppercase tracking-widest font-semibold text-text-secondary/40">Recent conversations</span>
                            <div className="h-px flex-1 bg-border/50" />
                        </div>

                        <div>
                            {recentChats.map((session) => (
                                <motion.button
                                    key={session.id}
                                    whileHover={{ scale: 1.01, x: 4 }}
                                    whileTap={{ scale: 0.99 }}
                                    onClick={() => onSelectSession(session.id)}
                                    className="group w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all duration-150 hover:bg-surface border border-transparent hover:border-border/50 active:scale-[0.99]"
                                >
                                    <div
                                        className="w-3 h-3 rounded-full shrink-0 transition-all duration-200 group-hover:scale-125"
                                        style={{ backgroundColor: session.customColor || 'var(--accent-primary)', opacity: 0.5 }}
                                    />

                                    <div className="flex-1 min-w-0">
                                        <div className="text-md font-medium text-text-primary truncate opacity-80 group-hover:opacity-100 transition-opacity">
                                            {session.title || 'Untitled Chat'}
                                        </div>
                                    </div>

                                    <span className="text-[13px] text-text-secondary/40 shrink-0">{formatTimeAgo(session.updatedAt)}</span>

                                    <svg
                                        width="18" height="18" viewBox="0 0 16 16" fill="none"
                                        className="shrink-0 text-text-secondary/20 group-hover:text-accent-primary transition-all duration-200 group-hover:translate-x-1"
                                    >
                                        <path d="M3 8h8M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </motion.button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </motion.div>
        </>
    );
};

export default WelcomeDashboard;
