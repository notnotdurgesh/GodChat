import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pako from 'pako';
import { validate } from '@a24z/mermaid-parser';

const DOCS_BASE_PATH = path.resolve(__dirname, '..', 'MermaidDocs');
const SYNTAX_DOCS_PATH = path.join(DOCS_BASE_PATH, 'SyntaxDocs');
const STYLING_DOCS_PATH = path.join(DOCS_BASE_PATH, 'StylingDocs');

export const VALID_SYNTAX_FILES = [
  'architecture.md', 'block.md', 'c4.md', 'classDiagram.md',
  'entityRelationshipDiagram.md', 'flowchart.md', 'gantt.md',
  'gitgraph.md', 'kanban.md', 'mindmap.md', 'packet.md',
  'pie.md', 'quadrantChart.md', 'requirementDiagram.md',
  'sankey.md', 'sequenceDiagram.md', 'stateDiagram.md',
  'timeline.md', 'userJourney.md', 'xyChart.md',
] as const;

export const VALID_CONFIG_FILES = ['math.md', 'looks-and-themes.md'] as const;

const encodeState = (state: unknown): string => {
  const jsonString = JSON.stringify(state);
  const data = new TextEncoder().encode(jsonString);
  const compressed = pako.deflate(data, { level: 9 });
  return Buffer.from(compressed)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

const resolveSafeFilePath = (base: string, file: string): string => {
  const filePath = path.join(base, file);
  const canonicalPath = path.resolve(filePath);
  const canonicalBase = path.resolve(base);

  if (!canonicalPath.startsWith(canonicalBase)) {
    throw new Error('Access denied');
  }

  return canonicalPath;
};

export const isMermaidToolsAvailable = (): boolean => {
  return existsSync(SYNTAX_DOCS_PATH) && existsSync(STYLING_DOCS_PATH);
};

export const getSyntaxDocs = async (file: string): Promise<{ content: string }> => {
  if (!file || !VALID_SYNTAX_FILES.includes(file as typeof VALID_SYNTAX_FILES[number])) {
    throw new Error(`Invalid syntax doc file: ${file}`);
  }

  const filePath = resolveSafeFilePath(SYNTAX_DOCS_PATH, file);
  const content = await fs.readFile(filePath, 'utf8');
  return { content };
};

export const getConfigDocs = async (file: string): Promise<{ content: string }> => {
  if (!file || !VALID_CONFIG_FILES.includes(file as typeof VALID_CONFIG_FILES[number])) {
    throw new Error(`Invalid config doc file: ${file}`);
  }

  const filePath = resolveSafeFilePath(STYLING_DOCS_PATH, file);
  const content = await fs.readFile(filePath, 'utf8');
  return { content };
};

export interface MermaidRenderResult {
  diagram: {
    diagramUrl: string;
    linkToMermaidChartEditor: string;
    linkToMermaidChart: string;
    errorMessage: string;
  };
}

export const renderDiagram = async (mermaidCode: string, config?: Record<string, unknown>): Promise<MermaidRenderResult> => {
  if (!mermaidCode || typeof mermaidCode !== 'string') {
    return {
      diagram: {
        diagramUrl: '',
        linkToMermaidChartEditor: '',
        linkToMermaidChart: '',
        errorMessage: 'mermaidCode string is required',
      },
    };
  }

  let errorMessage = '';

  try {
    const result = await validate(mermaidCode, { suppressErrors: true });
    if (result === false) {
      try {
        await validate(mermaidCode, { suppressErrors: false });
      } catch (error: any) {
        errorMessage = `Syntax Error: ${error.message || 'Invalid diagram definition'}`;
      }
      if (!errorMessage) {
        errorMessage = 'Syntax Error: Invalid Mermaid diagram definition.';
      }
    }
  } catch (error: any) {
    errorMessage = `Parsing Error: ${error.message || 'Unknown error during parsing'}`;
  }

  if (errorMessage) {
    return {
      diagram: {
        diagramUrl: '',
        linkToMermaidChartEditor: '',
        linkToMermaidChart: '',
        errorMessage,
      },
    };
  }

  const state = {
    code: mermaidCode,
    mermaid: {
      theme: 'neo',
      ...(typeof config === 'object' && config ? config : {}),
    },
    autoSync: true,
    updateDiagram: true,
  };

  const payload = encodeState(state);
  const diagramUrl = `https://mermaid.ink/img/pako:${payload}`;
  const editUrl = `https://mermaid.live/edit#pako:${payload}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(diagramUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      errorMessage = `Render Error: The diagram service returned ${response.status} ${response.statusText}.`;
    }
  } catch (error) {
    console.warn('[Mermaid] Diagram verification skipped:', error);
  }

  if (errorMessage) {
    return {
      diagram: {
        diagramUrl: '',
        linkToMermaidChartEditor: '',
        linkToMermaidChart: '',
        errorMessage,
      },
    };
  }

  return {
    diagram: {
      diagramUrl,
      linkToMermaidChartEditor: editUrl,
      linkToMermaidChart: editUrl,
      errorMessage: '',
    },
  };
};

