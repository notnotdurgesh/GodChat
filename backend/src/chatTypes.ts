export type Role = 'user' | 'model' | 'system';

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface MessageNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  role: Role;
  content: string;
  thought?: string;
  timestamp: number;
  isStreaming?: boolean;
  wasThinkingEnabled?: boolean;
  attachments?: Attachment[];
  customLabel?: string;
  customColor?: string;
  customAlias?: string;
  visualOffset?: { x: number; y: number };
  branchLabel?: string;
}

export type NoteResizeMode = 'AUTO' | 'FIXED';
export type NoteFontFamily = 'Virgil' | 'Helvetica' | 'Cascadia';
export type NoteFontSize = 'S' | 'M' | 'L' | 'XL';
export type NoteTextAlign = 'left' | 'center' | 'right';

export interface GraphNote {
  id: string;
  x: number;
  y: number;
  content: string;
  width?: number;
  height?: number;
  resizeMode: NoteResizeMode;
  style: {
    fontFamily?: NoteFontFamily;
    fontSize?: NoteFontSize;
    textAlign?: NoteTextAlign;
    color?: string;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    textDecoration?: 'none' | 'underline' | 'line-through';
  };
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  rootNodeId: string;
  nodes: Record<string, MessageNode>;
  notes?: Record<string, GraphNote>;
  lastActiveNodeId: string;
  updatedAt: number;
  customColor?: string;
  folderId?: string;
  order?: number;
}

export interface SessionFolder {
  id: string;
  name: string;
  color?: string;
  isCollapsed?: boolean;
  createdAt: number;
  order?: number;
}

export interface ChatState {
  sessions: Record<string, ChatSession>;
  folders: Record<string, SessionFolder>;
  currentSessionId: string | null;
}

export interface BackendStatus {
  chatConfigured: boolean;
  redisConfigured: boolean;
  mermaidConfigured: boolean;
  authEnabled: boolean;
  storageProvider: 'mongodb';
  demoMode: boolean;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  createdAt: number;
  lastSignedInAt: number;
  passwordUpdatedAt: number;
  currentSessionLastUsedAt?: number;
  chatTurns: number;
  registrationIp?: string;
}

export interface StreamEnvelope {
  id: number;
  event: string;
  data: unknown;
}

export interface StreamMetadata {
  streamId: string;
  userId: string;
  sessionId: string;
  modelMessageId: string;
  userMessageId: string;
  createdAt: number;
}
