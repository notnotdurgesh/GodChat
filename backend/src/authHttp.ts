import express from 'express';
import { AuthService } from './authService';
import { ChatStateStore } from './chatStateStore';
import { AuthRequest } from './serverTypes';

export const SESSION_COOKIE = 'fschchat_session';

export const AUTH_ROUTE_LOGS = [
  '  auth   /api/auth/*',
];

const parseCookies = (cookieHeader?: string): Record<string, string> => {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce<Record<string, string>>((acc, chunk) => {
    const [key, ...rest] = chunk.trim().split('=');
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
};

export const setSessionCookie = (res: express.Response, token: string): void => {
  const isSecure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${30 * 24 * 60 * 60}`,
  ];

  if (isSecure) {
    parts.push('Secure');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
};

export const clearSessionCookie = (res: express.Response): void => {
  const isSecure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];

  if (isSecure) {
    parts.push('Secure');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
};

export const createAuthMiddleware = (authService: AuthService): express.RequestHandler => {
  return async (req: AuthRequest, _res, next) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      req.sessionToken = cookies[SESSION_COOKIE] || null;
      req.user = await authService.getUserFromToken(req.sessionToken);
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requireAuth: express.RequestHandler = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  next();
};

interface RegisterAuthRoutesOptions {
  app: express.Express;
  authService: AuthService;
  stateStore: ChatStateStore;
}

export const registerAuthRoutes = ({
  app,
  authService,
  stateStore,
}: RegisterAuthRoutesOptions): void => {
  app.get('/api/auth/me', (req: AuthRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    return res.json({ success: true, data: req.user });
  });

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress;
      const { token, user } = await authService.signup(username, password, ip);
      setSessionCookie(res, token);
      await stateStore.getState(user.id);
      return res.status(201).json({ success: true, data: user });
    } catch (error: any) {
      return res.status(error.message?.includes('taken') ? 409 : 400).json({ success: false, error: error.message || 'Signup failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const { token, user } = await authService.login(username, password);
      setSessionCookie(res, token);
      return res.json({ success: true, data: user });
    } catch (error: any) {
      return res.status(401).json({ success: false, error: error.message || 'Login failed' });
    }
  });

  app.patch('/api/auth/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { username } = req.body || {};
      const user = await authService.updateUsername(req.user!.id, username);
      return res.json({ success: true, data: { ...user, currentSessionLastUsedAt: req.user?.currentSessionLastUsedAt } });
    } catch (error: any) {
      const message = error.message || 'Profile update failed';
      const status = message.includes('taken') ? 409 : message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, error: message });
    }
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      await authService.changePassword(req.user!.id, currentPassword, newPassword);
      const refreshedUser = await authService.getUserFromToken(req.sessionToken);
      return res.json({ success: true, data: { changed: true, user: refreshedUser } });
    } catch (error: any) {
      const message = error.message || 'Password change failed';
      const status = message.includes('incorrect') ? 401 : message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, error: message });
    }
  });

  app.get('/api/auth/export', requireAuth, async (req: AuthRequest, res) => {
    const workspace = await stateStore.getState(req.user!.id);
    const sessions = Object.values(workspace.sessions);
    const folders = Object.values(workspace.folders);
    const messageCount = sessions.reduce((count, session) => count + Object.keys(session.nodes || {}).length, 0);
    const noteCount = sessions.reduce((count, session) => count + Object.keys(session.notes || {}).length, 0);

    return res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        app: {
          name: 'fschchat',
          storageProvider: 'mongodb',
          authEnabled: true,
        },
        user: req.user,
        stats: {
          sessionCount: sessions.length,
          folderCount: folders.length,
          messageCount,
          noteCount,
        },
        workspace,
      },
    });
  });

  app.post('/api/auth/logout', async (req: AuthRequest, res) => {
    await authService.logout(req.sessionToken);
    clearSessionCookie(res);
    return res.json({ success: true, data: { loggedOut: true } });
  });
};

