import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { chromium, Browser } from 'playwright';
import TurndownService from 'turndown';
import axios from 'axios';

const app = express();
const PORT = process.env.IMPORT_API_PORT || 5001;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url}`);
  next();
});

// ─── Shared Types ──────────────────────────────────────────────────────────

interface ImportedMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

interface ImportedChat {
  title: string;
  messages: ImportedMessage[];
}

interface ImportResponse {
  success: boolean;
  data?: ImportedChat;
  error?: string;
}

// ─── Gemini Import (Playwright-based) ──────────────────────────────────────

const turndown = new TurndownService({ codeBlockStyle: 'fenced' });

// Keep a singleton browser to avoid cold-start on every request
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  console.log('[Gemini] Launching headless browser...');
  browserInstance = await chromium.launch({ headless: true });
  return browserInstance;
}

async function extractGeminiChat(url: string): Promise<ImportedChat> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[Gemini] Navigating to:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for Gemini chat DOM elements
    console.log('[Gemini] Waiting for chat turns...');
    await page.waitForSelector('share-turn-viewer', { timeout: 60000 });

    const turns = await page.$$('share-turn-viewer');
    console.log('[Gemini] Turns found:', turns.length);

    const messages: ImportedMessage[] = [];

    for (const turn of turns) {
      // USER MESSAGE
      const userText = await turn.$$eval(
        'user-query-content p',
        (els: Element[]) => els.map(e => (e as HTMLElement).innerText).join('\n').trim()
      ).catch(() => '');

      if (userText) {
        messages.push({
          role: 'user',
          content: userText,
          timestamp: Date.now(),
        });
      }

      // ASSISTANT MESSAGE
      const assistantHTML = await turn.$eval(
        '.markdown',
        (el: Element) => (el as HTMLElement).innerHTML
      ).catch(() => null);

      if (assistantHTML) {
        const md = turndown.turndown(assistantHTML);
        messages.push({
          role: 'model',
          content: md.trim(),
          timestamp: Date.now(),
        });
      }
    }

    // Try to extract title from page
    const title = await page.title().catch(() => '') || 'Imported Gemini Chat';

    return { title, messages };
  } finally {
    await context.close();
  }
}

app.post('/api/import/gemini', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL is required' } as ImportResponse);
    }

    if (!url.includes('gemini.google.com/share/')) {
      return res.status(400).json({ success: false, error: 'Invalid Gemini share URL' } as ImportResponse);
    }

    const chat = await extractGeminiChat(url);

    if (chat.messages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No messages found. The share link may have expired or the page structure may have changed.',
      } as ImportResponse);
    }

    return res.json({ success: true, data: chat } as ImportResponse);
  } catch (err: any) {
    console.error('[Gemini] Import error:', err.message);
    return res.status(500).json({
      success: false,
      error: `Gemini import failed: ${err.message}`,
    } as ImportResponse);
  }
});

// ─── Claude Import (Server-side fetch) ─────────────────────────────────────

async function extractClaudeChat(uuid: string): Promise<ImportedChat> {
  const apiUrl = `https://claude.ai/api/chat_snapshots/${uuid}?rendering_mode=messages&render_all_tools=true`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;

  const response = await axios.get(proxyUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
    timeout: 30000,
  });

  const data = response.data;

  if (!data.chat_messages || !Array.isArray(data.chat_messages)) {
    throw new Error('Invalid Claude chat data format — no chat_messages array found');
  }

  const messages: ImportedMessage[] = data.chat_messages.map((msg: any) => {
    let content = '';
    if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    } else {
      content = msg.text || '';
    }

    return {
      role: msg.sender === 'human' ? 'user' : 'model',
      content,
      timestamp: new Date(msg.created_at).getTime(),
    } as ImportedMessage;
  });

  return {
    title: data.snapshot_name || 'Imported Claude Chat',
    messages,
  };
}

app.post('/api/import/claude', async (req, res) => {
  try {
    const { uuid } = req.body;

    if (!uuid || typeof uuid !== 'string') {
      return res.status(400).json({ success: false, error: 'UUID is required' } as ImportResponse);
    }

    const chat = await extractClaudeChat(uuid);

    if (chat.messages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No messages found in Claude snapshot. The share link may be invalid or expired.',
      } as ImportResponse);
    }

    return res.json({ success: true, data: chat } as ImportResponse);
  } catch (err: any) {
    console.error('[Claude] Import error:', err.message);
    const status = err.response?.status || 500;
    const detail = status === 404
      ? 'Claude snapshot not found. Make sure sharing is enabled.'
      : `Claude import failed: ${err.message}`;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: detail,
    } as ImportResponse);
  }
});

// ─── ChatGPT Import (Server-side fetch + deserialization) ──────────────────

/**
 * Deserializes the Remix/React Router serialization format used by ChatGPT
 * (Ported from client-side importService.ts)
 */
function deserializeChatgptData(arr: any[]): any {
  const memo = new Map<number, any>();

  const hydrate = (index: number): any => {
    if (index === -1) return null;
    if (memo.has(index)) return memo.get(index);

    const val = arr[index];
    if (val === null || typeof val !== 'object') {
      return val;
    }

    if (Array.isArray(val)) {
      const result: any[] = [];
      memo.set(index, result);
      val.forEach((item: any) => {
        if (typeof item === 'number') {
          result.push(hydrate(item));
        } else {
          result.push(item);
        }
      });
      return result;
    }

    const result: any = {};
    memo.set(index, result);
    for (const key in val) {
      if (key.startsWith('_')) {
        const propNameIndex = parseInt(key.substring(1));
        const valueIndex = val[key];
        const propName = arr[propNameIndex];
        if (valueIndex === -5 || valueIndex === undefined) {
          result[propName] = undefined;
        } else if (typeof valueIndex === 'number') {
          result[propName] = hydrate(valueIndex);
        } else {
          result[propName] = valueIndex;
        }
      } else {
        result[key] = val[key];
      }
    }
    return result;
  };

  return hydrate(0);
}

async function extractChatGPTChat(uuid: string): Promise<ImportedChat> {
  const url = `https://chatgpt.com/share/${uuid}`;
  const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;

  const response = await axios.get(proxyUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    timeout: 30000,
  });

  const html = response.data as string;

  let fullData: any = null;

  // Manual string scanning to extract enqueue payloads (regex fails on large payloads)
  const marker = 'enqueue("';
  let searchFrom = 0;

  while (!fullData) {
    const pos = html.indexOf(marker, searchFrom);
    if (pos === -1) break;

    const contentStart = pos + marker.length;

    // Scan forward for the unescaped closing quote
    let i = contentStart;
    while (i < html.length) {
      if (html[i] === '\\' && i + 1 < html.length) {
        i += 2; // Skip escaped character
      } else if (html[i] === '"') {
        break;  // Unescaped closing quote
      } else {
        i++;
      }
    }

    const raw = html.substring(contentStart, i);

    if (raw.startsWith('[')) {
      try {
        // Full JSON unescape — handle ALL standard escape sequences
        let decoded = '';
        for (let j = 0; j < raw.length; j++) {
          if (raw[j] === '\\' && j + 1 < raw.length) {
            const next = raw[j + 1];
            switch (next) {
              case '"': decoded += '"'; j++; break;
              case '\\': decoded += '\\'; j++; break;
              case 'n': decoded += '\n'; j++; break;
              case 'r': decoded += '\r'; j++; break;
              case 't': decoded += '\t'; j++; break;
              case 'b': decoded += '\b'; j++; break;
              case 'f': decoded += '\f'; j++; break;
              case '/': decoded += '/'; j++; break;
              case 'u':
                if (j + 5 < raw.length) {
                  const hex = raw.substring(j + 2, j + 6);
                  decoded += String.fromCharCode(parseInt(hex, 16));
                  j += 5;
                } else {
                  decoded += '\\';
                }
                break;
              default:
                decoded += '\\' + next;
                j++;
            }
          } else {
            decoded += raw[j];
          }
        }

        const arr = JSON.parse(decoded);
        const deserialized = deserializeChatgptData(arr);

        // Search ALL routes in loaderData
        if (deserialized?.loaderData) {
          for (const route of Object.keys(deserialized.loaderData)) {
            const routeData = deserialized.loaderData[route];
            if (!routeData || typeof routeData !== 'object') continue;

            const candidates = [
              routeData?.serverResponse?.data,
              routeData?.serverResponse,
              routeData,
            ];

            for (const candidate of candidates) {
              if (candidate && candidate.mapping) {
                fullData = candidate;
                break;
              }
            }
            if (fullData) break;
          }
        }
      } catch {
        // Continue to next enqueue call
      }
    }

    searchFrom = pos + 1;
  }

  if (!fullData || !fullData.mapping) {
    throw new Error('Could not find conversation data in ChatGPT share page');
  }

  const linearIds = fullData.linear_conversation || [];

  const messages: ImportedMessage[] = linearIds
    .map((node: any) => {
      const msg = node.message;
      if (!msg) return null;

      const authorRole = msg.author?.role;
      if (!authorRole || authorRole === 'system' || authorRole === 'tool') return null;

      let content = '';
      if (msg.content && msg.content.parts) {
        content = msg.content.parts
          .map((part: any) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') return part.text || '';
            return '';
          })
          .join('\n');
      }

      if (!content.trim()) return null;

      return {
        role: authorRole === 'user' ? 'user' : 'model',
        content: content.trim(),
        timestamp: (msg.create_time || fullData.create_time || Date.now() / 1000) * 1000,
      } as ImportedMessage;
    })
    .filter(Boolean) as ImportedMessage[];

  return {
    title: fullData.title || 'Imported ChatGPT Chat',
    messages,
  };
}

app.post('/api/import/chatgpt', async (req, res) => {
  try {
    const { uuid } = req.body;

    if (!uuid || typeof uuid !== 'string') {
      return res.status(400).json({ success: false, error: 'UUID is required' } as ImportResponse);
    }

    const chat = await extractChatGPTChat(uuid);

    if (chat.messages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No messages found in ChatGPT share page. The link may be invalid or expired.',
      } as ImportResponse);
    }

    return res.json({ success: true, data: chat } as ImportResponse);
  } catch (err: any) {
    console.error('[ChatGPT] Import error:', err.message);
    return res.status(500).json({
      success: false,
      error: `ChatGPT import failed: ${err.message}`,
    } as ImportResponse);
  }
});

// ─── Health Check ──────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', providers: ['gemini', 'claude', 'chatgpt'] });
});

// ─── Global Error Handler ──────────────────────────────────────────────────

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, error: 'Internal server error' } as ImportResponse);
});

// ─── Start Server ──────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 Import API running on port ${PORT}`);
  console.log(`   POST /api/import/gemini   — Gemini (Playwright)`);
  console.log(`   POST /api/import/claude   — Claude (Direct fetch)`);
  console.log(`   POST /api/import/chatgpt  — ChatGPT (HTML scraping)`);
  console.log(`   GET  /api/health          — Health check\n`);
});

// Graceful shutdown — close browser on exit
process.on('SIGINT', async () => {
  if (browserInstance) {
    console.log('\n[Shutdown] Closing Playwright browser...');
    await browserInstance.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (browserInstance) {
    await browserInstance.close();
  }
  process.exit(0);
});
