import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AuthService } from './src/authService';
import { ChatStateStore } from './src/chatStateStore';
import { StreamManager } from './src/streamManager';
import { AUTH_ROUTE_LOGS, createAuthMiddleware, registerAuthRoutes, requireAuth } from './src/authHttp';
import { ImportProviders } from './src/importProviders';
import { IMPORT_ROUTE_LOGS, registerImportRoutes } from './src/importRoutes';
import { AuthRequest } from './src/serverTypes';
import { CHAT_ROUTE_LOGS, registerChatRoutes } from './src/chatRoutes';
import { TOOL_ROUTE_LOGS, registerToolRoutes } from './src/toolRoutes';
import { SYSTEM_ROUTE_LOGS, registerSystemRoutes } from './src/systemRoutes';
import { UPLOAD_ROUTE_LOGS, registerUploadRoutes } from './src/uploadRoutes';
import { AttachmentStore } from './src/attachmentStore';

const loadEnvFile = (filePath: string) => {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      return;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
};

loadEnvFile(path.resolve(__dirname, '.env'));
loadEnvFile(path.resolve(__dirname, '..', '.env'));
loadEnvFile(path.resolve(__dirname, '..', 'frontend', '.env'));

const app = express();
const PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 5001);
const stateStore = new ChatStateStore(process.env.MONGODB_URI, process.env.MONGODB_DB);
const attachmentStore = new AttachmentStore(process.env.MONGODB_URI, process.env.MONGODB_DB);
const authService = new AuthService(process.env.MONGODB_URI, process.env.MONGODB_DB);
const streamManager = new StreamManager();
const importProviders = new ImportProviders();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN || 'http://127.0.0.1:3000,http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

const STATE_ROUTE_LOGS = [
  '  state  /api/state',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(bodyParser.json({ limit: '10mb' }));

app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url}`);
  next();
});

app.use(createAuthMiddleware(authService));

registerToolRoutes({ app });
registerSystemRoutes({ app, streamManager });
registerAuthRoutes({
  app,
  authService,
  stateStore,
});

app.get('/api/state', requireAuth, async (req: AuthRequest, res) => {
  res.json({ success: true, data: await stateStore.getState(req.user!.id) });
});

app.put('/api/state', requireAuth, async (req: AuthRequest, res) => {
  const { state } = req.body || {};
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ success: false, error: 'state is required' });
  }

  await stateStore.replaceState(req.user!.id, state);
  return res.json({ success: true, data: await stateStore.getState(req.user!.id) });
});

registerChatRoutes({
  app,
  stateStore,
  streamManager,
  attachmentStore,
});

registerUploadRoutes({
  app,
  attachmentStore,
});

registerImportRoutes({
  app,
  importProviders,
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

async function shutdown(): Promise<void> {
  await Promise.allSettled([
    importProviders.shutdown(),
    stateStore.shutdown(),
    attachmentStore.shutdown(),
    authService.shutdown(),
  ]);
  process.exit(0);
}

async function startServer(): Promise<void> {
  await stateStore.start();
  await attachmentStore.start();
  await authService.start();
  await streamManager.start();

  app.listen(PORT, () => {
    console.log(`jellyfsch backend running on port ${PORT}`);
    [
      ...TOOL_ROUTE_LOGS,
      ...SYSTEM_ROUTE_LOGS,
      ...AUTH_ROUTE_LOGS,
      ...STATE_ROUTE_LOGS,
      ...CHAT_ROUTE_LOGS,
      ...IMPORT_ROUTE_LOGS,
      ...UPLOAD_ROUTE_LOGS,
    ].forEach((route) => {
      console.log(route);
    });
  });
}

startServer().catch((error) => {
  console.error('[Startup Error]', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});


