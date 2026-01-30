export enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
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

  // Visual Customization
  customLabel?: string;
  customColor?: string; // hex or tailwind class
  customAlias?: string;

  // Visual Positioning (Relative offset from tree layout)
  visualOffset?: { x: number, y: number };
}

// Graph Note (Excalidraw-like text)
export type NoteResizeMode = 'AUTO' | 'FIXED';
export type NoteFontFamily = 'Virgil' | 'Helvetica' | 'Cascadia';
export type NoteFontSize = 'S' | 'M' | 'L' | 'XL';
export type NoteTextAlign = 'left' | 'center' | 'right';

export interface GraphNote {
  id: string;
  x: number;
  y: number;
  content: string;
  width?: number; // if undefined/null -> auto width based on content
  height?: number; // if undefined/null -> auto height
  resizeMode: NoteResizeMode;
  style: {
    fontFamily?: NoteFontFamily; // Default Virgil
    fontSize?: NoteFontSize; // Default M
    textAlign?: NoteTextAlign; // Default left
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
  notes?: Record<string, GraphNote>; // New: Free-floating notes
  lastActiveNodeId: string;
  updatedAt: number;
  // New Fields
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

export interface Point {
  x: number;
  y: number;
}
