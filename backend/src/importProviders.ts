import { Browser, chromium } from 'playwright';
import TurndownService from 'turndown';
import axios from 'axios';
import { ImportedChat, ImportedMessage } from './serverTypes';

const turndown = new TurndownService({ codeBlockStyle: 'fenced' });

function deserializeChatgptData(arr: any[]): any {
  const memo = new Map<number, any>();

  const hydrate = (index: number): any => {
    if (index === -1) return null;
    if (memo.has(index)) return memo.get(index);

    const value = arr[index];
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      const result: any[] = [];
      memo.set(index, result);
      value.forEach((item) => {
        result.push(typeof item === 'number' ? hydrate(item) : item);
      });
      return result;
    }

    const result: Record<string, unknown> = {};
    memo.set(index, result);
    Object.keys(value).forEach((key) => {
      if (key.startsWith('_')) {
        const propName = arr[parseInt(key.slice(1), 10)];
        const propValue = value[key];
        result[propName] = propValue === -5 || propValue === undefined
          ? undefined
          : typeof propValue === 'number'
            ? hydrate(propValue)
            : propValue;
      } else {
        result[key] = value[key];
      }
    });
    return result;
  };

  return hydrate(0);
}

export class ImportProviders {
  private browserInstance: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browserInstance && this.browserInstance.isConnected()) {
      return this.browserInstance;
    }

    console.log('[Gemini Import] Launching headless browser...');
    this.browserInstance = await chromium.launch({ headless: true });
    return this.browserInstance;
  }

  async shutdown(): Promise<void> {
    if (this.browserInstance) {
      await this.browserInstance.close();
      this.browserInstance = null;
    }
  }

  async extractGeminiChat(url: string): Promise<ImportedChat> {
    const browser = await this.getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('share-turn-viewer', { timeout: 60000 });

      const turns = await page.$$('share-turn-viewer');
      const messages: ImportedMessage[] = [];

      for (const turn of turns) {
        const userText = await turn.$$eval(
          'user-query-content p',
          (els: Element[]) => els.map((e) => (e as HTMLElement).innerText).join('\n').trim(),
        ).catch(() => '');

        if (userText) {
          messages.push({ role: 'user', content: userText, timestamp: Date.now() });
        }

        const assistantHtml = await turn.$eval('.markdown', (el: Element) => (el as HTMLElement).innerHTML).catch(() => null);
        if (assistantHtml) {
          messages.push({
            role: 'model',
            content: turndown.turndown(assistantHtml).trim(),
            timestamp: Date.now(),
          });
        }
      }

      return {
        title: (await page.title().catch(() => '')) || 'Imported Gemini Chat',
        messages,
      };
    } finally {
      await context.close();
    }
  }

  async extractClaudeChat(uuid: string): Promise<ImportedChat> {
    const apiUrl = `https://claude.ai/api/chat_snapshots/${uuid}?rendering_mode=messages&render_all_tools=true`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;

    const response = await axios.get(proxyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data;
    if (!Array.isArray(data.chat_messages)) {
      throw new Error('Invalid Claude snapshot format');
    }

    const messages: ImportedMessage[] = data.chat_messages.map((msg: any) => {
      const content = Array.isArray(msg.content)
        ? msg.content.filter((entry: any) => entry.type === 'text').map((entry: any) => entry.text).join('\n')
        : (msg.text || '');

      return {
        role: msg.sender === 'human' ? 'user' : 'model',
        content,
        timestamp: new Date(msg.created_at).getTime(),
      };
    });

    return {
      title: data.snapshot_name || 'Imported Claude Chat',
      messages,
    };
  }

  async extractChatGPTChat(uuid: string): Promise<ImportedChat> {
    const url = `https://chatgpt.com/share/${uuid}`;
    const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;

    const response = await axios.get(proxyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: 30000,
    });

    const html = response.data as string;
    const marker = 'enqueue("';
    let searchFrom = 0;
    let fullData: any = null;

    while (!fullData) {
      const pos = html.indexOf(marker, searchFrom);
      if (pos === -1) break;

      const contentStart = pos + marker.length;
      let i = contentStart;
      while (i < html.length) {
        if (html[i] === '\\' && i + 1 < html.length) {
          i += 2;
        } else if (html[i] === '"') {
          break;
        } else {
          i += 1;
        }
      }

      const raw = html.substring(contentStart, i);
      if (raw.startsWith('[')) {
        try {
          const decoded = JSON.parse(`"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
          const arr = JSON.parse(decoded);
          const deserialized = deserializeChatgptData(arr);

          if (deserialized?.loaderData) {
            Object.keys(deserialized.loaderData).some((route) => {
              const routeData = deserialized.loaderData[route];
              const candidates = [routeData?.serverResponse?.data, routeData?.serverResponse, routeData];
              return candidates.some((candidate) => {
                if (candidate?.mapping) {
                  fullData = candidate;
                  return true;
                }
                return false;
              });
            });
          }
        } catch {
          // Continue scanning.
        }
      }

      searchFrom = pos + 1;
    }

    if (!fullData?.mapping) {
      throw new Error('Could not find conversation data in ChatGPT share page');
    }

    const messages: ImportedMessage[] = (fullData.linear_conversation || [])
      .map((node: any) => {
        const message = node.message;
        const authorRole = message?.author?.role;
        if (!message || !authorRole || authorRole === 'system' || authorRole === 'tool') {
          return null;
        }

        const content = (message.content?.parts || [])
          .map((part: any) => {
            if (typeof part === 'string') return part;
            return part?.text || '';
          })
          .join('\n')
          .trim();

        if (!content) {
          return null;
        }

        return {
          role: authorRole === 'user' ? 'user' : 'model',
          content,
          timestamp: (message.create_time || fullData.create_time || Date.now() / 1000) * 1000,
        };
      })
      .filter(Boolean) as ImportedMessage[];

    return {
      title: fullData.title || 'Imported ChatGPT Chat',
      messages,
    };
  }
}
