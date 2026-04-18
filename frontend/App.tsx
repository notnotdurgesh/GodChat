import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ChatSession, MessageNode, Role, ChatState, SessionFolder, GraphNote } from './types';
import { INITIAL_GREETING } from './constants';
import Sidebar from './components/Sidebar';
import ChatMessage from './components/ChatMessage';
import AuthScreen from './components/AuthScreen';
import ChatInput from './components/ChatInput';

const GraphView = lazy(() => import('./components/GraphView'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const ImportModal = lazy(() => import('./components/ImportModal'));
import ExportModal from './components/ExportModal';
import { PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeft, Sun, Moon, Loader2, Quote, X, ArrowDown, GitFork, MessageSquarePlus, FastForward, CornerDownRight, Square, Plus, Sparkles, BrainCircuit, Download } from 'lucide-react';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { SnackbarProvider, useSnackbar } from './contexts/SnackbarContext';
import { ImportedChat, convertToSession } from './services/importService';
import { AUTH_REQUIRED_EVENT, AuthenticatedUser, BackendConfig, changePassword, createChatMessage, exportAccountData, getBackendConfig, getChatState, getCurrentUser, loginUser, logoutUser, openChatStream, saveChatState, signupUser, stopChatStream, updateProfile, createClarification } from './services/backendService';
import WelcomeDashboard from './components/WelcomeDashboard';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation, matchPath } from 'react-router-dom';

const EMPTY_STATE: ChatState = { sessions: {}, folders: {}, currentSessionId: null };

interface ChatAppProps {
  currentUser: AuthenticatedUser;
  onLogout: () => Promise<void> | void;
  onUserChange: (user: AuthenticatedUser) => void;
}

const ChatApp: React.FC<ChatAppProps> = ({ currentUser, onLogout, onUserChange }) => {
  const [state, setState] = useState<ChatState>(EMPTY_STATE);
  const [isStateReady, setIsStateReady] = useState(false);
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null);
  const [selectedContext, setSelectedContext] = useState<{ content: string, sourceId: string } | null>(null);

  const [activeStreams, setActiveStreams] = useState<Set<string>>(new Set());
  const showSnackbarRef = useRef<any>(null);

  const [showGraph, setShowGraph] = useState(() => window.innerWidth >= 1024); // Default to on only for desktop
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024); // Default to on only for desktop
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [graphFocusTrigger, setGraphFocusTrigger] = useState(0);

  // Suggestions Context Menu State
  const [activeSuggestion, setActiveSuggestion] = useState<{ text: string, nodeId: string } | null>(null);
  const [suggestionMenuPosition, setSuggestionMenuPosition] = useState<{ top: number, left: number } | null>(null);

  // Edit State
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const streamIdsRef = useRef<Map<string, string>>(new Map());
  const streamSourcesRef = useRef<Map<string, EventSource>>(new Map());

  // --- Router Hooks ---
  const navigate = useNavigate();
  const location = useLocation();
  const [isSessionNotFound, setIsSessionNotFound] = useState(false);

  const refreshBackendStatus = useCallback(async () => {
    try {
      const config = await getBackendConfig();
      setBackendConfig(config);
      return config;
    } catch (error) {
      console.error('Failed to load backend status', error);
      showSnackbarRef.current?.('Backend status check failed', 'error', undefined, 2000);
      throw error;
    }
  }, []);

  // --- Url Sync Effect ---
  useEffect(() => {
    if (!isStateReady) {
      return;
    }

    const match = matchPath('/chat/:sessionId', location.pathname);
    const urlSessionId = match?.params.sessionId;

    if (urlSessionId) {
      if (state.sessions[urlSessionId]) {
        if (state.currentSessionId !== urlSessionId) {
          setState(prev => ({ ...prev, currentSessionId: urlSessionId }));
          setIsSessionNotFound(false);
        }
      } else {
        setIsSessionNotFound(true);
      }
    } else {
      setIsSessionNotFound(false);
      if (state.currentSessionId) {
        setState(prev => ({ ...prev, currentSessionId: null }));
      }
    }
  }, [isStateReady, location.pathname, state.sessions, state.currentSessionId]);

  // Helper to get thread path early for hooks
  const getThreadPath = useCallback((session: ChatSession | null): MessageNode[] => {
    if (!session) return [];
    const path: MessageNode[] = [];
    let current: string | null = session.lastActiveNodeId;
    while (current) {
      const node: MessageNode = session.nodes[current];
      if (node) {
        path.unshift(node);
        current = node.parentId;
      } else {
        break;
      }
    }
    return path;
  }, []);

  const currentSession = state.currentSessionId ? state.sessions[state.currentSessionId] : null;
  const threadPath = getThreadPath(currentSession);

  // Compute thread tokens
  const threadTokenUsage = React.useMemo(() => {
    let promptTokens = 0;
    let candidatesTokens = 0;
    let totalTokens = 0;
    for (const node of threadPath) {
      if (node.tokenUsage) {
        promptTokens += node.tokenUsage.promptTokens || 0;
        candidatesTokens += node.tokenUsage.candidatesTokens || 0;
        totalTokens += node.tokenUsage.totalTokens || 0;
      }
    }
    return { promptTokens, candidatesTokens, totalTokens };
  }, [threadPath]);

  // Check if any node in the current path is streaming
  const isCurrentPathStreaming = threadPath.some((node: MessageNode) => activeStreams.has(node.id));

  // Compute which sessions are actively streaming (for sidebar indicator)
  const streamingSessionIds = React.useMemo(() => {
    if (activeStreams.size === 0) return new Set<string>();
    const ids = new Set<string>();
    for (const [sessionId, session] of Object.entries(state.sessions)) {
      for (const nodeId of activeStreams) {
        if (session.nodes[nodeId]) {
          ids.add(sessionId);
          break;
        }
      }
    }
    return ids;
  }, [activeStreams, state.sessions]);

  const stopStreamsForNodeIds = useCallback(async (nodeIds: string[]) => {
    const streamIds = nodeIds
      .map((nodeId) => ({ nodeId, streamId: streamIdsRef.current.get(nodeId) }))
      .filter((entry): entry is { nodeId: string; streamId: string } => Boolean(entry.streamId));

    await Promise.all(streamIds.map(async ({ nodeId, streamId }) => {
      try {
        await stopChatStream(streamId);
      } catch (error) {
        console.error('Failed to stop stream', error);
      }

      streamSourcesRef.current.get(streamId)?.close();
      streamSourcesRef.current.delete(streamId);
      streamIdsRef.current.delete(nodeId);
    }));

    if (streamIds.length > 0) {
      setActiveStreams(prev => {
        const next = new Set(prev);
        streamIds.forEach(({ nodeId }) => next.delete(nodeId));
        return next;
      });
    }
  }, []);

  const handleStop = useCallback(() => {
    const currentState = stateRef.current;
    const session = currentState.currentSessionId ? currentState.sessions[currentState.currentSessionId] : null;
    if (!session) return;

    let nodeId: string | null = session.lastActiveNodeId;
    while (nodeId) {
      if (streamIdsRef.current.has(nodeId)) {
        const stoppedNodeId = nodeId;
        void stopStreamsForNodeIds([stoppedNodeId]).then(() => {
          // Also immediately flip isStreaming=false on the node since SSE source is now closed
          // and the server's 'stopped' event will never arrive at our closed EventSource
          setState(prev => {
            const sess = prev.currentSessionId ? prev.sessions[prev.currentSessionId] : null;
            if (!sess) return prev;
            const node = sess.nodes[stoppedNodeId];
            if (!node || !node.isStreaming) return prev;
            const suffix = '\n\n**[Stopped by User]**';
            return {
              ...prev,
              sessions: {
                ...prev.sessions,
                [sess.id]: {
                  ...sess,
                  updatedAt: Date.now(),
                  nodes: {
                    ...sess.nodes,
                    [stoppedNodeId]: {
                      ...node,
                      isStreaming: false,
                      content: node.content.endsWith(suffix) ? node.content : `${node.content}${suffix}`,
                    },
                  },
                },
              },
            };
          });
        });
        showSnackbarRef.current('Generation stopped', 'info', undefined, 1500);
        return;
      }
      nodeId = session.nodes[nodeId]?.parentId || null;
    }
  }, [stopStreamsForNodeIds]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const [config, nextState] = await Promise.all([refreshBackendStatus(), getChatState()]);
        if (cancelled) return;

        setState(nextState);

        const loadedStreams = new Set<string>();
        Object.values(nextState.sessions).forEach((session) => {
          Object.values(session.nodes).forEach((node) => {
            if (node.isStreaming) {
              loadedStreams.add(node.id);
            }
          });
        });
        setActiveStreams(loadedStreams);

        if (!config.chatConfigured) {
          setIsSettingsOpen(true);
        }
      } catch (error) {
        console.error('Failed to hydrate backend state', error);
      } finally {
        if (!cancelled) {
          setIsStateReady(true);
        }
      }
    };

    void hydrate();

    const sources = streamSourcesRef.current;
    return () => {
      cancelled = true;
      sources.forEach((source) => source.close());
      sources.clear();
    };
  }, [refreshBackendStatus]);

  // Close suggestion menu on global click
  useEffect(() => {
    const handleClick = () => {
      if (activeSuggestion) {
        setActiveSuggestion(null);
        setSuggestionMenuPosition(null);
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [activeSuggestion]);

  // Helper function to get default graph width based on screen size
  const getDefaultGraphWidth = useCallback(() => {
    if (typeof window === 'undefined') return 800;
    // Medium screens (768px - 1279px): 450px
    // Large/Desktop screens (1280px+): 800px
    return window.innerWidth >= 1280 ? 800 : 450;
  }, []);

  // Resizing State
  const [graphWidth, setGraphWidth] = useState(getDefaultGraphWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [isGraphFullscreen, setIsGraphFullscreen] = useState(false);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);
  const resize = useCallback((mouseEvent: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - mouseEvent.clientX;
      // Dynamic reservation: Sidebar (260) + Min Chat Width (400)
      const sidebarWidth = isSidebarOpen ? 260 : 0;
      const minChatWidth = 400;
      const maxGraphWidth = window.innerWidth - (sidebarWidth + minChatWidth);

      // Enforce Min Graph Width of 400px (allows for horizontal toolbar mode)
      if (newWidth > 420 && newWidth < maxGraphWidth) {
        setGraphWidth(newWidth);
      }
    }
  }, [isResizing, isSidebarOpen]);

  // Update graph width on window resize (responsive)
  useEffect(() => {
    const handleResize = () => {
      if (!isResizing) {
        const defaultWidth = getDefaultGraphWidth();
        // Only update if current width is at default or if screen size changed significantly
        if (Math.abs(graphWidth - defaultWidth) < 50) {
          setGraphWidth(defaultWidth);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isResizing, graphWidth, getDefaultGraphWidth]);

  // Adjust graph width when opening sidebar to prevent chat compression
  useEffect(() => {
    if (isSidebarOpen) {
      setGraphWidth(prev => {
        const safeMax = window.innerWidth - 800;
        return prev > safeMax ? Math.max(100, safeMax) : prev;
      });
    }
  }, [isSidebarOpen]);

  useEffect(() => {
    if (isResizing) {
      // Global cursor override for smooth dragging even if mouse slips
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    }
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  // Theme State via Context
  const { theme, toggleTheme } = useTheme();
  const { showSnackbar } = useSnackbar();
  showSnackbarRef.current = showSnackbar;

  const handleProfileUpdate = useCallback(async (payload: { username: string }) => {
    const updatedUser = await updateProfile(payload);
    const mergedUser = { ...currentUser, ...updatedUser };
    onUserChange(mergedUser);
    showSnackbar('Username updated', 'success');
  }, [currentUser, onUserChange, showSnackbar]);

  const handlePasswordChange = useCallback(async (payload: { currentPassword: string; newPassword: string }) => {
    const updatedUser = await changePassword(payload);
    onUserChange(updatedUser);
    showSnackbar('Password updated', 'success');
  }, [onUserChange, showSnackbar]);

  const handleExportAccount = useCallback(async () => {
    const exportData = await exportAccountData();
    const safeUsername = currentUser.username.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const fileName = `${safeUsername || 'account'}-workspace-export.json`;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    showSnackbar('Account export downloaded', 'success');
  }, [currentUser.username, showSnackbar]);
  // --- Mobile Swipe Gestures ---
  const touchStartRef = useRef<{ x: number, y: number } | null>(null);

  const handleGlobalTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleGlobalTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    // Only apply on mobile/tablet (check screen width)
    if (window.innerWidth >= 1024) return;

    const startX = touchStartRef.current.x;
    const startY = touchStartRef.current.y;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;

    const deltaX = endX - startX;
    const deltaY = endY - startY;

    // Ignore if vertical scroll is dominant
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;

    // Threshold
    if (Math.abs(deltaX) < 50) return;

    // Logic
    if (deltaX > 0) {
      // Swipe Right (->)
      if (isSidebarOpen) {
        // Already open, do nothing
      } else {
        // Sidebar Closed
        // If swipe started from left edge (< 60px), Open Sidebar
        // CRITICAL: Removed logic to close GraphView on swipe. Graph close must be explicit via button.
        if (!showGraph && startX < 60) {
          setIsSidebarOpen(true);
        }
      }
    } else {
      // Swipe Left (<-)
      if (isSidebarOpen) {
        // Close Sidebar
        setIsSidebarOpen(false);
      } else {
        // Sidebar Closed
        // If swipe started from right edge (> window - 60), Open Graph
        if (!showGraph && startX > window.innerWidth - 60) {
          setShowGraph(true);
        }
      }
    }

    touchStartRef.current = null;
  };

  const stateRef = useRef(state);
  const syncTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!isStateReady || activeStreams.size > 0) {
      return;
    }

    if (syncTimeoutRef.current) {
      window.clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = window.setTimeout(() => {
      void saveChatState(state).catch((error) => {
        console.error('Failed to persist chat state', error);
      });
    }, 300);

    return () => {
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    };
  }, [state, isStateReady, activeStreams]);

  // --- Scroll Handling ---
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkScrollPosition = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
      shouldAutoScrollRef.current = isNearBottom;
      setIsAtBottom(isNearBottom);
    }
  }, []);

  const scrollToBottom = useCallback((force = false, behavior: ScrollBehavior = 'smooth') => {
    if (scrollContainerRef.current) {
      // If sticky mode is on OR we are forcing it
      if (shouldAutoScrollRef.current || force) {
        const { scrollHeight, clientHeight } = scrollContainerRef.current;
        const maxScroll = scrollHeight - clientHeight;

        // Only scroll if there is room to scroll
        if (maxScroll > 0) {
          scrollContainerRef.current.scrollTo({
            top: maxScroll,
            behavior: behavior
          });
        }
      }
    }
  }, []);



  // --- Cinematic Auto-Scroll Loop ---
  useEffect(() => {
    let rafId: number;

    const smoothScrollLoop = () => {
      if (isCurrentPathStreaming && scrollContainerRef.current && shouldAutoScrollRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        const targetScroll = scrollHeight - clientHeight;

        // Calculate distance
        const dist = targetScroll - scrollTop;

        // If distance is significant, lerp towards it
        if (Math.abs(dist) > 1) {
          const easeFactor = 0.2; // 20% closer per frame = smooth ease-out
          scrollContainerRef.current.scrollTop = scrollTop + dist * easeFactor;
        } else {
          // Snap if very close to avoid micro-jitters
          scrollContainerRef.current.scrollTop = targetScroll;
        }

        rafId = requestAnimationFrame(smoothScrollLoop);
      } else if (isCurrentPathStreaming) {
        // Keep loop running to catch re-enabled auto-scroll
        rafId = requestAnimationFrame(smoothScrollLoop);
      }
    };

    if (isCurrentPathStreaming) {
      rafId = requestAnimationFrame(smoothScrollLoop);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isCurrentPathStreaming]);

  // --- Session Management ---
  const createSession = useCallback(() => {
    // Check if there's already an empty "New Chat" we can navigate to
    const existingEmpty = Object.values(state.sessions).find(s => {
      if (s.title !== 'New Chat') return false;
      // A session is "empty" if it only has the root node (the greeting)
      const nodeKeys = Object.keys(s.nodes);
      return nodeKeys.length === 1;
    });

    if (existingEmpty) {
      // Just navigate to the existing empty chat instead of creating a new one
      setState(prev => ({ ...prev, currentSessionId: existingEmpty.id }));
      navigate(`/chat/${existingEmpty.id}`);
      showSnackbar('Switched to existing empty chat', 'info');
      return;
    }

    const rootId = uuidv4();
    const sessionId = uuidv4();

    const rootNode: MessageNode = {
      id: rootId,
      parentId: null,
      childrenIds: [],
      role: Role.MODEL,
      content: INITIAL_GREETING,
      timestamp: Date.now()
    };

    setState(prev => {
      const minOrder = Object.values(prev.sessions).reduce((min, s) => Math.min(min, s.order || 0), 0);

      const newSession: ChatSession = {
        id: sessionId,
        title: 'New Chat',
        rootNodeId: rootId,
        nodes: { [rootId]: rootNode },
        notes: {
          'infinite-tl': {
            id: 'infinite-tl',
            x: -500000,
            y: -500000,
            content: '.',
            resizeMode: 'AUTO',
            style: { fontSize: 'S', color: 'transparent' }, // Hidden but present
            createdAt: Date.now()
          },
          'infinite-br': {
            id: 'infinite-br',
            x: 500000,
            y: 500000,
            content: '.',
            resizeMode: 'AUTO',
            style: { fontSize: 'S', color: 'transparent' }, // Hidden
            createdAt: Date.now()
          }
        }, // Initialize with infinite anchors
        lastActiveNodeId: rootId,
        updatedAt: Date.now(),
        order: minOrder - 1000
      };

      return {
        sessions: { ...prev.sessions, [sessionId]: newSession },
        folders: prev.folders,
        currentSessionId: sessionId
      };
    });

    // Navigate to new session
    navigate(`/chat/${sessionId}`);
    showSnackbar('New chat created', 'success');
  }, [navigate, showSnackbar, state.sessions]);

  const handleStartNewChat = async (query: string, attachments?: any[]) => {
    const rootId = uuidv4();
    const sessionId = uuidv4();

    const rootNode: MessageNode = {
      id: rootId,
      parentId: null,
      childrenIds: [],
      role: Role.MODEL,
      content: INITIAL_GREETING,
      timestamp: Date.now()
    };

    const minOrder = Object.values(stateRef.current.sessions).reduce((min, s) => Math.min(min, s.order || 0), 0);

    const newSession: ChatSession = {
      id: sessionId,
      title: query.length > 30 ? query.slice(0, 30) + '...' : query,
      rootNodeId: rootId,
      nodes: { [rootId]: rootNode },
      notes: {
        'infinite-tl': { id: 'infinite-tl', x: -500000, y: -500000, content: '.', resizeMode: 'AUTO', style: { fontSize: 'S', color: 'transparent' }, createdAt: Date.now() },
        'infinite-br': { id: 'infinite-br', x: 500000, y: 500000, content: '.', resizeMode: 'AUTO', style: { fontSize: 'S', color: 'transparent' }, createdAt: Date.now() }
      },
      lastActiveNodeId: rootId,
      updatedAt: Date.now(),
      order: minOrder - 1000
    };

    const newFullState: ChatState = {
      ...stateRef.current,
      sessions: { ...stateRef.current.sessions, [sessionId]: newSession },
      currentSessionId: sessionId
    };

    // Sync session to backend FIRST so createChatMessage can find it
    try {
      await saveChatState(newFullState);
    } catch (e) {
      console.error('Failed to pre-save new session', e);
    }

    setState(newFullState);
    navigate(`/chat/${sessionId}`);
    
    // Now safe to send message — backend has the session
    await generateFromNode(rootId, query, sessionId, isThinkingEnabled, attachments);
  };

  
  const handleImportChat = useCallback((imported: ImportedChat) => {
    const { session } = convertToSession(imported);
    
    setState(prev => {
      const minOrder = Object.values(prev.sessions).reduce((min, s) => Math.min(min, s.order || 0), 0);
      const newSession = { ...session, order: minOrder - 1000 };
      
      return {
        ...prev,
        sessions: { ...prev.sessions, [session.id]: newSession },
        currentSessionId: session.id
      };
    });

    navigate(`/chat/${session.id}`);
    showSnackbar(`Imported "${imported.title}"`, 'success');
  }, [navigate, showSnackbar]);

  const deleteSession = useCallback((id: string) => {
    const session = stateRef.current.sessions[id];
    if (session) {
      void stopStreamsForNodeIds(Object.keys(session.nodes));
    }

    const sessionTitle = stateRef.current.sessions[id]?.title || 'Chat';
    const wasCurrent = stateRef.current.currentSessionId === id;

    setState(prev => {
      const remainingSessions = { ...prev.sessions };
      delete remainingSessions[id];

      return { 
        ...prev, 
        sessions: remainingSessions, 
        currentSessionId: wasCurrent ? null : prev.currentSessionId 
      };
    });

    if (wasCurrent) {
      setIsSessionNotFound(false);
      navigate('/');
    }
    showSnackbar(`Deleted "${sessionTitle.length > 25 ? sessionTitle.slice(0, 25) + '…' : sessionTitle}"`, 'info');
  }, [navigate, showSnackbar, stopStreamsForNodeIds]);

  const selectSession = useCallback((id: string) => {
    // setState(prev => ({ ...prev, currentSessionId: id })); // Legacy
    navigate(`/chat/${id}`);
  }, [navigate]);

  // Only auto-create on very first app load (no sessions at all + no URL)
  const hasAutoCreatedRef = useRef(false);
  useEffect(() => {
    if (
      isStateReady &&
      !hasAutoCreatedRef.current &&
      !state.currentSessionId &&
      Object.keys(state.sessions).length === 0 &&
      (location.pathname === '/' || location.pathname === '')
    ) {
      hasAutoCreatedRef.current = true;
      createSession();
    }
  }, [isStateReady, state.currentSessionId, state.sessions, createSession, location.pathname]);

  // --- Core Chat Logic ---
  const finalizeStreamTracking = useCallback((streamId: string, modelMsgId: string) => {
    streamSourcesRef.current.get(streamId)?.close();
    streamSourcesRef.current.delete(streamId);
    streamIdsRef.current.delete(modelMsgId);
    setActiveStreams(prev => {
      const next = new Set(prev);
      next.delete(modelMsgId);
      return next;
    });
  }, []);

  const generateFromNode = async (parentId: string, inputContent: string, existingSessionId: string, useThinking: boolean, attachments?: any[]) => {
    shouldAutoScrollRef.current = true;
    scrollToBottom(true);

    try {
      const result = await createChatMessage({
        sessionId: existingSessionId,
        parentId,
        content: inputContent,
        useThinking,
        attachments,
      });

      setState(result.state);
      setActiveStreams(prev => new Set(prev).add(result.modelMessageId));
      streamIdsRef.current.set(result.modelMessageId, result.streamId);

      const source = openChatStream(result.streamId, {
        onTextDelta: ({ modelMessageId, text }) => {
          setState(prev => {
            const session = prev.sessions[existingSessionId];
            const node = session?.nodes?.[modelMessageId];
            if (!session || !node) return prev;

            return {
              ...prev,
              sessions: {
                ...prev.sessions,
                [existingSessionId]: {
                  ...session,
                  updatedAt: Date.now(),
                  nodes: {
                    ...session.nodes,
                    [modelMessageId]: { ...node, content: `${node.content}${text}` },
                  },
                },
              },
            };
          });
        },
        onThoughtDelta: ({ modelMessageId, thought }) => {
          setState(prev => {
            const session = prev.sessions[existingSessionId];
            const node = session?.nodes?.[modelMessageId];
            if (!session || !node) return prev;

            return {
              ...prev,
              sessions: {
                ...prev.sessions,
                [existingSessionId]: {
                  ...session,
                  updatedAt: Date.now(),
                  nodes: {
                    ...session.nodes,
                    [modelMessageId]: { ...node, thought: `${node.thought || ''}${thought}` },
                  },
                },
              },
            };
          });
        },
        onBranchLabel: ({ userMessageId, label }) => {
          console.log(`[DEBUG] Frontend received onBranchLabel SSE for userMessageId: ${userMessageId}, label: "${label}"`);
          setState(prev => {
            const session = prev.sessions[existingSessionId];
            const node = session?.nodes?.[userMessageId];
            if (!session || !node) {
              console.warn(`[DEBUG] Frontend failed to find node ${userMessageId} to apply branchLabel!`);
              return prev;
            }

            console.log(`[DEBUG] Frontend successfully updated state with branchLabel note for node ${userMessageId}`);
            
            // Create a new GraphNote for the branch label
            const newNoteId = 'note-' + uuidv4();
            const newNote: GraphNote = {
              id: newNoteId,
              x: 0, // Relative to the node it's attached to
              y: -80, // Offset above the node
              width: Math.min(Math.max(label.length * 10, 100), 300), 
              height: 40,
              content: label,
              resizeMode: 'AUTO',
              style: {
                color: '#ffeb3b', // Default sticky note color
                fontSize: 'S',
                fontFamily: 'Virgil',
                textAlign: 'center',
              },
              attachedToNodeId: userMessageId,
              createdAt: Date.now()
            };

            return {
              ...prev,
              sessions: {
                ...prev.sessions,
                [existingSessionId]: {
                  ...session,
                  updatedAt: Date.now(),
                  notes: {
                    ...(session.notes || {}),
                    [newNoteId]: newNote
                  },
                  nodes: {
                    ...session.nodes,
                    [userMessageId]: { ...node, branchLabel: label }, // Keeping branchLabel on node just in case
                  },
                },
              },
            };
          });
        },
        onDone: ({ modelMessageId, tokenUsage }) => {
          finalizeStreamTracking(result.streamId, modelMessageId);
          setState(prev => {
            const session = prev.sessions[existingSessionId];
            const node = session?.nodes?.[modelMessageId];
            if (!session || !node) return prev;

            return {
              ...prev,
              sessions: {
                ...prev.sessions,
                [existingSessionId]: {
                  ...session,
                  updatedAt: Date.now(),
                  nodes: {
                    ...session.nodes,
                    [modelMessageId]: { 
                      ...node, 
                      isStreaming: false,
                      tokenUsage: tokenUsage || node.tokenUsage
                    },
                  },
                },
              },
            };
          });
        },
        onStopped: ({ modelMessageId }) => {
          finalizeStreamTracking(result.streamId, modelMessageId);
          setState(prev => {
            const session = prev.sessions[existingSessionId];
            const node = session?.nodes?.[modelMessageId];
            if (!session || !node) return prev;
            const suffix = '\n\n**[Stopped by User]**';

            return {
              ...prev,
              sessions: {
                ...prev.sessions,
                [existingSessionId]: {
                  ...session,
                  updatedAt: Date.now(),
                  nodes: {
                    ...session.nodes,
                    [modelMessageId]: {
                      ...node,
                      content: node.content.endsWith(suffix) ? node.content : `${node.content}${suffix}`,
                      isStreaming: false,
                    },
                  },
                },
              },
            };
          });
        },
        onGenerationError: ({ modelMessageId, message }) => {
          finalizeStreamTracking(result.streamId, modelMessageId);
          setState(prev => {
            const session = prev.sessions[existingSessionId];
            const node = session?.nodes?.[modelMessageId];
            if (!session || !node) return prev;
            const suffix = '\n\n**[Error Interrupted]**';

            return {
              ...prev,
              sessions: {
                ...prev.sessions,
                [existingSessionId]: {
                  ...session,
                  updatedAt: Date.now(),
                  nodes: {
                    ...session.nodes,
                    [modelMessageId]: {
                      ...node,
                      content: node.content.endsWith(suffix) ? node.content : `${node.content}${suffix}`,
                      isStreaming: false,
                    },
                  },
                },
              },
            };
          });
          showSnackbar(message || 'Generation failed', 'error');
        },
        onConnectionError: () => {
          if (!streamIdsRef.current.has(result.modelMessageId)) {
            return;
          }
          console.error('Chat stream connection interrupted');
        },
      });

      streamSourcesRef.current.set(result.streamId, source);
    } catch (error: any) {
      console.error(error);
      showSnackbar(error.message || 'Failed to generate response', 'error');
      if ((error.message || '').toLowerCase().includes('configured')) {
        setIsSettingsOpen(true);
      }
    }
  };

  const handleSendMessage = async (content?: string, attachments?: any[]) => {
    // If called without content (e.g. via Enter in ChatInput), we assume ChatInput passed it. 
    const textToSend = content || '';

    if ((!textToSend.trim() && !selectedContext && !(attachments && attachments.length > 0)) || !currentSession) return;

    // Prevent sending if the current leaf is ALREADY streaming
    const activeNode = currentSession.nodes[currentSession.lastActiveNodeId];
    if (activeNode && activeStreams.has(activeNode.id)) return;

    if (backendConfig && !backendConfig.chatConfigured) {
      setIsSettingsOpen(true);
      return;
    }

    let currentInput = textToSend;

    // Append context if available
    if (selectedContext) {
      currentInput = `> ${selectedContext.content}\n\n${textToSend}`;
      setSelectedContext(null); // Clear context after using
    } else if (!textToSend.trim()) {
      return;
    }

    // Input clearing is handled by ChatInput component now.

    await generateFromNode(currentSession.lastActiveNodeId, currentInput, currentSession.id, isThinkingEnabled, attachments);
  };

  const handleEditMessage = async (nodeId: string, newContent: string, attachments?: any[]) => {
    if (!currentSession) return;
    setEditingNodeId(null);
    const nodeToEdit = currentSession.nodes[nodeId];
    if (!nodeToEdit || !nodeToEdit.parentId) return;
    await generateFromNode(nodeToEdit.parentId, newContent, currentSession.id, isThinkingEnabled, attachments);
  };

  const handleClarify = async (nodeId: string, selectedText: string, question: string, threadId?: string) => {
    const sessionId = stateRef.current.currentSessionId;
    if (!sessionId) return;
    try {
      const response = await createClarification(sessionId, nodeId, selectedText, question, threadId);
      setState(response.state);
    } catch (e) {
      console.error('Clarification failed', e);
      throw e; // Let the UI handle it
    }
  };

  const handleSuggestionClick = async (suggestion: string, nodeId: string) => {
    if (!currentSession) return;
    // Reset textarea height if needed, though input state isn't used here directly
    // Input state is now local to ChatInput, so we don't clear it here.
    // The suggestion is sent immediately.

    // Branch from the node where the suggestion originated
    await generateFromNode(nodeId, suggestion, currentSession.id, isThinkingEnabled);
  };

  const deleteNode = useCallback((nodeId: string) => {
    const currentSessionId = stateRef.current.currentSessionId;
    if (currentSessionId) {
      const session = stateRef.current.sessions[currentSessionId];
      if (session) {
        const descendants = new Set<string>();
        const stack = [nodeId];
        while (stack.length > 0) {
          const currId = stack.pop()!;
          descendants.add(currId);
          const curr = session.nodes[currId];
          if (curr) {
            stack.push(...curr.childrenIds);
          }
        }

        void stopStreamsForNodeIds(Array.from(descendants));
      }
    }

    setState(prev => {
      const sessionId = prev.currentSessionId;
      if (!sessionId) return prev;
      const session = prev.sessions[sessionId];
      if (!session) return prev;
      const node = session.nodes[nodeId];
      if (!node) return prev;

      // Prevent deleting root
      if (nodeId === session.rootNodeId) return prev;

      // 1. Collect all descendants
      const descendants = new Set<string>();
      const stack = [nodeId];
      while (stack.length > 0) {
        const currId = stack.pop()!;
        descendants.add(currId);
        const curr = session.nodes[currId];
        if (curr) {
          stack.push(...curr.childrenIds);
        }
      }

      // 2. Remove from parent's children list
      const parentId = node.parentId;
      const newNodes = { ...session.nodes };

      if (parentId && newNodes[parentId]) {
        const parent = newNodes[parentId];
        newNodes[parentId] = {
          ...parent,
          childrenIds: parent.childrenIds.filter(id => id !== nodeId)
        };
      }

      // 3. Delete node and descendants from map
      descendants.forEach(id => {
        delete newNodes[id];
      });

      // 4. Update active node if needed
      let newLastActive = session.lastActiveNodeId;
      if (descendants.has(session.lastActiveNodeId)) {
        // Fallback to parent of the deleted node
        newLastActive = parentId || session.rootNodeId;
      }

      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [sessionId]: {
            ...session,
            nodes: newNodes,
            lastActiveNodeId: newLastActive,
            updatedAt: Date.now()
          }
        }
      };
    });
  }, [stopStreamsForNodeIds]);

  const updateNode = useCallback((nodeId: string, updates: Partial<MessageNode>) => {
    setState(prev => {
      const sessionId = prev.currentSessionId;
      if (!sessionId) return prev;
      const session = prev.sessions[sessionId];
      if (!session) return prev;

      const node = session.nodes[nodeId];
      if (!node) return prev;

      const updatedNode = { ...node, ...updates };

      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [sessionId]: {
            ...session,
            nodes: { ...session.nodes, [nodeId]: updatedNode },
            updatedAt: Date.now()
          }
        }
      };
    });
  }, []);

  const resetLayout = useCallback(() => {
    setState(prev => {
      const sessionId = prev.currentSessionId;
      if (!sessionId) return prev;
      const session = prev.sessions[sessionId];
      if (!session) return prev;

      const newNodes = { ...session.nodes };
      Object.keys(newNodes).forEach(key => {
        if (newNodes[key].visualOffset) {
          const { visualOffset, ...rest } = newNodes[key];
          newNodes[key] = rest;
        }
      });

      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [sessionId]: {
            ...session,
            nodes: newNodes,
            updatedAt: Date.now()
          }
        }
      };
    });
  }, []);

  const handleBranch = useCallback((nodeId: string) => {
    setState(prev => {
      if (!prev.currentSessionId) return prev;
      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [prev.currentSessionId]: {
            ...prev.sessions[prev.currentSessionId],
            lastActiveNodeId: nodeId
          }
        }
      };
    });
    // Clear reply context when switching branches
    setSelectedContext(null);
    // Ensure editing is cancelled when branching/switching nodes directly
    setEditingNodeId(null);
  }, []);

  const handleQuote = useCallback((content: string, nodeId: string, shouldBranch: boolean = true) => {
    if (shouldBranch) {
      handleBranch(nodeId);
    }
    setSelectedContext({ content, sourceId: nodeId });
    // Focus input
    const textarea = document.querySelector('textarea');
    if (textarea) textarea.focus();
  }, [handleBranch]);

  const navigateToNode = useCallback((nodeId: string) => {
    const session = state.sessions[state.currentSessionId!];
    if (!session) return;
    const node = session.nodes[nodeId];
    if (!node) return;

    // If it's a user node and has a streaming child, jump directly to that child's response
    const streamingChildId = node.role === Role.USER ? node.childrenIds.find(id => activeStreams.has(id)) : null;

    const targetId = streamingChildId || nodeId;
    handleBranch(targetId);

    // Only enter edit mode if we didn't jump to a streaming child AND it's a user node
    if (node.role === Role.USER && !streamingChildId) {
      setEditingNodeId(nodeId);
    } else {
      setEditingNodeId(null);
    }
  }, [handleBranch, state.sessions, state.currentSessionId, activeStreams]);

  // --- Diverge / History Mode Logic ---
  const activeNode = currentSession?.nodes[currentSession.lastActiveNodeId];
  const isHistoryView = activeNode ? activeNode.childrenIds.length > 0 : false;
  // Only show Diverge UI on main input if we aren't currently editing a specific message
  const showDivergeUI = isHistoryView && !editingNodeId;

  const handleExitDiverge = useCallback(() => {
    if (!currentSession || !activeNode) return;

    // Find the latest leaf (recursive last child)
    let current = activeNode;
    while (current && current.childrenIds.length > 0) {
      // Go to the last child (most recent branch/message)
      const nextId = current.childrenIds[current.childrenIds.length - 1];
      current = currentSession.nodes[nextId];
    }

    if (current && current.id !== activeNode.id) {
      handleBranch(current.id);
      // Also ensure we are not editing
      setEditingNodeId(null);
      // Scroll to bottom
      shouldAutoScrollRef.current = true;
      scrollToBottom(true);
      // Force graph to center on the new active node
      setGraphFocusTrigger(prev => prev + 1);
    }
  }, [currentSession, activeNode, handleBranch, scrollToBottom]);

  const handleSuggestionRightClick = useCallback((e: React.MouseEvent, suggestion: string, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSuggestionMenuPosition({ top: e.clientY, left: e.clientX });
    setActiveSuggestion({ text: suggestion, nodeId });
  }, []);

  // Graph interaction callbacks - stable for React.memo memoization
  const handleGraphNodeClick = useCallback((id: string) => {
    navigateToNode(id);
  }, [navigateToNode]);

  const handleGraphToggleFullscreen = useCallback(() => {
    setIsGraphFullscreen(prev => !prev);
  }, []);

  const handleGraphToggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  const handleDivergeSuggestion = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeSuggestion) {
      handleQuote(activeSuggestion.text, activeSuggestion.nodeId);
      setActiveSuggestion(null);
      setSuggestionMenuPosition(null);
    }
  };

  // --- Folder Management ---
  const createFolder = useCallback((name: string) => {
    const id = uuidv4();
    setState(prev => {
      const minOrder = Object.values(prev.folders).reduce((min, f) => Math.min(min, f.order || 0), 0);
      return {
        ...prev,
        folders: {
          ...prev.folders,
          [id]: { id, name, createdAt: Date.now(), isCollapsed: false, order: minOrder - 1000 }
        }
      };
    });
  }, []);

  const deleteFolder = useCallback((id: string) => {
    // Determine if current session is in this folder BEFORE state update
    const currentId = state.currentSessionId;
    const sessionsInFolder = Object.keys(state.sessions).filter(sid => state.sessions[sid].folderId === id);
    const currentSessionDeleted = currentId && sessionsInFolder.includes(currentId);

    setState(prev => {
      // Delete all sessions in this folder
      const updatedSessions = { ...prev.sessions };
      sessionsInFolder.forEach(sid => {
        delete updatedSessions[sid];
      });

      const { [id]: _discardFolder, ...restFolders } = prev.folders;

      // Pick a new currentSessionId
      let newCurrentId = prev.currentSessionId;
      if (newCurrentId && !updatedSessions[newCurrentId]) {
        newCurrentId = Object.keys(updatedSessions)[0] || null;
      }

      return { ...prev, sessions: updatedSessions, folders: restFolders, currentSessionId: newCurrentId };
    });

    // Navigate AFTER state update — go to first remaining session or home
    if (currentSessionDeleted) {
      const remainingSessions = Object.keys(state.sessions).filter(sid => !sessionsInFolder.includes(sid));
      if (remainingSessions.length > 0) {
        navigate(`/chat/${remainingSessions[0]}`);
      } else {
        navigate('/');
      }
    }
  }, [state.sessions, state.currentSessionId, navigate]);

  const updateFolder = useCallback((id: string, updates: Partial<SessionFolder>) => {
    setState(prev => ({
      ...prev,
      folders: {
        ...prev.folders,
        [id]: { ...prev.folders[id], ...updates }
      }
    }));
  }, []);

  const updateSession = useCallback((id: string, updates: Partial<ChatSession>) => {
    setState(prev => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        [id]: { ...prev.sessions[id], ...updates }
      }
    }));
  }, []);

  // --- Note Management ---
  const addNote = useCallback((note: GraphNote) => {
    setState(prev => {
      const sessionId = prev.currentSessionId;
      if (!sessionId) return prev;
      const session = prev.sessions[sessionId];
      if (!session) return prev;

      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [sessionId]: {
            ...session,
            notes: { ...(session.notes || {}), [note.id]: note },
            updatedAt: Date.now()
          }
        }
      };
    });
  }, []);

  const updateNote = useCallback((noteId: string, updates: Partial<GraphNote>) => {
    setState(prev => {
      const sessionId = prev.currentSessionId;
      if (!sessionId) return prev;
      const session = prev.sessions[sessionId];
      if (!session) return prev;
      const existing = session.notes?.[noteId];
      if (!existing) return prev;

      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [sessionId]: {
            ...session,
            notes: { ...session.notes, [noteId]: { ...existing, ...updates } },
            updatedAt: Date.now()
          }
        }
      };
    });
  }, []);

  const deleteNote = useCallback((noteId: string) => {
    setState(prev => {
      const sessionId = prev.currentSessionId;
      if (!sessionId) return prev;
      const session = prev.sessions[sessionId];
      if (!session) return prev;
      if (!session.notes?.[noteId]) return prev;

      const newNotes = { ...session.notes };
      delete newNotes[noteId];

      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [sessionId]: {
            ...session,
            notes: newNotes,
            updatedAt: Date.now()
          }
        }
      };
    });
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [state.currentSessionId, currentSession?.lastActiveNodeId, scrollToBottom]);

  // Extracted dashboard variables
  const hasChats = Object.keys(state.sessions).length > 0;
  const recentChats = hasChats
    ? Object.values(state.sessions)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 3)
    : [];

  const formatTimeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  if (!isStateReady) {
    return (
      <div className="h-screen bg-background flex items-center justify-center text-text-secondary gap-3">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm font-mono">Loading workspace...</span>
      </div>
    );
  }

  if (isSessionNotFound) {
    return (
      <div className="h-screen bg-background flex flex-col items-center justify-center p-4 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-2">
          <X size={32} />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Chat Not Found</h1>
        <p className="text-text-secondary max-w-sm">
          The chat session you are looking for (<code>{location.pathname.split('/').pop()}</code>) does not exist or has been deleted.
        </p>
        <button
          onClick={() => {
            setIsSessionNotFound(false);
            navigate('/');
            // Logic to ensure we land safely
            if (Object.keys(state.sessions).length === 0) createSession();
            else {
              const first = Object.keys(state.sessions)[0];
              navigate(`/chat/${first}`);
            }
          }}
          className="mt-6 px-6 py-2 bg-accent-primary text-white rounded-lg hover:brightness-110 transition-all font-medium flex items-center gap-2"
        >
          <MessageSquarePlus size={18} />
          Start New Chat
        </button>
      </div>
    );
  }

  // threadPath is already calculated at the top


  // Extract suggestions from the last message if it's from the model and not streaming
  const lastMessage = threadPath[threadPath.length - 1];
  const suggestionsMatch = lastMessage && lastMessage.role === Role.MODEL && !lastMessage.isStreaming
    ? lastMessage.content.match(/<suggestions>([\s\S]*?)(?:<\/suggestions>|$)/)
    : null;
  const currentSuggestions = suggestionsMatch
    ? suggestionsMatch[1].split('\n').map(s => s.trim().replace(/^(?:[-*]|\d+\.)\s*/, '')).filter(s => s.length > 0)
    : [];

  return (
    <div
      className="fixed inset-0 w-full h-full bg-background text-text-primary flex font-sans transition-colors duration-300 overflow-hidden"
      onTouchStart={handleGlobalTouchStart}
      onTouchEnd={handleGlobalTouchEnd}
    >
      {/* Suggestions Context Menu */}
      {activeSuggestion && suggestionMenuPosition && (
        <div
          style={{ top: suggestionMenuPosition.top - 40, left: suggestionMenuPosition.left - 20 }}
          className="fixed z-[100] bg-surface border border-border shadow-lg rounded-lg p-1 animate-in fade-in zoom-in duration-200"
        >
          <button
            onClick={handleDivergeSuggestion}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
          >
            <GitFork size={14} className="text-accent-primary" />
            Diverge
          </button>
        </div>
      )}

      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[95] transition-opacity duration-300"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <div
        className={`
            fixed lg:relative inset-y-0 left-0 z-[100]
            h-full border-r border-border bg-surface transition-all duration-300 ease-in-out overflow-hidden
            ${isSidebarOpen ? 'w-[260px] translate-x-0 shadow-2xl lg:shadow-none' : 'w-0 -translate-x-full opacity-0 lg:opacity-100 lg:w-0 lg:translate-x-0'}
        `}
      >
        <Sidebar
          sessions={state.sessions}
          folders={state.folders}
          currentSessionId={state.currentSessionId}
          onCreateSession={createSession}
          onSelectSession={selectSession}
          onDeleteSession={deleteSession}
          onUpdateSession={updateSession}
          onCreateFolder={createFolder}
          onDeleteFolder={deleteFolder}
          onUpdateFolder={updateFolder}
          onOpenSettings={() => {
            setIsSettingsOpen(true);
          }}
          onOpenImport={() => setIsImportModalOpen(true)}
          currentUser={currentUser}
          streamingSessionIds={streamingSessionIds}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full relative min-w-0 bg-background">

        {/* Background Grid - Only visible in dark mode or subtly */}
        <div className="absolute inset-0 cyber-grid z-0 opacity-20"></div>

        {/* Header */}
        <div className={`h-14 flex items-center justify-between px-4 shrink-0 sticky top-0 bg-background/80 backdrop-blur-md transition-all duration-300 relative ${isGraphFullscreen ? 'z-[95]' : 'z-20'}`}>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
              title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
            >
              {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
            </button>

            {currentSession && (
              <h2 className="font-semibold text-text-primary text-sm truncate opacity-80 select-none hidden sm:block max-w-[200px] sm:max-w-xs md:max-w-sm">
                {currentSession.title}
              </h2>
            )}
          </div>

          {/* Centered App Logo / Home Button */}
          <button 
            onClick={() => {
              navigate('/');
              if (state.currentSessionId) {
                setState(prev => ({ ...prev, currentSessionId: null }));
              }
            }}
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-3 py-1.5 rounded-xl transition-all duration-300 group select-none cursor-pointer"
            title="Return to Dashboard"
          >
            <div className="flex flex-col items-start leading-none hidden sm:flex">
              <span className="font-bold text-[15px] tracking-tight text-text-primary">
                fschchat
              </span>
            </div>
          </button>

          <div className="flex items-center gap-2">

            {currentSession && (
              <button
                onClick={() => setIsExportModalOpen(true)}
                className="p-2 rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
                title="Export Chat"
              >
                <Download size={18} />
              </button>
            )}

            <button
              onClick={(e) => toggleTheme(e)}
              className="p-2 rounded-lg hover:bg-surface text-text-secondary hover:text-text-primary transition-colors"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {currentSession && (
              <button
                onClick={() => {
                  if (isGraphFullscreen) setIsGraphFullscreen(false);
                  else setShowGraph(!showGraph);
                }}
                className={`p-2 rounded-lg transition-colors ${showGraph || isGraphFullscreen ? 'text-accent-primary bg-accent-primary/10' : 'text-text-secondary hover:bg-surface'}`}
                title={isGraphFullscreen ? "Exit Fullscreen" : "Toggle Graph View"}
              >
                {isGraphFullscreen ? <X size={20} /> : (showGraph ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />)}
              </button>
            )}


          </div>
        </div>

        {/* Content Split */}
        <div className="flex-1 flex overflow-hidden relative z-10">

          {!currentSession ? (
            <div className="flex-1 flex items-center justify-center overflow-y-auto relative z-10 w-full h-full">
              <AnimatePresence mode="wait">
                <WelcomeDashboard 
                  key="welcome" 
                  onStartChat={handleStartNewChat} 
                  recentChats={recentChats}
                  onSelectSession={selectSession}
                  formatTimeAgo={formatTimeAgo}
                  isThinkingEnabled={isThinkingEnabled}
                  onToggleThinking={() => setIsThinkingEnabled(!isThinkingEnabled)}
                />
              </AnimatePresence>
            </div>
          ) : (
            <>
              {/* Chat Stream */}
              <div className={`flex-1 flex flex-col h-full transition-all duration-300 relative z-10 min-w-0`}>

            {/* Scrollable Area */}
            <div
              ref={scrollContainerRef}
              onScroll={checkScrollPosition}
              className="flex-1 overflow-y-auto custom-scrollbar"
            >
              <div className={`w-full ${isSidebarOpen ? 'max-w-4xl' : 'max-w-6xl'} transition-all duration-300 ease-in-out mx-auto py-8 px-4 flex flex-col gap-2`}>
                {threadPath.map((node, idx) => (
                  <ChatMessage
                    key={node.id}
                    node={node}
                    sessionId={currentSession?.id}
                    isHead={idx === threadPath.length - 1}
                    onBranch={handleBranch}
                    onQuote={handleQuote}
                    onEdit={handleEditMessage}
                    onClarify={handleClarify}
                    onDelete={deleteNode}
                    isActivePath={true}
                    isEditing={editingNodeId === node.id}
                    setIsEditing={(val) => setEditingNodeId(val ? node.id : null)}
                    isThinkingEnabled={isThinkingEnabled}
                    isAnyEditing={!!editingNodeId}
                  />
                ))}



                {isCurrentPathStreaming && threadPath[threadPath.length - 1].role === Role.USER && (
                  <div className="w-full flex justify-start pl-0 animate-pulse mt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center">
                        <Loader2 size={16} className="animate-spin text-text-secondary" />
                      </div>
                      <span className="text-sm text-text-secondary font-mono">Thinking...</span>
                    </div>
                  </div>
                )}

                <div className="h-4" />
              </div>
            </div>



            {/* Input Area */}
            <div className="p-4 bg-background z-20 shrink-0">
              <div className={`mx-auto ${isSidebarOpen ? 'max-w-4xl' : 'max-w-6xl'} transition-all duration-300 ease-in-out relative`}>

                <ChatInput
                  isSidebarOpen={isSidebarOpen}
                  isAtBottom={isAtBottom}
                  onScrollToBottom={() => {
                    shouldAutoScrollRef.current = true;
                    scrollToBottom(true, 'smooth');
                  }}
                  isCurrentPathStreaming={isCurrentPathStreaming}
                  suggestions={currentSuggestions}
                  onSuggestionClick={(s) => handleSuggestionClick(s, lastMessage?.id)}
                  onSuggestionRightClick={(e, s) => handleSuggestionRightClick(e, s, lastMessage?.id)}
                  selectedContext={selectedContext}
                  onClearContext={() => setSelectedContext(null)}
                  showDivergeUI={showDivergeUI}
                  onExitDiverge={handleExitDiverge}
                  editingNodeId={editingNodeId}
                  isThinkingEnabled={isThinkingEnabled}
                  onToggleThinking={() => setIsThinkingEnabled(!isThinkingEnabled)}
                  onSendMessage={handleSendMessage}
                  onStop={handleStop}
                  threadTokenUsage={threadTokenUsage}
                  lastTokenUsage={threadPath.length > 0 ? [...threadPath].reverse().find(n => n.tokenUsage)?.tokenUsage : undefined}
                />
              </div>
            </div>
          </div>

          {/* Graph Visualization Side Panel */}

          {/* Resize Handle (Desktop Only) */}
          <div
            className={`hidden lg:flex w-3 h-full cursor-col-resize z-40 flex-col justify-center items-center group transition-all duration-200 select-none relative shrink-0
                  ${showGraph ? 'opacity-100' : 'opacity-0 pointer-events-none w-0'}`}
            onMouseDown={startResizing}
          >
            {/* Hover/Active Background Highlight */}
            <div className={`absolute inset-0 w-full transition-colors duration-200 ${isResizing ? 'bg-accent-primary/10' : 'group-hover:bg-black/5 dark:group-hover:bg-white/5'}`} />

            {/* Vertical Line */}
            <div className={`absolute inset-y-0 w-px transition-colors duration-200 ${isResizing ? 'bg-accent-primary' : 'bg-border'}`} />

            {/* Handle Knob (Visible on Hover/Active) */}
            <div className={`
                  relative h-8 w-1 rounded-full transition-all duration-200 shadow-sm z-10
                  ${isResizing
                ? 'bg-accent-primary scale-y-125 opacity-100'
                : 'bg-text-secondary/50 group-hover:bg-accent-primary opacity-0 group-hover:opacity-100'}
              `} />
          </div>

          <div
            style={{ width: isGraphFullscreen ? '100vw' : (window.innerWidth >= 1024 ? (showGraph ? graphWidth : 0) : '100%') }}
            className={`
                  fixed inset-0 z-50 bg-background lg:bg-surface lg:z-30 lg:h-full lg:border-l lg:border-border lg:shadow-xl lg:flex lg:flex-col lg:shrink-0
                  ${isResizing ? 'transition-none' : 'transition-[width,transform,opacity] duration-300 ease-in-out'}
                  ${showGraph || isGraphFullscreen ? 'translate-x-0 opacity-100' : 'translate-x-full lg:translate-x-0 lg:w-0 lg:opacity-0 pointer-events-none lg:pointer-events-auto'}
                  ${isGraphFullscreen ? '!fixed !inset-0 !w-screen !h-screen !z-[90] !border-none' : 'lg:static'}
              `}
          >
            {/* Mobile Header Overlay */}
            <div className="lg:hidden h-14 flex items-center justify-between px-4 border-b border-border bg-surface/90 backdrop-blur-md">
              <span className="font-semibold text-text-primary">Graph View</span>
              <button
                onClick={() => setShowGraph(false)}
                className="p-2 rounded-lg text-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <PanelRightClose size={20} />
              </button>
            </div>

            <div className="flex-1 relative w-full h-full overflow-hidden">
              {/* Only render content if width > 0 to save resources, but keep container for animation */}
              <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-background h-full"><Loader2 className="animate-spin text-text-secondary w-8 h-8" /></div>}>
                <GraphView
                  key={currentSession.id}
                  nodes={currentSession.nodes}
                  rootId={currentSession.rootNodeId}
                  activeNodeId={currentSession.lastActiveNodeId}
                  onNodeClick={handleGraphNodeClick}
                  onDelete={deleteNode}
                  onUpdateNode={updateNode}
                  onResetLayout={resetLayout}
                  isFullscreen={isGraphFullscreen}
                  onToggleFullscreen={handleGraphToggleFullscreen}
                  onToggleSidebar={handleGraphToggleSidebar}
                  isSidebarOpen={isSidebarOpen}
                  focusTrigger={graphFocusTrigger}
                  // Notes
                  notes={currentSession.notes || {}}
                  onAddNote={addNote}
                  onUpdateNote={updateNote}
                  onDeleteNote={deleteNote}
                />
              </Suspense>
            </div>
          </div>
          </>
          )}

        </div>
      </div>

      {/* Settings Modal (Now includes Profile actions) */}
      <Suspense fallback={null}>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          backendConfig={backendConfig}
          onRefreshStatus={async () => { await refreshBackendStatus(); }}
          user={currentUser}
          onUpdateProfile={handleProfileUpdate}
          onChangePassword={handlePasswordChange}
          onExportData={handleExportAccount}
          onLogout={onLogout}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onImport={handleImportChat}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          session={currentSession}
          threadPath={threadPath}
        />
      </Suspense>
    </div>
  );
};

const AppShell: React.FC = () => {
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const buildCurrentPath = useCallback(() => {
    return `${location.pathname}${location.search}${location.hash}`;
  }, [location.hash, location.pathname, location.search]);

  const resolvePostAuthPath = useCallback(() => {
    const redirect = new URLSearchParams(location.search).get('redirect');
    return redirect && redirect.startsWith('/') ? redirect : '/';
  }, [location.search]);

  const redirectToAuth = useCallback(() => {
    const currentPath = buildCurrentPath();
    const redirect = currentPath === '/auth' ? '/' : currentPath;
    navigate(`/auth?redirect=${encodeURIComponent(redirect)}`, { replace: true });
  }, [buildCurrentPath, navigate]);

  const bootstrap = useCallback(async () => {
    try {
      const [config, user] = await Promise.all([getBackendConfig(), getCurrentUser()]);
      setBackendConfig(config);
      setCurrentUser(user);
      setAuthError(null);
    } catch (error: any) {
      console.error('Failed to bootstrap app shell', error);
      setAuthError(error.message || 'Failed to reach backend');
    } finally {
      setIsAuthReady(true);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const handleAuthRequired = () => {
      setCurrentUser(null);
      setAuthError('Your session expired. Please sign in again.');
    };

    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, []);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    if (!currentUser) {
      if (location.pathname !== '/auth') {
        redirectToAuth();
      }
      return;
    }

    if (location.pathname === '/auth') {
      navigate(resolvePostAuthPath(), { replace: true });
    }
  }, [currentUser, isAuthReady, location.pathname, navigate, redirectToAuth, resolvePostAuthPath]);

  const handleAuthAction = useCallback(async (
    action: (payload: { username: string; password: string }) => Promise<AuthenticatedUser>,
    payload: { username: string; password: string },
  ) => {
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      const user = await action(payload);
      setCurrentUser(user);
      const config = await getBackendConfig();
      setBackendConfig(config);
    } catch (error: any) {
      setAuthError(error.message || 'Authentication failed');
      return;
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await logoutUser();
    setCurrentUser(null);
    setAuthError(null);
    navigate('/auth', { replace: true });
  }, [navigate]);

  if (!isAuthReady) {
    return (
      <div className="h-screen bg-background flex items-center justify-center text-text-secondary gap-3">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm font-mono">Loading workspace...</span>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        backendConfig={backendConfig}
        isLoading={isAuthLoading}
        error={authError}
        onLogin={(payload) => handleAuthAction(loginUser, payload)}
        onSignup={(payload) => handleAuthAction(signupUser, payload)}
      />
    );
  }

  return <ChatApp key={currentUser.id} currentUser={currentUser} onLogout={handleLogout} onUserChange={setCurrentUser} />;
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <SnackbarProvider>
        <AppShell />
      </SnackbarProvider>
    </ThemeProvider>
  );
};

export default App;













































