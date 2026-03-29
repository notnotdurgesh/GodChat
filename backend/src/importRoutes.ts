import express from 'express';
import { ImportProviders } from './importProviders';
import { ImportResponse } from './serverTypes';
import { requireAuth } from './authHttp';

export const IMPORT_ROUTE_LOGS = [
  '  import /api/import/*',
];

interface RegisterImportRoutesOptions {
  app: express.Express;
  importProviders: ImportProviders;
}

export const registerImportRoutes = ({
  app,
  importProviders,
}: RegisterImportRoutesOptions): void => {
  app.post('/api/import/gemini', requireAuth, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, error: 'URL is required' } as ImportResponse);
      }
      if (!url.includes('gemini.google.com/share/')) {
        return res.status(400).json({ success: false, error: 'Invalid Gemini share URL' } as ImportResponse);
      }

      const chat = await importProviders.extractGeminiChat(url);
      if (chat.messages.length === 0) {
        return res.status(404).json({ success: false, error: 'No messages found in Gemini share link' } as ImportResponse);
      }

      return res.json({ success: true, data: chat } as ImportResponse);
    } catch (error: any) {
      return res.status(500).json({ success: false, error: `Gemini import failed: ${error.message}` } as ImportResponse);
    }
  });

  app.post('/api/import/claude', requireAuth, async (req, res) => {
    try {
      const { uuid } = req.body;
      if (!uuid || typeof uuid !== 'string') {
        return res.status(400).json({ success: false, error: 'UUID is required' } as ImportResponse);
      }

      const chat = await importProviders.extractClaudeChat(uuid);
      if (chat.messages.length === 0) {
        return res.status(404).json({ success: false, error: 'No messages found in Claude snapshot' } as ImportResponse);
      }

      return res.json({ success: true, data: chat } as ImportResponse);
    } catch (error: any) {
      const status = error.response?.status || 500;
      return res.status(status >= 400 && status < 600 ? status : 500).json({
        success: false,
        error: status === 404 ? 'Claude snapshot not found' : `Claude import failed: ${error.message}`,
      } as ImportResponse);
    }
  });

  app.post('/api/import/chatgpt', requireAuth, async (req, res) => {
    try {
      const { uuid } = req.body;
      if (!uuid || typeof uuid !== 'string') {
        return res.status(400).json({ success: false, error: 'UUID is required' } as ImportResponse);
      }

      const chat = await importProviders.extractChatGPTChat(uuid);
      if (chat.messages.length === 0) {
        return res.status(404).json({ success: false, error: 'No messages found in ChatGPT share page' } as ImportResponse);
      }

      return res.json({ success: true, data: chat } as ImportResponse);
    } catch (error: any) {
      return res.status(500).json({ success: false, error: `ChatGPT import failed: ${error.message}` } as ImportResponse);
    }
  });
};

