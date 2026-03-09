import { Role, MessageNode, ChatSession } from '../types';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ImportedChat {
  title: string;
  messages: {
    role: Role;
    content: string;
    timestamp: number;
  }[];
}

interface ImportApiResponse {
  success: boolean;
  data?: {
    title: string;
    messages: { role: 'user' | 'model'; content: string; timestamp: number }[];
  };
  error?: string;
}

// ─── Config ────────────────────────────────────────────────────────────────

const IMPORT_API_BASE = process.env.IMPORT_API_BASE;

export const CLAUDE_SHARE_PREFIX = 'https://claude.ai/share/';
export const GEMINI_SHARE_PREFIX = 'https://gemini.google.com/share/';
export const CHATGPT_SHARE_PREFIX = 'https://chatgpt.com/share/';

// ─── URL Validation ────────────────────────────────────────────────────────

export const validateImportUrl = (url: string): 'claude' | 'gemini' | 'chatgpt' | null => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('claude.ai/share/') || lowerUrl.includes('claude.ai/api/chat_snapshots/')) return 'claude';
  if (lowerUrl.includes('gemini.google.com/share/')) return 'gemini';
  if (lowerUrl.includes('chatgpt.com/share/')) return 'chatgpt';
  return null;
};

export const extractUuid = (url: string, provider: 'claude' | 'gemini' | 'chatgpt'): string | null => {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    if (provider === 'claude' && urlObj.pathname.includes('/api/chat_snapshots/')) {
      const idx = pathParts.indexOf('chat_snapshots');
      if (idx !== -1 && pathParts[idx + 1]) return pathParts[idx + 1];
    }

    return pathParts[pathParts.length - 1] || null;
  } catch (e) {
    return null;
  }
};

// ─── API Helper ────────────────────────────────────────────────────────────

/**
 * Converts the API response (role: 'user' | 'model') to our ImportedChat (role: Role enum)
 */
const mapApiResponse = (apiData: ImportApiResponse['data']): ImportedChat => {
  if (!apiData) throw new Error('No data returned from import server');
  return {
    title: apiData.title,
    messages: apiData.messages.map(msg => ({
      role: msg.role === 'user' ? Role.USER : Role.MODEL,
      content: msg.content,
      timestamp: msg.timestamp,
    })),
  };
};

/**
 * Generic fetch helper for all import endpoints.
 * Throws descriptive errors on failure.
 */
const callImportApi = async (endpoint: string, body: Record<string, string>): Promise<ImportedChat> => {
  let response: Response;

  try {
    response = await fetch(`${IMPORT_API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    throw new Error(
      'Could not connect to the import server. Make sure the import-api service is running on port 5001.'
    );
  }

  const result: ImportApiResponse = await response.json();

  if (!result.success || !result.data) {
    throw new Error(result.error || `Import failed (HTTP ${response.status})`);
  }

  return mapApiResponse(result.data);
};

// ─── Import Functions ──────────────────────────────────────────────────────

export const fetchGeminiChat = async (url: string): Promise<ImportedChat> => {
  return callImportApi('/api/import/gemini', { url });
};

export const fetchClaudeChat = async (uuid: string): Promise<ImportedChat> => {
  return callImportApi('/api/import/claude', { uuid });
};

export const fetchChatGPTChat = async (uuid: string): Promise<ImportedChat> => {
  return callImportApi('/api/import/chatgpt', { uuid });
};

// ─── Convert to Session ────────────────────────────────────────────────────

export const convertToSession = (imported: ImportedChat): { session: ChatSession } => {
  const sessionId = uuidv4();
  const nodes: Record<string, MessageNode> = {};
  let lastActiveNodeId = '';
  let parentId: string | null = null;

  imported.messages.forEach((msg) => {
    const nodeId = uuidv4();
    nodes[nodeId] = {
      id: nodeId,
      parentId: parentId,
      childrenIds: [],
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    };

    if (parentId && nodes[parentId]) {
      nodes[parentId].childrenIds.push(nodeId);
    }

    parentId = nodeId;
    lastActiveNodeId = nodeId;
  });

  const session: ChatSession = {
    id: sessionId,
    title: imported.title,
    rootNodeId: Object.keys(nodes)[0] || '',
    nodes: nodes,
    lastActiveNodeId: lastActiveNodeId,
    updatedAt: Date.now(),
  };

  return { session };
};
