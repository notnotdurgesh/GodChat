import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChatSession, SessionFolder } from '../types';
import { Plus, MessageSquare, Trash2, Settings, FolderPlus, MoreHorizontal, ChevronDown, CheckSquare, Folder, Edit2, Palette, X, Import, Loader2, AlertTriangle } from 'lucide-react';
import ColorPicker from './ColorPicker';

interface SidebarProps {
  sessions: Record<string, ChatSession>;
  folders: Record<string, SessionFolder>;
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onUpdateSession: (id: string, updates: Partial<ChatSession>) => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onUpdateFolder: (id: string, updates: Partial<SessionFolder>) => void;
  onOpenSettings: (rect?: DOMRect) => void;
  onOpenImport: () => void;
  streamingSessionIds?: Set<string>;
}

const areSidebarPropsEqual = (prev: SidebarProps, next: SidebarProps) => {
  // 1. Simple props check
  if (prev.currentSessionId !== next.currentSessionId) return false;

  // 2. Compare Sessions Metadata (Ignoring deep 'nodes' content)
  const prevKeys = Object.keys(prev.sessions);
  const nextKeys = Object.keys(next.sessions);
  if (prevKeys.length !== nextKeys.length) return false;

  // Check if session references changed? 
  // During streaming, the session object reference DOES change.
  // We must inspect content that matters to Sidebar: title, folderId, updatedAt, customColor.
  for (const key of nextKeys) {
    const p = prev.sessions[key];
    const n = next.sessions[key];
    if (!p) return false; // New session added
    if (p.title !== n.title) return false;
    if (p.folderId !== n.folderId) return false;
    if (p.updatedAt !== n.updatedAt) return false;
    if (p.customColor !== n.customColor) return false;
    if (p.order !== n.order) return false;
  }

  // 3. Compare Folders (usually stable, but check anyway)
  const prevFolderKeys = Object.keys(prev.folders);
  const nextFolderKeys = Object.keys(next.folders);
  if (prevFolderKeys.length !== nextFolderKeys.length) return false;

  for (const key of nextFolderKeys) {
    if (prev.folders[key] !== next.folders[key]) return false;
  }

  // Compare streaming session IDs
  const prevStreaming = prev.streamingSessionIds || new Set();
  const nextStreaming = next.streamingSessionIds || new Set();
  if (prevStreaming.size !== nextStreaming.size) return false;
  for (const id of nextStreaming) {
    if (!prevStreaming.has(id)) return false;
  }

  return true;
};

const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  folders,
  currentSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onUpdateSession,
  onCreateFolder,
  onDeleteFolder,
  onUpdateFolder,
  onOpenSettings,
  onOpenImport,
  streamingSessionIds = new Set()
}) => {
  // --- State ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'session' | 'folder', id: string } | null>(null);

  // Editing Rename State
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Drag and Drop State
  // Drag and Drop State
  const [draggedItem, setDraggedItem] = useState<{ type: 'session' | 'folder', id: string } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ type: 'session' | 'folder', id: string, position: 'before' | 'after' | 'inside' } | null>(null);

  // Color Picker State
  const [colorPickerTarget, setColorPickerTarget] = useState<{ type: 'session' | 'folder', id: string, rect: DOMRect } | null>(null);

  // Sorting
  // Sorting - Use order if available, else date
  const sortedSessions = (Object.values(sessions) as ChatSession[]).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || b.updatedAt - a.updatedAt);
  const sortedFolders = (Object.values(folders) as SessionFolder[]).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || b.createdAt - a.createdAt);

  // Folder delete confirmation state
  const [folderDeleteConfirm, setFolderDeleteConfirm] = useState<{ id: string; name: string; chatCount: number } | null>(null);

  const sessionsInFolders = sortedSessions.filter(s => s.folderId);
  const unorganisedSessions = sortedSessions.filter(s => !s.folderId);

  // --- Helpers ---

  const handleContextMenu = (e: React.MouseEvent, type: 'session' | 'folder', id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMultiSelectMode) return;
    setContextMenu({ x: e.clientX, y: e.clientY, type, id });
  };

  const closeMenus = () => {
    setContextMenu(null);
    setColorPickerTarget(null);
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const getTargetName = () => {
    if (!contextMenu) return '';
    if (contextMenu.type === 'session') return sessions[contextMenu.id]?.title;
    return folders[contextMenu.id]?.name;
  };

  useEffect(() => {
    const fn = () => closeMenus();
    window.addEventListener('click', fn);
    return () => window.removeEventListener('click', fn);
  }, []);

  // --- Render Items ---

  // --- DnD Handlers ---
  // --- DnD Handlers ---
  // --- DnD Core Logic (Shared between Mouse and Touch) ---
  const calculateDropPosition = (
    _clientX: number,
    _clientY: number,
    targetType: 'session' | 'folder' | 'root',
    _targetId?: string
  ): { type: 'session' | 'folder', id: string, position: 'before' | 'after' | 'inside' } | null => {
    // 1. Root Check
    if (targetType === 'root') {
      return { type: 'session', id: 'root', position: 'inside' };
    }

    if (!_targetId || !draggedItem) return null;

    // 2. Locate target element
    // For touch, we might need to rely on elementFromPoint if targetId isn't reliable from event bubbling?
    // But here we assume this function is called when we know the target. Usually via event.
    // But for touchMove, we iterate elements. (See touch handler below)

    // RE-THINK: For Mouse, we use event.currentTarget. For touch, we use elementFromPoint.
    // So this helper should take Rect or Element, not just ID.
    return null;
  };

  const processDragOver = (
    clientY: number,
    rect: DOMRect,
    targetType: 'session' | 'folder' | 'root',
    targetId: string,
    currentDraggedItem: { type: 'session' | 'folder', id: string }
  ) => {
    const y = clientY - rect.top;
    const height = rect.height;

    // Validation
    if (currentDraggedItem.type === 'folder' && targetType === 'session') return;

    // Logic
    if (targetType === 'folder' && currentDraggedItem.type === 'session') {
      setDropIndicator({ type: 'folder', id: targetId, position: 'inside' });
      return;
    }

    // Reordering
    if (y < height * 0.4) {
      setDropIndicator({ type: targetType as any, id: targetId, position: 'before' });
    } else if (y > height * 0.6) {
      setDropIndicator({ type: targetType as any, id: targetId, position: 'after' });
    } else {
      if (targetType === 'folder' && currentDraggedItem.type === 'session') {
        setDropIndicator({ type: 'folder', id: targetId, position: 'inside' });
      } else {
        setDropIndicator({ type: targetType as any, id: targetId, position: 'after' });
      }
    }
  };

  // --- Mouse Handlers ---
  const handleDragStart = (e: React.DragEvent, type: 'session' | 'folder', id: string) => {
    setDraggedItem({ type, id });
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent, type: 'session' | 'folder' | 'root', id?: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;

    if (type === 'root') {
      setDropIndicator({ type: 'session', id: 'root', position: 'inside' });
      return;
    }

    if (!id) return;

    const rect = e.currentTarget.getBoundingClientRect();
    processDragOver(e.clientY, rect, type, id, draggedItem);
  };

  // --- Touch Handlers (Mobile Polyfill) ---
  const longPressTimer = useRef<any>(null);
  const touchStartPosition = useRef<{ x: number, y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent, type: 'session' | 'folder', id: string) => {
    const touch = e.touches[0];
    touchStartPosition.current = { x: touch.clientX, y: touch.clientY };

    // Start Timer
    longPressTimer.current = setTimeout(() => {
      // Trigger Drag Mode
      setDraggedItem({ type, id });
      if (navigator.vibrate) navigator.vibrate(50); // Haptic feedback
    }, 500); // 500ms long press
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];

    // If we haven't started dragging yet, check if we moved too much (cancel long press)
    if (!draggedItem) {
      if (touchStartPosition.current) {
        const dx = Math.abs(touch.clientX - touchStartPosition.current.x);
        const dy = Math.abs(touch.clientY - touchStartPosition.current.y);
        if (dx > 10 || dy > 10) {
          clearTimeout(longPressTimer.current);
        }
      }
      return;
    }

    // We ARE dragging. Prevent scrolling.
    if (e.cancelable) e.preventDefault();

    // Find element under finger
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;

    // Check if it's a drop target
    // We need to tag our elements with data attributes to identify them
    const dropTarget = target.closest('[data-drop-type]');
    if (!dropTarget) {
      setDropIndicator(null);
      return;
    }

    const targetType = dropTarget.getAttribute('data-drop-type') as 'session' | 'folder' | 'root';
    const targetId = dropTarget.getAttribute('data-drop-id') || undefined;

    if (targetType === 'root') {
      setDropIndicator({ type: 'session', id: 'root', position: 'inside' });
    } else if (targetId) {
      const rect = dropTarget.getBoundingClientRect();
      processDragOver(touch.clientY, rect, targetType, targetId, draggedItem);
    }
  };

  const handleTouchEnd = (_e: React.TouchEvent) => {
    clearTimeout(longPressTimer.current);
    touchStartPosition.current = null;

    if (draggedItem) {
      // Execute Drop
      // We call handleDrop logic manually essentially
      // We need to mock an event or just call the logic? 
      // Refactor handleDrop to separate logic.
      finalizeDrop();
    }
  };

  const finalizeDrop = () => {
    if (!draggedItem || !dropIndicator) {
      setDraggedItem(null);
      setDropIndicator(null);
      return;
    }

    // ... Logic from handleDrop ...
    // ... Copy paste logic or Refactor? Refactor is cleaner.

    executeDropLogic(draggedItem, dropIndicator);

    setDraggedItem(null);
    setDropIndicator(null);
  };

  const executeDropLogic = (item: { type: string, id: string }, indicator: { type: string, id: string, position: string }) => {
    const { type: dropType, id: dropId, position } = indicator;

    // 1. Move
    if (dropType === 'folder' && position === 'inside' && item.type === 'session') {
      onUpdateSession(item.id, { folderId: dropId });
    } else if (dropType === 'session' && dropId === 'root' && item.type === 'session') {
      onUpdateSession(item.id, { folderId: undefined });
    }
    // 2. Reorder
    else if ((dropType === item.type) && (position === 'before' || position === 'after')) {
      const targetItem = dropType === 'session' ? sessions[dropId] : folders[dropId];
      if (!targetItem) return;

      let newOrder = 0;
      const targetOrder = targetItem.order || 0;
      const delta = 50;
      newOrder = position === 'before' ? targetOrder - delta : targetOrder + delta;

      const updates: any = { order: newOrder };
      if (item.type === 'session' && dropType === 'session') {
        updates.folderId = (targetItem as ChatSession).folderId;
      }

      if (item.type === 'session') onUpdateSession(item.id, updates);
      else onUpdateFolder(item.id, updates);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    finalizeDrop();
  };


  const renderSessionItem = (session: ChatSession) => {
    const isSelected = selectedIds.has(session.id);
    const isActive = currentSessionId === session.id;
    const isDragging = draggedItem?.id === session.id;

    // Drop Indicators
    const showTopLine = dropIndicator?.id === session.id && dropIndicator.position === 'before';
    const showBottomLine = dropIndicator?.id === session.id && dropIndicator.position === 'after';
    // const showInsideConfig = false; // Sessions can't have inside drops

    return (
      <div
        key={session.id}
        draggable
        onDragStart={(e) => handleDragStart(e, 'session', session.id)}
        onDragOver={(e) => handleDragOver(e, 'session', session.id)}
        onDrop={handleDrop}
        onTouchStart={(e) => handleTouchStart(e, 'session', session.id)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        data-drop-type="session"
        data-drop-id={session.id}
        className={`
              group relative flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all select-none
              ${isDragging ? 'opacity-50 scale-95 ring-2 ring-accent-primary z-50' : 'hover:scale-[1.02]'}
              ${isActive && !isMultiSelectMode ? 'bg-black/5 dark:bg-white/10 text-text-primary shadow-sm' : ''}
              ${isSelected && isMultiSelectMode ? 'bg-accent-primary/20' : ''}
              ${!isActive && !isSelected ? 'text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary' : ''}
              
              /* Drop Indicators */
              ${showTopLine ? 'border-t-2 border-accent-primary' : ''}
              ${showBottomLine ? 'border-b-2 border-accent-primary' : ''}
           `}
        onClick={(e) => {
          if (isMultiSelectMode) {
            e.stopPropagation();
            toggleSelection(session.id);
          } else {
            if (!isDragging) onSelectSession(session.id); // Prevent selection if dragging ended
          }
        }}
        onContextMenu={(e) => handleContextMenu(e, 'session', session.id)}
      >
        {/* Color Indicator */}
        {session.customColor && (
          <div className="w-1.5 h-10 absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full bg-current shadow-[0_0_10px_currentColor] opacity-80" style={{ color: session.customColor }} />
        )}

        {isMultiSelectMode && (
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-accent-primary border-accent-primary text-white' : 'border-text-secondary/40'}`}>
            {isSelected && <CheckSquare size={12} strokeWidth={3} />}
          </div>
        )}

        <div className="flex-1 min-w-0 flex items-center">
          {renamingId === session.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  onUpdateSession(session.id, { title: renameValue });
                  setRenamingId(null);
                }
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onBlur={() => setRenamingId(null)} // Cancel on blur
              onClick={e => e.stopPropagation()}
              className="w-full bg-transparent border-b-2 border-accent-primary px-0 py-0.5 text-sm font-medium text-text-primary focus:outline-none"
            />
          ) : (
            <div className="truncate text-sm font-medium leading-tight" style={{ color: session.customColor }}>{session.title || 'Untitled Chat'}</div>
          )}
        </div>

        {/* Streaming indicator */}
        {streamingSessionIds.has(session.id) && (
          <Loader2 size={14} className="animate-spin text-accent-primary shrink-0" />
        )}

        {/* Hover Grip/Menu Hint - Clickable for Mobile/Desktop */}
        <button
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 -mr-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary/50 hover:text-text-primary"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleContextMenu(e, 'session', session.id);
          }}
          title="Options"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    )
  };

  return (
    <div className="w-full h-full bg-surface border-r border-border flex flex-col shrink-0 relative transition-colors duration-300 select-none">

      {/* Header Area */}
      <div className="p-4 z-10 flex flex-col gap-3 border-b border-border/40 shrink-0">
        <div className="flex gap-2">
          <button
            onClick={onCreateSession}
            className="flex-1 flex items-center justify-center gap-2 bg-text-primary text-background hover:scale-[1.02] active:scale-95 py-3 px-4 rounded-xl transition-all text-sm font-bold shadow-lg hover:shadow-xl"
          >
            <Plus size={18} strokeWidth={2.5} />
            <span>New Chat</span>
          </button>
          <button
            onClick={() => onCreateFolder('New Folder')}
            className="p-3 rounded-xl border border-border bg-surface hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-all active:scale-95 hover:border-text-secondary/30"
            title="Create Folder"
          >
            <FolderPlus size={20} />
          </button>
        </div>
      </div>

      {/* Multi-Select Bar */}
      {isMultiSelectMode && (
        <div className="px-3 py-2 bg-accent-primary/10 border-b border-accent-primary/20 flex items-center justify-between animate-in slide-in-from-top-2">
          <span className="text-xs font-medium text-accent-primary">{selectedIds.size} selected</span>
          <div className="flex gap-1">
            <button
              onClick={() => {
                if (confirm(`Delete ${selectedIds.size} items?`)) {
                  selectedIds.forEach(id => {
                    if (sessions[id]) onDeleteSession(id);
                    // Logic for folders removal could be here
                  });
                  setSelectedIds(new Set());
                  setIsMultiSelectMode(false);
                }
              }}
              className="p-1.5 rounded hover:bg-red-500/10 text-red-500"
            >
              <Trash2 size={14} />
            </button>
            <button onClick={() => { setIsMultiSelectMode(false); setSelectedIds(new Set()); }} className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-text-secondary">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Content List */}
      {/* Content List */}
      <div className="flex-1 overflow-y-auto w-full custom-scrollbar p-3 space-y-2 flex flex-col">
        {/* Folders */}
        {sortedFolders.length > 0 && (
          <div className="px-3 py-2 text-xs font-bold text-text-secondary uppercase tracking-wider opacity-60">
            Folders
          </div>
        )}
        {sortedFolders.map(folder => {
          const sessionsInThisFolder = sessionsInFolders.filter(s => s.folderId === folder.id);
          const isDragOver = dropIndicator?.id === folder.id && dropIndicator?.position === 'inside';
          const showTopLine = dropIndicator?.id === folder.id && dropIndicator?.position === 'before';
          const showBottomLine = dropIndicator?.id === folder.id && dropIndicator?.position === 'after';

          if (!sessionsInThisFolder.length && isMultiSelectMode && !selectedIds.has(folder.id)) {
            // return null; // Keep empty folders visible
          }

          return (
            <div
              key={folder.id}
              draggable // Allow folder reordering
              onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
              onTouchStart={(e) => handleTouchStart(e, 'folder', folder.id)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              data-drop-type="folder"
              data-drop-id={folder.id}
              className={`
                        space-y-1 transition-all duration-300 rounded-2xl border border-transparent
                        ${isDragOver ? 'bg-accent-primary/10 border-accent-primary/50 shadow-sm scale-[1.01]' : 'hover:bg-black/5 dark:hover:bg-white/5'}
                        ${showTopLine ? 'border-t-2 border-accent-primary' : ''}
                        ${showBottomLine ? 'border-b-2 border-accent-primary' : ''}
                    `}
              onDragOver={(e) => handleDragOver(e, 'folder', folder.id)}
              onDrop={handleDrop}
            >
              <div
                className="flex items-center gap-3 px-3 py-2 text-xs font-bold text-text-secondary uppercase tracking-wider rounded-xl cursor-pointer group select-none transition-colors"
                onClick={() => onUpdateFolder(folder.id, { isCollapsed: !folder.isCollapsed })}
                onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id)}
              >
                <span className={`transition-transform duration-300 text-accent-primary ${folder.isCollapsed ? '-rotate-90' : 'rotate-0'}`}><ChevronDown size={14} strokeWidth={3} /></span>
                {renamingId === folder.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        onUpdateFolder(folder.id, { name: renameValue });
                        setRenamingId(null);
                      }
                    }}
                    onClick={e => e.stopPropagation()}
                    className="bg-transparent border-b-2 border-accent-primary focus:outline-none w-full text-xs font-bold uppercase tracking-wider text-text-primary py-0.5"
                  />
                ) : (
                  <span style={{ color: folder.color }} className="truncate flex-1 font-bold">{folder.name}</span>
                )}
                {isDragOver ? (
                  <span className="text-[10px] text-accent-primary font-bold animate-pulse">Drop here</span>
                ) : (
                  <span className="text-[10px] bg-black/5 dark:bg-white/10 px-2 py-0.5 rounded-full opacity-60 group-hover:opacity-100 transition-opacity font-mono">{sessionsInThisFolder.length}</span>
                )}

                {/* Folder Menu Trigger */}
                <button
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 -mr-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary/50 hover:text-text-primary ml-1"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleContextMenu(e, 'folder', folder.id);
                  }}
                  title="Folder Options"
                >
                  <MoreHorizontal size={14} strokeWidth={2} />
                </button>
              </div>

              <div className={`
                        pl-2 ml-2 border-l-2 border-border/40 space-y-1 overflow-hidden transition-all duration-500 ease-in-out
                        ${folder.isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[1000px] opacity-100 pb-2'}
                    `}>
                {sessionsInThisFolder.map(renderSessionItem)}
                {sessionsInThisFolder.length === 0 && !folder.isCollapsed && (
                  <div className="text-[11px] text-text-secondary opacity-40 px-3 py-2 italic flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-current" /> Empty Folder
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Unorganised */}
        {/* Unorganised / Root Drop Zone */}
        <div
          className={`
                flex-1 rounded-2xl transition-all duration-300 p-2 -m-2 min-h-[150px] flex flex-col
                ${dropIndicator?.id === 'root' ? 'bg-accent-primary/5 ring-2 ring-accent-primary ring-inset ring-opacity-50' : ''}
            `}
          onDragOver={(e) => handleDragOver(e, 'root')}
          onDrop={handleDrop}
          data-drop-type="root"
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {sortedFolders.length > 0 && (
            <div className="px-3 py-2 text-xs font-bold text-text-secondary uppercase tracking-wider opacity-60 flex items-center gap-2">
              <span>Unsorted</span>
              {dropIndicator?.id === 'root' && <span className="text-accent-primary animate-pulse ml-auto text-[10px]">Drop to move here</span>}
            </div>
          )}

          {unorganisedSessions.length === 0 && sortedFolders.length === 0 && (
            <div className="flex flex-col items-center justify-center pt-20 text-text-secondary opacity-40 gap-3 pointer-events-none">
              <MessageSquare size={32} strokeWidth={1.5} />
              <span className="text-sm">No chats yet</span>
            </div>
          )}

          <div className="space-y-1">
            {unorganisedSessions.map(renderSessionItem)}
          </div>

          {/* Empty space filler for easier dropping */}
          <div className="flex-1 min-h-[50px] w-full" />
        </div>

      </div>

      {/* Settings Footer */}
      <div className="p-3 border-t border-border mt-auto z-10 flex gap-2">
        <button
          onClick={(e) => onOpenSettings(e.currentTarget.getBoundingClientRect())}
          className="flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-all border border-transparent hover:border-border"
        >
          <Settings size={16} />
          <span>Settings</span>
        </button>
        <button
          onClick={onOpenImport}
          className="p-2.5 rounded-xl border border-border bg-surface hover:bg-black/5 dark:hover:bg-white/5 text-accent-primary transition-all active:scale-95 hover:border-accent-primary/30"
          title="Import Chat"
        >
          <Import size={18} />
        </button>
      </div>


      {/* --- Floating Elements --- */}

      {/* Context Menu (Portal) */}
      {contextMenu && createPortal(
        <div
          className="fixed z-[9999] bg-surface border border-border rounded-xl shadow-xl w-40 overflow-hidden animate-in fade-in zoom-in-95 duration-100 py-1"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => {
            setIsMultiSelectMode(true);
            toggleSelection(contextMenu.id);
            closeMenus();
          }} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary text-left">
            <CheckSquare size={12} /> Select...
          </button>

          <button onClick={() => {
            setRenamingId(contextMenu.id);
            setRenameValue(getTargetName());
            closeMenus();

          }} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-left">
            <Edit2 size={12} /> Rename
          </button>

          <button onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setColorPickerTarget({ ...contextMenu, rect });
            setContextMenu(null);
          }} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-left">
            <Palette size={12} /> Color
          </button>

          {contextMenu.type === 'session' && (
            <>
              <div className="h-px bg-border/50 my-1" />
              <div className="px-2 py-1 text-[10px] text-text-secondary font-medium">Move to...</div>
              {sortedFolders.map(f => (
                <button
                  key={f.id}
                  onClick={() => {
                    onUpdateSession(contextMenu.id, { folderId: f.id });
                    closeMenus();
                  }}
                  className="w-full flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-left truncate"
                >
                  <Folder size={12} /> {f.name}
                </button>
              ))}
              <button
                onClick={() => {
                  onUpdateSession(contextMenu.id, { folderId: undefined });
                  closeMenus();
                }}
                className="w-full flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary text-left italic"
              >
                Remove from folder
              </button>
            </>
          )}

          <div className="h-px bg-border/50 my-1" />

          <button
            onClick={() => {
              if (contextMenu.type === 'session') {
                onDeleteSession(contextMenu.id);
              } else {
                // For folders, show confirmation dialog
                const chatCount = Object.values(sessions).filter(s => s.folderId === contextMenu.id).length;
                setFolderDeleteConfirm({
                  id: contextMenu.id,
                  name: folders[contextMenu.id]?.name || 'Folder',
                  chatCount
                });
              }
              closeMenus();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-red-500/10 text-red-500 text-left"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>,
        document.body
      )}

      {/* Folder Delete Confirmation (Portal) */}
      {folderDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="bg-surface border border-border rounded-2xl shadow-2xl w-[340px] p-5 space-y-4 animate-in zoom-in-95 fade-in duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">Delete folder?</h3>
                <p className="text-xs text-text-secondary mt-0.5">This cannot be undone.</p>
              </div>
            </div>

            {folderDeleteConfirm.chatCount > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl px-3 py-2.5">
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                  ⚠️ {folderDeleteConfirm.chatCount} chat{folderDeleteConfirm.chatCount > 1 ? 's' : ''} inside "{folderDeleteConfirm.name}" will also be permanently deleted.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setFolderDeleteConfirm(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium border border-border text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDeleteFolder(folderDeleteConfirm.id);
                  setFolderDeleteConfirm(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-sm"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Color Picker Popover (Portal) */}
      {colorPickerTarget && createPortal(
        <div
          className="fixed z-[9999]"
          style={{ top: colorPickerTarget.rect.top, left: colorPickerTarget.rect.right + 10 }}
          onClick={e => e.stopPropagation()}
        >
          <ColorPicker
            color={
              (colorPickerTarget.type === 'session' ? sessions[colorPickerTarget.id]?.customColor : folders[colorPickerTarget.id]?.color) || '#ffffff'
            }
            onChange={(color) => {
              if (colorPickerTarget.type === 'session') onUpdateSession(colorPickerTarget.id, { customColor: color });
              else onUpdateFolder(colorPickerTarget.id, { color });
            }}
          />
          <div
            className="fixed inset-0 z-[-1]"
            onClick={() => setColorPickerTarget(null)}
          />
        </div>,
        document.body
      )}

    </div>
  );
};

export default React.memo(Sidebar, areSidebarPropsEqual);