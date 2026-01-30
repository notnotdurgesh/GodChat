import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPortal } from 'react-dom';
import { MessageNode, Role, GraphNote } from '../types';
import { GraphNoteComponent } from './GraphNote';
import { GraphNoteEditorModal } from './GraphNoteEditorModal';
import { v4 as uuidv4 } from 'uuid';
import { COLORS } from '../constants';
import { Search, Crosshair, Edit2, Maximize, Minimize, Move, Palette, Type, Check, X, RotateCcw, LayoutTemplate, Loader2, PanelLeft, PanelLeftClose } from 'lucide-react';
import ColorPicker from './ColorPicker';
import MarkdownRenderer from './MarkdownRenderer';
import { useTheme } from '../contexts/ThemeContext';

interface GraphViewProps {
  nodes: Record<string, MessageNode>;
  rootId: string;
  activeNodeId: string;
  onNodeClick: (id: string) => void;
  onDelete?: (id: string) => void;
  onUpdateNode?: (id: string, updates: Partial<MessageNode>) => void;
  onResetLayout?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  focusTrigger?: number;
  // Notes
  notes: Record<string, GraphNote>;
  onAddNote: (note: GraphNote) => void;
  onUpdateNote: (id: string, updates: Partial<GraphNote>) => void;
  onDeleteNote: (id: string) => void;
}

interface TreeDatum {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  children?: TreeDatum[];
  // Visuals
  customLabel?: string;
  customColor?: string;
  visualOffset?: { x: number, y: number };
  isLoading?: boolean;
}

interface EditNodeForm {
  id: string;
  label: string;
  color: string;
}

const GraphView: React.FC<GraphViewProps> = ({
  nodes,
  rootId,
  activeNodeId,
  onNodeClick,
  onDelete,
  onUpdateNode,
  onResetLayout,
  isFullscreen,
  onToggleFullscreen,
  onToggleSidebar,
  isSidebarOpen,
  focusTrigger = 0,
  notes,
  onAddNote,
  onUpdateNote,
  onDeleteNote
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const notesLayerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  // Tools
  const [activeTool, setActiveTool] = useState<'select' | 'text'>('select');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const [activeNoteEditorId, setActiveNoteEditorId] = useState<string | null>(null);
  const [noteMenuPos, setNoteMenuPos] = useState<{ x: number, y: number } | undefined>(undefined);

  // Zoom Transform State (for converting screen coords)
  const [currentZoomState, setCurrentZoomState] = useState(d3.zoomIdentity);

  // Filtering & Interaction State
  const [filterText, setFilterText] = useState('');
  const [filterRole, setFilterRole] = useState<'ALL' | Role>('ALL');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Edit Mode State
  const [isEditMode, setIsEditMode] = useState(false);
  const [editForm, setEditForm] = useState<EditNodeForm | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastUpdateRef = useRef(0);
  const prevRootIdRef = useRef<string | null>(null);
  const prevFocusTriggerRef = useRef<number>(0);
  const labelCacheRef = useRef<Map<string, { content: string, theme: string, html: string }>>(new Map());

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

  // Track container width for responsive toolbar layout
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // If Edit Mode is turned off, close any open forms
  useEffect(() => {
    if (!isEditMode) {
      // Use standard callback to avoid effect setState warning if possible, 
      // or essentially this is a sync of state. 
      // The warning says avoid it, but here it's "if A changed, sync B".
      // We can do setEditForm(null) but it triggers re-render.
      // Better: Reset it in the same handler that sets isEditMode(false).
    }
  }, [isEditMode]);

  const activePathIds = useMemo(() => {
    const ids = new Set<string>();
    let curr: string | null = activeNodeId;
    while (curr) {
      ids.add(curr);
      curr = nodes[curr]?.parentId;
    }
    return ids;
  }, [nodes, activeNodeId]);

  // buildHierarchy is defined inside the useEffect to avoid "accessed before declared" issues with recursive useCallback

  const handleDragEnd = useCallback((d: any, finalX: number, finalY: number) => {
    // Calculate delta from the original tree layout position (which is d.x, d.y before drag modified it? 
    // Wait, d3 drag modifies the event subject. 
    // We need to capture the 'original' layout position which we can store on the datum)

    // Actually, in the drag handler below we will likely update the DOM. 
    // To persist, we need to know the offset.
    // Offset = FinalPos - OriginalTreePos
    // We'll store 'treeX' and 'treeY' on the node during layout.

    if (onUpdateNode) {
      const offsetX = finalX - d.treeX;
      const offsetY = finalY - d.treeY;
      onUpdateNode(d.data.id, { visualOffset: { x: offsetX, y: offsetY } });
    }
  }, [onUpdateNode]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !rootId || !nodes[rootId]) return;

    // Defer heavy rendering to unblock the main thread for animations
    // THROTTLE: Only update graph every ~50ms to prevent main thread blocking during high-speed streaming
    // const lastUpdateRef = useRef(0); // MOVED TO TOP LEVEL

    // We used to use a simple setTimeout(0), which is basically setImmediate.
    // Now we use a real throttle via requestAnimationFrame + timestamp check? 
    // Or just a setTimeout with delay?
    // Let's use a 50ms (20fps) throttle which is enough for smooth visual but saves huge CPU.

    const timerId = setTimeout(() => {
      const now = Date.now();
      if (now - lastUpdateRef.current < 40 && nodes[rootId]?.isStreaming) {
        // Skip this frame if we just updated and we are streaming
        // But we must ensure eventual update? 
        // React Effect will run again on next prop change. 
        // If we skip here, we rely on the next token to trigger the next effect.
        // This works fine for continuous streams.
        // But what if the LAST token comes? We shouldn't skip it.
        // So we check: is any node streaming? 
        // If streaming, we can throttle. If not streaming, we MUST render immediately.

        // Actually, simpler logic:
        // Just change the setTimeout delay to 50ms?
        // No, because that just delays everything by 50ms, but still runs every time if fast enough?
        // No, useEffect cleanup will clear the previous timeout!
        // Yes! If props change faster than 50ms, the previous timeout is CLEARED.
        // So only the "last" change within a 50ms window will execute.
        // This is effectively DEBOUNCING.
        // Debouncing is BAD for streaming because the text won't appear until stream PAUSES.
        // We want THROTTLING (run at most every X ms).

        // Correct Throttling with useEffect:
        // We can't easily throttle inside useEffect because it fires on every prop change.
        // We need to decide whether to skip.
        return;
      }
      lastUpdateRef.current = now;

      if (!svgRef.current || !containerRef.current) return;

      // Define buildHierarchy inside the effect to avoid "accessed before declared" issues with recursive functions
      const buildHierarchy = (currentId: string): TreeDatum | null => {
        const node = nodes[currentId];
        if (!node) return null;

        // If this node itself is streaming, we might want to hide it (based on parent logic), 
        // but since we are calling this recursively, the parent decides whether to add it.
        // However, if we are at the root and it's streaming (unlikely), we render it.

        const datum: TreeDatum = {
          id: node.id,
          role: node.role,
          content: node.content,
          timestamp: node.timestamp,
          children: [],
          customLabel: node.customLabel,
          customColor: node.customColor,
          visualOffset: node.visualOffset,
          isLoading: false
        };

        node.childrenIds.forEach(childId => {
          const childNode = nodes[childId];
          if (childNode) {
            if (childNode.isStreaming) {
              // Mark current node as loading, do NOT add child to tree yet
              datum.isLoading = true;
            } else {
              const childDatum = buildHierarchy(childId);
              if (childDatum) {
                datum.children?.push(childDatum);
              }
            }
          }
        });

        if (datum.children?.length === 0) delete datum.children;
        return datum;
      };

      const hierarchyData = buildHierarchy(rootId);
      if (!hierarchyData) return;

      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;

      const cardW = 350;
      const cardH = 110;
      const cardInnerW = 260;

      // Select SVG
      const svg = d3.select(svgRef.current)
        .attr("width", containerWidth)
        .attr("height", containerHeight)
        .style("cursor", isEditMode ? "default" : "grab")
        .style("touch-action", "none");

      // Ensure Layers Exist (One-time setup)
      let gLayer = svg.select<SVGGElement>(".zoom-layer");
      if (gLayer.empty()) {
        gLayer = svg.append("g").attr("class", "zoom-layer");
        // Add layers in order
        gLayer.append("g").attr("class", "link-layer");
        gLayer.append("g").attr("class", "node-layer");
      }

      const linkLayer = gLayer.select<SVGGElement>(".link-layer");
      const nodeLayer = gLayer.select<SVGGElement>(".node-layer");

      // Zoom Behavior
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 2.5])
        .filter((event) => {
          // Allow wheel, mousedown (left click usually), and touchstart
          // D3 defaults: !event.ctrlKey && !event.button
          // We explicitly enable touch
          return (!event.ctrlKey && !event.button) || event.type === 'touchstart';
        })
        .on("zoom", (event) => {
          gLayer.attr("transform", event.transform);
          // Sync React state AND the imperative overlay layer
          setCurrentZoomState(event.transform);
          if (notesLayerRef.current) {
            notesLayerRef.current.style.transform = event.transform.toString();
          }
        });

      svg.call(zoom).on("dblclick.zoom", null);

      // --- Tree Layout Calculation ---
      const root = d3.hierarchy(hierarchyData);

      // Tighter layout
      const nodeWidth = 370;
      const nodeHeight = 150;

      const treeLayout = d3.tree<TreeDatum>()
        .nodeSize([nodeWidth, nodeHeight])
        .separation((a, b) => (a.parent === b.parent ? 1.1 : 1.3));

      treeLayout(root);

      // Apply Visual Offsets & cache tree positions
      root.descendants().forEach((d: any) => {
        d.treeX = d.x;
        d.treeY = d.y;
        if (d.data.visualOffset) {
          d.x += d.data.visualOffset.x;
          d.y += d.data.visualOffset.y;
        }
      });

      // --- LINKS (Morphing) ---
      const links = linkLayer.selectAll<SVGPathElement, any>(".link")
        .data(root.links(), (d: any) => `${d.source.data.id}-${d.target.data.id}`);

      // EXIT
      links.exit().transition().duration(500).attr("opacity", 0).remove();

      // ENTER
      const linksEnter = links.enter()
        .append("path")
        .attr("class", "link")
        .attr("fill", "none")
        .attr("opacity", 0)
        .attr("d", (d: any) => {
          // Start from parent's position (collapsed)
          const o = { source: d.source, target: d.source };
          return d3.linkVertical()
            .x((n: any) => n.x)
            .y((n: any) => n.y)(o as any);
        });

      // UPDATE + ENTER Merge
      const linksUpdate = linksEnter.merge(links as any);

      linksUpdate.transition().duration(500)
        .attr("stroke", (d: any) => activePathIds.has(d.target.data.id) ? COLORS.activeNode : 'var(--border-color)')
        .attr("stroke-width", (d: any) => activePathIds.has(d.target.data.id) ? 2.5 : 1.5)
        .attr("stroke-dasharray", (d: any) => activePathIds.has(d.target.data.id) ? "none" : "6,4")
        .attr("opacity", (d: any) => activePathIds.has(d.target.data.id) ? 1 : 0.5)
        .attr("d", d3.linkVertical()
          .x((d: any) => d.x)
          .y((d: any) => d.y) as any
        );


      // --- NODES (Morphing) ---
      const nodesSelection = nodeLayer.selectAll<SVGGElement, any>(".node")
        .data(root.descendants(), (d: any) => d.data.id);

      // EXIT
      nodesSelection.exit().transition().duration(500).style("opacity", 0).remove();

      // ENTER
      const nodesEnter = nodesSelection.enter()
        .append("g")
        .attr("class", "node")
        .attr("id", (d: any) => `node-${d.data.id}`)
        .attr("transform", (d: any) => {
          // Spawn at parent position if exists for smooth expansion
          if (d.parent) return `translate(${d.parent.x},${d.parent.y}) scale(0.5)`;
          return `translate(${d.x},${d.y}) scale(0.5)`;
        })
        .style("opacity", 0)
        .style("cursor", isEditMode ? "move" : "pointer");

      // Append ForeignObject to Enter selection once
      nodesEnter.append("foreignObject")
        .attr("width", cardW)
        .attr("height", cardH)
        .attr("x", -cardW / 2)
        .attr("y", -cardH / 2)
        .style("overflow", "visible");

      // UPDATE + ENTER Merge
      const nodesUpdate = nodesEnter.merge(nodesSelection as any);

      // Animate Position
      nodesUpdate.transition().duration(500)
        .attr("transform", (d: any) => `translate(${d.x},${d.y}) scale(1)`)
        .style("opacity", 1);

      // Update Content (Efficiently)
      nodesUpdate.select("foreignObject")
        .html((d: any) => {
          const isActive = d.data.id === activeNodeId;
          const isActivePath = activePathIds.has(d.data.id);
          const isUser = d.data.role === Role.USER;

          const matchesText = (d.data.customLabel || d.data.content).toLowerCase().includes(filterText.toLowerCase());
          const matchesRole = filterRole === 'ALL' || d.data.role === filterRole;
          const isDimmed = !(matchesText && matchesRole);

          // ... Styling Logic ...
          const customColor = d.data.customColor;
          let bgStyle = '';
          let borderStyle = '';
          let shadowStyle = '';

          if (customColor) {
            const isHex = customColor.startsWith('#') || customColor.startsWith('rgb');
            if (isHex) {
              bgStyle = `background: ${customColor}20; backdrop-filter: blur(12px);`;
              borderStyle = `border-color: ${customColor};`;
              shadowStyle = isActive ? `box-shadow: 0 0 15px ${customColor}60;` : '';
            }
          }

          const baseBgClass = isUser
            ? 'bg-cyan-50/90 dark:bg-cyan-950/40'
            : 'bg-violet-50/90 dark:bg-violet-950/40';

          const borderClass = isActive
            ? 'border-amber-500'
            : (isUser ? 'border-cyan-200 dark:border-cyan-800/60' : 'border-violet-200 dark:border-violet-800/60');

          const shadowClass = isActive
            ? 'shadow-[0_0_15px_rgba(245,158,11,0.4)]'
            : 'shadow-sm hover:shadow-md';

          const finalBg = customColor ? '' : baseBgClass;
          const finalBorder = customColor ? '' : borderClass;
          const finalShadow = customColor ? '' : shadowClass;

          const opacity = isActivePath ? 'opacity-100' : 'opacity-50 hover:opacity-100';
          const dimming = isDimmed ? 'opacity-20 grayscale' : '';

          const iconColorClass = isUser ? 'text-cyan-600 dark:text-cyan-400' : 'text-violet-600 dark:text-violet-400';
          const iconStyle = customColor ? `color: ${customColor}` : '';



          let content = d.data.customLabel || d.data.content || (isUser ? 'Empty' : '...');
          let summary = ''
          // Check for <summary> tag in content if not custom label
          if (!d.data.customLabel && !isUser && content) {
            const summaryMatch = content.match(/<summary[\s\S]*?>([\s\S]*?)(?:<\/summary>|$)/i);
            if (summaryMatch) {
              summary = summaryMatch[1].trim();
              content = summary;
            } else {
              // Remove known tags if no summary found, to show clean text
              content = content.replace(/<suggestions>[\s\S]*?<\/suggestions>/g, '')
                .replace(/<think>[\s\S]*?<\/think>/g, '')
                .replace(/<hidden_data[^>]*>.*?<\/hidden_data>/gs, '');
            }
          }

          let renderedContent = '';
          if (d.data.customLabel) {
            renderedContent = `<div class="text-sm font-semibold truncate leading-tight">${d.data.customLabel}</div>
                                    <div class="text-[10px] opacity-60 truncate">${d.data.id.slice(0, 8)}</div>`;
          } else {
            // Check for tool calls
            const isToolCall = content.trim().startsWith('<function_call');
            const isToolResponse = content.trim().startsWith('<function_results');

            if (isToolCall || isToolResponse) {
              const toolNameMatch = content.match(/name="([^"]+)"/);
              const toolName = toolNameMatch ? (isToolCall ? 'tool call' : 'tool response') : 'tool called';
              const icon = isToolCall
                ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
                : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m21 15-9-7-9 7"/><path d="m21 8-9-7-9 7"/></svg>';

              const colorClass = isToolCall
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400';

              renderedContent = `<div class="flex items-center gap-1.5 px-2 py-1 rounded border font-mono text-[10px] ${colorClass}">
                ${icon}
                <span class="truncate">${toolName}</span>
              </div>`;
            } else {
              const cacheKey = d.data.id;
              const cached = labelCacheRef.current.get(cacheKey);

              if (cached && cached.content === content && cached.theme === (theme as any)) {
                renderedContent = cached.html;
              } else {
                try {
                  renderedContent = renderToStaticMarkup(
                    <MarkdownRenderer content={content} compact={true} isStatic={true} forcedTheme={theme} />
                  );
                  labelCacheRef.current.set(cacheKey, { content, theme: theme as any, html: renderedContent });
                } catch (e) {
                  void e;
                  renderedContent = `<div class="text-[10px] pb-2 px-2">${summary || content.replace(/</g, '&lt;')}</div>`;
                }
              }
            }
          }

          return `
               <div class="w-full h-full relative group flex items-center justify-center pointer-events-none">
                 <div 
                    class="pointer-events-auto w-[${cardInnerW}px] h-full rounded-lg border flex flex-col transition-all duration-300 backdrop-blur-md select-none relative overflow-hidden ${finalBg} ${finalBorder} ${finalShadow} ${opacity} ${dimming}"
                    style="${bgStyle} ${borderStyle} ${shadowStyle}"
                 >
                    ${isEditMode ? `
                        <div class="absolute top-1 right-1 text-xs opacity-50"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
                    `: ''}

                    <div class="p-2.5 flex-1 flex items-start gap-2.5 overflow-hidden">
                      <div class="shrink-0  ${!customColor ? iconColorClass : ''}" style="${iconStyle}">
                        ${isUser
              ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
              : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>'
            }
                      </div>

                      <div class="flex-1 overflow-hidden [&_p:first-child]:mt-0" style="display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; mask-image: linear-gradient(to bottom, black 85%, transparent 100%);">
                        ${renderedContent}
                      </div>
                    </div>
                    ${d.data.isLoading ? `
                        <div class="absolute bottom-2 right-2 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-border shadow-sm transition-all animate-in fade-in zoom-in-50">
                            <div class="animate-spin w-3.5 h-3.5 text-accent-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>
                            <span class="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Generating</span>
                        </div>
                    ` : ''}
                    ${isActive ? `<div class="absolute inset-0 rounded-lg border ${customColor ? '' : 'border-amber-500/50'} pointer-events-none" style="${customColor ? 'border-color:' + customColor : ''}"></div>` : ''}
                 </div>

                 ${!isEditMode && d.data.id !== rootId ? `
                 <div class="absolute right-0.5 top-0 bottom-0 w-[30px] flex flex-col items-center justify-start gap-1.5 pt-0 pointer-events-auto opacity-0 group-hover:opacity-100 ${isActive ? 'opacity-100' : ''} transition-all duration-300">
                    <button class="graph-delete-btn p-1.5 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 hover:border-red-300 dark:hover:border-red-800 transition-all shadow-md hover:shadow-lg hover:scale-110 z-20" title="Delete Branch">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                    
                    <button class="graph-diverge-btn p-1.5 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-400 hover:text-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-950/50 hover:border-cyan-300 dark:hover:border-cyan-800 transition-all shadow-md hover:shadow-lg hover:scale-110 z-20" title="Diverge / Focus">
                       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
                    </button>
                 </div>
                 ` : ''}

               </div>
             `;
        });

      // Click Handler (Bind to nodesUpdate)
      nodesUpdate.on("click", (event, d) => {
        if (event.defaultPrevented) return; // Dragged
        event.stopPropagation();

        // Branch Delete
        if (event.target.closest('.graph-delete-btn')) {
          if (confirm("Delete this branch and all its pathways?")) {
            onDelete?.(d.data.id);
          }
          return;
        }
        // Focus
        if (event.target.closest('.graph-diverge-btn')) {
          onNodeClick(d.data.id);
          return;
        }

        if (isEditMode) {
          // Open Edit Form
          setEditForm({
            id: d.data.id,
            label: d.data.customLabel || (d.data.role === Role.USER ? d.data.content : ""),
            color: d.data.customColor || ""
          });
          return;
        }

        // Normal Navigate
        onNodeClick(d.data.id);

        const scale = 1;
        const x = -d.x * scale + containerWidth / 2;
        const y = -d.y * scale + containerHeight / 2;

        svg.transition()
          .duration(600)
          .call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
      });


      if (isEditMode) {
        const drag = d3.drag<SVGGElement, any>()
          .on("start", (event, _d) => {
            d3.select(event.sourceEvent.target).style("cursor", "grabbing");
          })
          .on("drag", (event, d) => {
            d3.select(event.sourceEvent.target.closest("g")).interrupt();
            d.x += event.dx;
            d.y += event.dy;
            d3.select(event.sourceEvent.target.closest("g")).attr("transform", `translate(${d.x},${d.y})`);

            gLayer.selectAll<SVGPathElement, any>(".link").attr("d", d3.linkVertical()
              .x((l: any) => l.x)
              .y((l: any) => l.y) as any
            );
          })
          .on("end", (event, d) => {
            d3.select(event.sourceEvent.target).style("cursor", "move");
            handleDragEnd(d, d.x, d.y);
          });

        nodesUpdate.call(drag);
      } else {
        nodesUpdate.on(".drag", null);
      }

      // Update Content
      nodesUpdate.select("foreignObject")
        .html((d: any) => {
          const isActive = d.data.id === activeNodeId;
          const isActivePath = activePathIds.has(d.data.id);
          const isUser = d.data.role === Role.USER;

          const matchesText = (d.data.customLabel || d.data.content).toLowerCase().includes(filterText.toLowerCase());
          const matchesRole = filterRole === 'ALL' || d.data.role === filterRole;
          const isDimmed = !(matchesText && matchesRole);

          // --- Styling ---

          // Custom color overrides
          const customColor = d.data.customColor;
          let bgStyle = '';
          let borderStyle = '';
          let shadowStyle = '';

          if (customColor) {
            // If custom color is a hex, use inline styles
            // If it's a tailwind class, use class
            // Assuming user might input hex mostly for "Perfect UI" feel
            const isHex = customColor.startsWith('#') || customColor.startsWith('rgb');
            if (isHex) {
              bgStyle = `background: ${customColor}20; backdrop-filter: blur(12px);`; // 20% opacity
              borderStyle = `border-color: ${customColor};`;
              shadowStyle = isActive ? `box-shadow: 0 0 15px ${customColor}60;` : '';
            } else {
              // Fallback/Tailwind approach
            }
          }

          // Standard Styles (Logic reused if no custom)
          const baseBgClass = isUser
            ? 'bg-cyan-50/90 dark:bg-cyan-950/40'
            : 'bg-violet-50/90 dark:bg-violet-950/40';

          const borderClass = isActive
            ? 'border-amber-500'
            : (isUser ? 'border-cyan-200 dark:border-cyan-800/60' : 'border-violet-200 dark:border-violet-800/60');

          const shadowClass = isActive
            ? 'shadow-[0_0_15px_rgba(245,158,11,0.4)]'
            : 'shadow-sm hover:shadow-md';

          // Construct final strings
          const finalBg = customColor ? '' : baseBgClass;
          const finalBorder = customColor ? '' : borderClass;
          const finalShadow = customColor ? '' : shadowClass;

          const opacity = isActivePath ? 'opacity-100' : 'opacity-50 hover:opacity-100';
          const dimming = isDimmed ? 'opacity-20 grayscale' : '';

          const iconColorClass = isUser ? 'text-cyan-600 dark:text-cyan-400' : 'text-violet-600 dark:text-violet-400';
          const iconStyle = customColor ? `color: ${customColor}` : '';

          // Check for <summary> tag in content if not custom label
          const contentRaw = d.data.customLabel || d.data.content || (isUser ? 'Empty' : '...');
          let content = contentRaw;
          let summary = '';

          if (!d.data.customLabel && !isUser && content) {
            const summaryMatch = content.match(/<summary[\s\S]*?>([\s\S]*?)(?:<\/summary>|$)/i);
            if (summaryMatch) {
              summary = summaryMatch[1].trim();
              content = summary;
            } else {
              // Remove known tags if no summary found, to show clean text
              content = content.replace(/<suggestions>[\s\S]*?<\/suggestions>/g, '')
                .replace(/<think>[\s\S]*?<\/think>/g, '')
                .replace(/<hidden_data[^>]*>.*?<\/hidden_data>/gs, '');
            }
          }
          // Markdown or Plain Text
          // If custom label, plain text usually. If content, markdown.
          let renderedContent = '';
          if (d.data.customLabel) {
            renderedContent = `<div class="text-sm font-semibold truncate leading-tight">${d.data.customLabel}</div>
                                    <div class="text-[10px] opacity-60 truncate">${d.data.id.slice(0, 8)}</div>`;
          } else {
            // Check for tool calls
            const isToolCall = content.trim().startsWith('<function_call');
            const isToolResponse = content.trim().startsWith('<function_results');

            if (isToolCall || isToolResponse) {
              const toolNameMatch = content.match(/name="([^"]+)"/);
              // Extract status from result if possible, though strict status tracking isn't in graph node data easily without parsing.
              // We'll mimic the "Used Tool" style.
              const toolName = toolNameMatch ? toolNameMatch[1] : (isToolCall ? 'tool_call' : 'tool_results');

              // New Gradient Style
              const gradientClass = "bg-clip-text text-transparent bg-gradient-to-r from-zinc-500 via-zinc-800 to-zinc-500 dark:from-zinc-400 dark:via-zinc-100 dark:to-zinc-400 bg-[length:200%_auto]";

              renderedContent = `<div class="flex items-center gap-2 py-1 select-none opacity-90">
                <span class="text-sm font-medium ${gradientClass}">
                   ${'Used ' + toolName}
                </span>
              </div>`;
            } else {
              // Check Cache
              const cacheKey = d.data.id;
              const cached = labelCacheRef.current.get(cacheKey);
              // We must check if content OR theme changed.
              // Note: theme object reference might change, so we might want to rely on a stable theme string if possible, 
              // but for now checking strict equality of content string is the massive win.
              // Theme context usually stable unless toggled.

              // For theme, we can just assume if content matches it's likely fine unless we support dynamic theme switching mid-stream?
              // Yes we do. But `theme` prop comes from hook. 
              // Let's store theme.mode if available or just the theme object.

              if (cached && cached.content === content && cached.theme === (theme as any)) {
                renderedContent = cached.html;
              } else {
                try {
                  renderedContent = renderToStaticMarkup(
                    <MarkdownRenderer content={content} compact={true} isStatic={true} forcedTheme={theme} />
                  );
                  // Update Cache
                  labelCacheRef.current.set(cacheKey, { content, theme: theme as any, html: renderedContent });
                } catch (e) {
                  void e;
                  renderedContent = `<div class="text-[10px] pb-2 px-2">${content.replace(/</g, '&lt;')}</div>`;
                }
              }
            }
          }

          return `
               <div class="w-full h-full relative group flex items-center justify-center pointer-events-none">
                 
                 <!-- Main Card -->
                 <div 
                    class="pointer-events-auto w-[${cardInnerW}px] h-full rounded-lg border flex flex-col transition-all duration-300 backdrop-blur-md select-none relative overflow-hidden ${finalBg} ${finalBorder} ${finalShadow} ${opacity} ${dimming}"
                    style="${bgStyle} ${borderStyle} ${shadowStyle}"
                 >
                    ${isEditMode ? `
                        <div class="absolute top-1 right-1 text-xs opacity-50"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
                    `: ''}

                    <!-- Content Row -->
                    <div class="p-2.5 flex-1 flex items-start gap-2.5 overflow-hidden">
                      <div class="shrink-0 ${!customColor ? iconColorClass : ''}" style="${iconStyle}">
                        ${isUser
              ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
              : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>'
            }
                      </div>
                      <div class="flex-1 overflow-hidden [&_p:first-child]:-mt-1" style="display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; mask-image: linear-gradient(to bottom, black 85%, transparent 100%);">
                        ${renderedContent}
                      </div>
                    </div>
                    ${d.data.isLoading ? `
                        <div class="absolute bottom-2 right-2 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-border shadow-sm transition-all animate-in fade-in zoom-in-50">
                            <div class="animate-spin w-3.5 h-3.5 text-accent-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>
                            <span class="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Generating</span>
                        </div>
                    ` : ''}
                    ${isActive ? `<div class="absolute inset-0 rounded-lg border ${customColor ? '' : 'border-amber-500/50'} pointer-events-none" style="${customColor ? 'border-color:' + customColor : ''}"></div>` : ''}
                 </div>

                 <!-- Side Actions -->
                 ${!isEditMode && d.data.id !== rootId ? `
                 <div class="absolute right-0.5 top-0 bottom-0 w-[30px] flex flex-col items-center justify-start gap-1.5 pt-0 pointer-events-auto opacity-0 group-hover:opacity-100 ${isActive ? 'opacity-100' : ''} transition-all duration-300">
                    <button class="graph-delete-btn p-1.5 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 hover:border-red-300 dark:hover:border-red-800 transition-all shadow-md hover:shadow-lg hover:scale-110 z-20" title="Delete Branch">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                    
                    <button class="graph-diverge-btn p-1.5 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-400 hover:text-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-950/50 hover:border-cyan-300 dark:hover:border-cyan-800 transition-all shadow-md hover:shadow-lg hover:scale-110 z-20" title="Diverge / Focus">
                       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
                    </button>
                 </div>
                 ` : ''}

               </div>
             `;
        });

      // --- Centering Logic ---
      // User Request: Auto-focus active node on First Load and Session Change ("chat changes").
      // We track if rootId changed to detect "Session Change".
      // We assume initial render (prevRootIdRef.current === null) is "First Load".

      const isSessionChange = prevRootIdRef.current !== rootId;
      const isFocusTriggered = ((focusTrigger || 0) > prevFocusTriggerRef.current);

      const currentTransform = d3.zoomTransform(svg.node()!);

      if (isSessionChange || isFocusTriggered) {
        // PERFECTION: Auto-center on the active node
        // We need to find the active node's coordinates (calculated by d3 tree layout above)
        // The node data is bound to the DOM elements.

        let targetX = containerWidth / 2;
        let targetY = containerHeight / 2;
        const scale = 1;

        // Find active node in the d3 layout
        // We can look at the root.descendants() we just computed
        const activeNodeDatum = root.descendants().find((d: any) => d.data.id === activeNodeId);

        if (activeNodeDatum) {
          const d: any = activeNodeDatum;
          // Calculate transform to center this node
          // Translate(Center - NodePos)
          targetX = -d.x + containerWidth / 2;
          targetY = -d.y + containerHeight / 2;
        } else {
          // Fallback to root or default (0,0 is usually root if layout centers it, but tree layout starts at x,y)
          // Actually d3.tree usually places root at top (x=0?). 
          // Let's rely on standard identity relative to container center usually if fails.
          targetX = containerWidth / 2;
          targetY = 100; // Top padding
        }

        const newTransform = d3.zoomIdentity.translate(targetX, targetY).scale(scale);

        // Use transition for smoothness "like good"
        svg.transition().duration(750).call(zoom.transform as any, newTransform);

        // Update Refs
        if (isSessionChange) prevRootIdRef.current = rootId;
        if (isFocusTriggered) prevFocusTriggerRef.current = focusTrigger || 0;

      } else {
        // Not a session change, so MAINTAIN user's pan/zoom
        // Unless it's completely reset (identity 0,0,1 which usually means first render but we handle that via isSessionChange if rootId starts null)
        // Actually d3.zoomTransform defaults to identity.

        if (currentTransform.k !== 1 || currentTransform.x !== 0 || currentTransform.y !== 0) {
          gLayer.attr("transform", currentTransform.toString());
        }
        // else: It's identity. If it's the very first time but somehow rootId matched (unlikely), we do nothing.
      }

    }, 0);

    return () => clearTimeout(timerId);

  }, [nodes, rootId, activeNodeId, filterText, filterRole, activePathIds, theme, isEditMode, onUpdateNode, handleDragEnd, onNodeClick, onDelete, focusTrigger]); // removed notes from dep to avoid full D3 re-render on note type
  // buildHierarchy is now defined inside the effect to avoid recursive useCallback issues

  // Keyboard Shortcuts (Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteId && !editingNoteId) {
        onDeleteNote(selectedNoteId);
        setSelectedNoteId(null);
      }
      if (e.key === 'Escape') {
        if (editingNoteId) setEditingNoteId(null); // Exit edit
        else if (selectedNoteId) setSelectedNoteId(null); // Deselect
        else if (activeTool === 'text') setActiveTool('select'); // Cancel tool
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNoteId, editingNoteId, activeTool, onDeleteNote]);

  // Note Interaction
  const handleCanvasClick = (e: React.MouseEvent) => {
    // If clicking strictly on canvas (not on node/note)
    if (activeTool === 'text') {
      // Create Note
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;

      // Apply Inverse Transform
      const [x, y] = currentZoomState.invert([rawX, rawY]);

      const newId = uuidv4();
      onAddNote({
        id: newId,
        x,
        y,
        content: '',
        resizeMode: 'AUTO',
        style: {
          fontFamily: 'Virgil',
          fontSize: 'M',
          textAlign: 'left',
        },
        createdAt: Date.now()
      });

      setEditingNoteId(newId);
      setSelectedNoteId(newId);
      setActiveTool('select'); // Auto-switch back
    } else {
      // Deselect if clicking empty space
      setEditingNoteId(null);
      setSelectedNoteId(null);
    }
  };

  // SSR-safe touch detection
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    setIsTouchDevice(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative overflow-hidden bg-background touch-action-none ${activeTool === 'text' ? 'cursor-text' : ''}`}
      onClick={handleCanvasClick}
    >

      {/* Toolbar (Notes & Tools) */}
      <div className={`absolute top-4 left-6 z-50 transition-all duration-300`}>
        <div className={`bg-white/90 dark:bg-zinc-900/90 backdrop-blur-2xl p-1.5 rounded-2xl border border-gray-200/50 dark:border-zinc-800/50 shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)] flex ${containerWidth < 450 ? 'flex-row' : 'flex-col md:flex-col'} gap-1.5 transition-all duration-300 pointer-events-auto`}>
          <button
            onClick={() => setActiveTool('select')}
            className={`p-2.5 rounded-xl transition-all duration-200 active:scale-90 ${activeTool === 'select' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50 shadow-sm' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5'}`}
            title="Selection Tool (V)"
          >
            <Move size={20} />
          </button>
          <button
            onClick={() => setActiveTool('text')}
            className={`p-2.5 rounded-xl transition-all duration-200 active:scale-90 ${activeTool === 'text' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50 shadow-sm' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5'}`}
            title="Text Tool (T / Click to create)"
          >
            <Type size={20} />
          </button>
        </div>
      </div>


      {/* Graph Note Editor Modal */}
      {activeNoteEditorId && notes[activeNoteEditorId] && (
        <GraphNoteEditorModal
          note={notes[activeNoteEditorId]}
          onUpdate={(updates) => onUpdateNote(activeNoteEditorId, updates)}
          onDelete={() => {
            onDeleteNote(activeNoteEditorId);
            setActiveNoteEditorId(null);
          }}
          onDuplicate={() => {
            const original = notes[activeNoteEditorId];
            const newNote: GraphNote = {
              ...original,
              id: uuidv4(),
              x: original.x + 20,
              y: original.y + 20,
              createdAt: Date.now()
            };
            onAddNote(newNote);
            setActiveNoteEditorId(null);
          }}
          onClose={() => setActiveNoteEditorId(null)}
          position={noteMenuPos}
          isMobile={window.matchMedia("(max-width: 768px)").matches}
        />
      )}

      {/* Render Notes Portal */}
      {/* Notes Overlay Layer - Independent from SVG for perfect interaction */}
      <div
        ref={notesLayerRef}
        className="absolute inset-0 pointer-events-none origin-top-left overflow-visible z-10"
        style={{
          transform: `translate(${currentZoomState.x}px, ${currentZoomState.y}px) scale(${currentZoomState.k})`
        }}
      >
        {Object.values(notes).map(note => (
          <div
            key={note.id}
            className="absolute select-none will-change-transform"
            style={{
              left: 0,
              top: 0,
              transform: `translate(${note.x}px, ${note.y}px)`,
              pointerEvents: 'auto',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden'
            }}
          >
            <GraphNoteComponent
              note={note}
              isSelected={selectedNoteId === note.id}
              isEditing={editingNoteId === note.id}
              scale={currentZoomState.k}
              enableTouch={isTouchDevice}
              onSelect={(e) => {
                e.stopPropagation();
                setSelectedNoteId(note.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingNoteId(note.id);
                setSelectedNoteId(note.id);
              }}
              onUpdate={(updates) => onUpdateNote(note.id, updates)}
              onDelete={() => {
                onDeleteNote(note.id);
                if (selectedNoteId === note.id) setSelectedNoteId(null);
              }}
              onEditRequested={(e) => {
                if ('clientX' in e) {
                  setNoteMenuPos({ x: e.clientX, y: e.clientY });
                } else {
                  // Touch event - center/bottom handling logic inside modal or default undefined
                  setNoteMenuPos(undefined);
                }
                setActiveNoteEditorId(note.id);
              }}
            />
          </div>
        ))}
      </div>

      <div className="absolute inset-0 cyber-grid pointer-events-none opacity-20"></div>

      <div className="absolute top-20 left-4 right-4 z-10 flex justify-center pointer-events-none">
        <div className="bg-white/90 dark:bg-zinc-900/90 border border-gray-200/50 dark:border-zinc-800/50 p-1.5 rounded-2xl flex flex-wrap items-center justify-center gap-0.5 shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)] pointer-events-auto transition-all duration-300 backdrop-blur-2xl max-w-full">

          {/* Sidebar Toggle (Fullscreen Mode Only) */}
          {isFullscreen && onToggleSidebar && (
            <>
              <button
                onClick={onToggleSidebar}
                className={`h-10 w-10 flex items-center justify-center rounded-xl transition-all duration-200 text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 active:scale-90`}
                title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
              >
                {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
              </button>
              <div className="h-6 w-px bg-border/60 mx-1"></div>
            </>
          )}

          {/* -- Edit Toggle -- */}
          <button
            onClick={() => {
              setIsEditMode(!isEditMode);
              if (isEditMode) setEditForm(null); // Close form when toggling off
            }}
            className={`h-10 px-3.5 flex items-center gap-2 rounded-xl transition-all duration-200 font-semibold text-xs active:scale-95 ${isEditMode ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50 shadow-sm' : 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5'}`}
            title="Toggle Edit & Arrange Mode"
          >
            {isEditMode ? <Check size={20} /> : <Edit2 size={20} />}
          </button>

          <div className="h-6 w-px bg-border/60 mx-1 hidden sm:block"></div>

          {/* Reset Layout */}
          {onResetLayout && (
            <button
              onClick={() => {
                if (window.confirm("This will 'beautify' the graph by removing all custom node positions and resetting them to the default automatic layout.")) {
                  onResetLayout();
                }
              }}
              className="w-10 h-10 flex items-center justify-center text-text-secondary hover:text-text-primary rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 active:scale-90"
              title="Restructure & Reset Layout"
            >
              <LayoutTemplate size={20} />
            </button>
          )}

          {/* Search */}
          <div className="flex items-center bg-transparent relative">
            <button
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 active:scale-90 ${isSearchOpen ? 'text-accent-primary bg-accent-primary/15 shadow-inner' : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              <Search size={20} />
            </button>

            {isSearchOpen && (
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Find node..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onBlur={() => {
                  // Close after delay if lost focus
                  setTimeout(() => setIsSearchOpen(false), 200);
                }}
                className="w-32 sm:w-44 bg-transparent border-b-2 border-border/40 text-xs text-text-primary focus:outline-none focus:border-accent-primary px-2 py-1 ml-1 animate-in fade-in slide-in-from-left-2 duration-300"
              />
            )}
          </div>

          <div className="h-6 w-px bg-border/60 mx-1"></div>

          {/* Role Filter - Premium Segmented Control Feel */}
          <div className="flex bg-black/5 dark:bg-white/5 p-1 rounded-xl gap-1">
            <button
              onClick={() => setFilterRole('ALL')}
              className={`w-8 h-8 flex items-center justify-center rounded-lg text-[11px] font-bold transition-all duration-200 ${filterRole === 'ALL' ? 'bg-white dark:bg-zinc-800 text-text-primary shadow-sm scale-105' : 'text-text-secondary/60 hover:text-text-primary hover:bg-white/50 dark:hover:bg-zinc-800/50'}`}
              title="Show All"
            >
              All
            </button>
            <button
              onClick={() => setFilterRole(Role.USER)}
              className={`w-8 h-8 flex items-center justify-center rounded-lg text-[11px] font-bold transition-all duration-200 ${filterRole === Role.USER ? 'bg-cyan-500 text-white shadow-md scale-105' : 'text-text-secondary/60 hover:text-cyan-500 hover:bg-cyan-500/10'}`}
              title="Filter by User"
            >
              User
            </button>
            <button
              onClick={() => setFilterRole(Role.MODEL)}
              className={`w-8 h-8 flex items-center justify-center rounded-lg text-[11px] font-bold transition-all duration-200 ${filterRole === Role.MODEL ? 'bg-violet-500 text-white shadow-md scale-105' : 'text-text-secondary/60 hover:text-violet-500 hover:bg-violet-500/10'}`}
              title="Filter by Assistant"
            >
              AI
            </button>
          </div>

          <div className="h-6 w-px bg-border/60 mx-1"></div>

          {/* Center View */}
          <button
            onClick={() => {
              if (svgRef.current && containerRef.current) {
                const svg = d3.select(svgRef.current);
                const zoom = d3.zoom().scaleExtent([0.1, 2.5]).on("zoom", (e) => d3.select(svgRef.current).select("g").attr("transform", e.transform));

                let transform = d3.zoomIdentity.translate(containerRef.current.clientWidth / 2, 100).scale(1);
                if (activeNodeId) {
                  const activeNode = svg.select(`#node-${activeNodeId}`);
                  if (!activeNode.empty()) {
                    const d: any = activeNode.datum();
                    transform = d3.zoomIdentity.translate(-d.x + containerRef.current.clientWidth / 2, -d.y + containerRef.current.clientHeight / 2).scale(1);
                  }
                }
                svg.transition().duration(750).call(zoom.transform as any, transform);
              }
            }}
            className="w-10 h-10 flex items-center justify-center text-text-secondary hover:text-text-primary rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 active:scale-90"
            title="Recenter"
          >
            <Crosshair size={20} />
          </button>

          {/* Fullscreen Toggle */}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className={`w-10 h-10 flex items-center justify-center text-text-secondary hover:text-text-primary rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 active:scale-90 ${isFullscreen ? 'text-accent-primary' : ''}`}
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          )}

        </div>
      </div>

      {/* Edit Form Popup */}
      {
        isEditMode && editForm && (
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px] z-40 flex items-center justify-center">
            <div
              className="bg-surface border border-border rounded-xl shadow-2xl w-[320px] p-4 flex flex-col gap-4 animate-in zoom-in-95 duration-200"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="font-bold text-text-primary text-sm flex items-center gap-2">
                <Edit2 size={16} className="text-accent-primary" />
                Edit Node Style
              </h3>
              <button onClick={() => setEditForm(null)} className="p-1 rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><X size={18} /></button>


              <div className="flex flex-col gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                    <Type size={14} /> Label Override
                  </label>
                  <input
                    type="text"
                    value={editForm.label}
                    onChange={e => setEditForm(prev => prev ? ({ ...prev, label: e.target.value }) : null)}
                    placeholder="Custom label..."
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                    <Palette size={14} /> Color Override
                  </label>
                  <div className="pt-1">
                    {/* Simplified usage: Just toggle visibility or show it? 
                       Let's show a compact trigger that opens the picker, or just embed it if space permits.
                       Given "Perfect UI", a popover relative to the trigger is best, but for simplicity in this modal,
                       let's use an accordion-style or just embed it with a clean look.
                   */}
                    <ColorPicker
                      color={editForm.color || '#6366f1'}
                      onChange={c => setEditForm(prev => prev ? ({ ...prev, color: c }) : null)}
                      className="w-full shadow-none border-none bg-transparent p-0"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    onUpdateNode?.(editForm.id, { customLabel: undefined, customColor: undefined, visualOffset: undefined });
                    setEditForm(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  <RotateCcw size={16} /> Reset
                </button>
                <button
                  onClick={() => {
                    const currentNode = nodes[editForm.id];
                    const shouldClearLabel = currentNode && (editForm.label === currentNode.content || !editForm.label.trim());

                    onUpdateNode?.(editForm.id, {
                      customLabel: shouldClearLabel ? undefined : editForm.label,
                      customColor: editForm.color
                    });
                    setEditForm(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-accent-primary text-white hover:opacity-90 shadow-lg shadow-accent-primary/20 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  <Check size={16} /> Save
                </button>
              </div>
            </div>
          </div>
        )
      }

      <svg ref={svgRef} className="block w-full h-full relative z-0"></svg>
    </div >
  );
};

export default React.memo(GraphView);