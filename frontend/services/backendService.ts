import { ChatState } from '../types';

const API_BASE = process.env.BACKEND_URL || process.env.API_BASE || '';
export const AUTH_REQUIRED_EVENT = 'jellyfsch:auth-required';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface BackendConfig {
  chatConfigured: boolean;
  redisConfigured: boolean;
  mermaidConfigured: boolean;
  authEnabled: boolean;
  storageProvider: 'mongodb';
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  createdAt: number;
  lastSignedInAt: number;
  passwordUpdatedAt: number;
  currentSessionLastUsedAt?: number;
}
export interface AccountExportData {
  exportedAt: string;
  app: {
    name: string;
    storageProvider: 'mongodb';
    authEnabled: boolean;
  };
  user: AuthenticatedUser;
  stats: {
    sessionCount: number;
    folderCount: number;
    messageCount: number;
    noteCount: number;
  };
  workspace: ChatState;
}

export interface CreateChatMessageResponse {
  streamId: string;
  modelMessageId: string;
  userMessageId: string;
  state: ChatState;
}

interface TextDeltaEvent {
  modelMessageId: string;
  text: string;
}

interface ThoughtDeltaEvent {
  modelMessageId: string;
  thought: string;
}

interface TerminalEvent {
  modelMessageId: string;
  message?: string;
}

export interface ChatStreamHandlers {
  onTextDelta: (event: TextDeltaEvent) => void;
  onThoughtDelta: (event: ThoughtDeltaEvent) => void;
  onDone: (event: TerminalEvent) => void;
  onStopped: (event: TerminalEvent) => void;
  onGenerationError: (event: TerminalEvent) => void;
  onConnectionError?: () => void;
}

export const notifyAuthRequired = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
  }
};

const apiFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  return fetch(`${API_BASE}${input}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
};

const parseResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    if (response.status === 401) {
      notifyAuthRequired();
    }
    throw new ApiError(payload.error || `Request failed with status ${response.status}`, response.status);
  }
  return payload.data;
};

export const getBackendConfig = async (): Promise<BackendConfig> => {
  const response = await apiFetch('/api/config', { method: 'GET' });
  return parseResponse<BackendConfig>(response);
};

export const getCurrentUser = async (): Promise<AuthenticatedUser | null> => {
  const response = await apiFetch('/api/auth/me', { method: 'GET' });
  if (response.status === 401) {
    return null;
  }
  return parseResponse<AuthenticatedUser>(response);
};

export const signupUser = async (payload: { username: string; password: string }): Promise<AuthenticatedUser> => {
  const response = await apiFetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return parseResponse<AuthenticatedUser>(response);
};

export const loginUser = async (payload: { username: string; password: string }): Promise<AuthenticatedUser> => {
  const response = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return parseResponse<AuthenticatedUser>(response);
};

export const updateProfile = async (payload: { username: string }): Promise<AuthenticatedUser> => {
  const response = await apiFetch('/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return parseResponse<AuthenticatedUser>(response);
};

export const changePassword = async (payload: { currentPassword: string; newPassword: string }): Promise<AuthenticatedUser> => {
  const response = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const result = await parseResponse<{ changed: boolean; user: AuthenticatedUser | null }>(response);
  if (!result.user) {
    throw new ApiError('Failed to refresh session after password change', 500);
  }
  return result.user;
};

export const exportAccountData = async (): Promise<AccountExportData> => {
  const response = await apiFetch('/api/auth/export', { method: 'GET' });
  return parseResponse<AccountExportData>(response);
};

export const logoutUser = async (): Promise<boolean> => {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' });
  const result = await parseResponse<{ loggedOut: boolean }>(response);
  return result.loggedOut;
};

export const getChatState = async (): Promise<ChatState> => {
  const response = await apiFetch('/api/state', { method: 'GET' });
  return parseResponse<ChatState>(response);
};

export const saveChatState = async (state: ChatState): Promise<ChatState> => {
  const response = await apiFetch('/api/state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  });

  return parseResponse<ChatState>(response);
};

export const createChatMessage = async (payload: {
  sessionId: string;
  parentId: string;
  content: string;
  useThinking: boolean;
  attachments?: any[];
}): Promise<CreateChatMessageResponse> => {
  const response = await apiFetch('/api/chat/message', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return parseResponse<CreateChatMessageResponse>(response);
};

export const stopChatStream = async (streamId: string): Promise<boolean> => {
  const response = await apiFetch(`/api/chat/streams/${streamId}/stop`, {
    method: 'POST',
  });

  const result = await parseResponse<{ stopped: boolean }>(response);
  return result.stopped;
};

export const openChatStream = (streamId: string, handlers: ChatStreamHandlers): EventSource => {
  const base = API_BASE || (typeof window !== 'undefined' ? window.location.origin : '');
  const source = new EventSource(`${base}/api/chat/streams/${streamId}`, { withCredentials: true });

  source.addEventListener('text-delta', (event) => {
    handlers.onTextDelta(JSON.parse((event as MessageEvent).data) as TextDeltaEvent);
  });

  source.addEventListener('thought-delta', (event) => {
    handlers.onThoughtDelta(JSON.parse((event as MessageEvent).data) as ThoughtDeltaEvent);
  });

  source.addEventListener('done', (event) => {
    handlers.onDone(JSON.parse((event as MessageEvent).data) as TerminalEvent);
    source.close();
  });

  source.addEventListener('stopped', (event) => {
    handlers.onStopped(JSON.parse((event as MessageEvent).data) as TerminalEvent);
    source.close();
  });

  source.addEventListener('generation-error', (event) => {
    handlers.onGenerationError(JSON.parse((event as MessageEvent).data) as TerminalEvent);
    source.close();
  });

  source.onerror = () => {
    handlers.onConnectionError?.();
  };

  return source;
};



