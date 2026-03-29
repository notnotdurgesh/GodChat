import express from 'express';
import { isChatConfigured, isMermaidConfigured } from './chatRuntime';
import { BackendStatus } from './chatTypes';
import { StreamManager } from './streamManager';

export const SYSTEM_ROUTE_LOGS = [
  '  system /api/config, /api/health',
];

interface RegisterSystemRoutesOptions {
  app: express.Express;
  streamManager: StreamManager;
}

export const registerSystemRoutes = ({
  app,
  streamManager,
}: RegisterSystemRoutesOptions): void => {
  app.get('/api/config', (_req, res) => {
    const status: BackendStatus = {
      chatConfigured: isChatConfigured(),
      redisConfigured: streamManager.isRedisEnabled(),
      mermaidConfigured: isMermaidConfigured(),
      authEnabled: true,
      storageProvider: 'mongodb',
    };

    res.json({ success: true, data: status });
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      providers: {
        imports: ['gemini', 'claude', 'chatgpt'],
        chat: isChatConfigured() ? ['gemini'] : [],
        tools: ['mermaid'],
      },
      redis: streamManager.isRedisEnabled(),
      auth: true,
      storageProvider: 'mongodb',
    });
  });
};

