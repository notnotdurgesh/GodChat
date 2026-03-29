import express from 'express';
import { AuthenticatedUser } from './chatTypes';

export interface AuthRequest extends express.Request {
  user?: AuthenticatedUser | null;
  sessionToken?: string | null;
}

export interface ImportedMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export interface ImportedChat {
  title: string;
  messages: ImportedMessage[];
}

export interface ImportResponse {
  success: boolean;
  data?: ImportedChat;
  error?: string;
}
