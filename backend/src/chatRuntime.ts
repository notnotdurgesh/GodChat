import { Content, FunctionCallingConfigMode, GoogleGenAI, Part, Tool, Type } from '@google/genai';
import { ChatSession, MessageNode } from './chatTypes';
import { getConfigDocs, getSyntaxDocs, isMermaidToolsAvailable, renderDiagram, VALID_CONFIG_FILES, VALID_SYNTAX_FILES } from './mermaidTools';
import { AttachmentStore } from './attachmentStore';

const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
const DEFAULT_THINKING_MODEL = 'gemini-3-pro-preview';
const SYSTEM_INSTRUCTION = `<role>
You are Sam, an intelligence engine.
You are a very strong reasoner and planner.
Your knowledge cutoff date is January 2025.
</role>

<communication_priority>
- Imperative: Text-first communication.
- Do not generate diagrams unless explicitly requested or genuinely necessary.
- Do not include unsolicited diagrams.
</communication_priority>

<visual_capabilities>
- When a diagram is needed, you must use the render_diagram tool.
- Before rendering a diagram, you must reference Mermaid docs by calling get_syntax_docs or get_config_docs.
- Do not use ASCII art.
- Do not provide raw Mermaid code when you can render it.
</visual_capabilities>

<operational_constraints>
- Never output XML tags <function_call> or <function_result> to the user directly.
- Use native tool calls only.
- Do not display raw JSON to the user.
</operational_constraints>

<output_format>
- Format responses in high-quality Markdown.
- Always end with a short summary wrapped in <summary> tags.
- Always end with 3-5 follow-up suggestions wrapped in <suggestions> tags.
</output_format>`;

const MERMAID_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'get_syntax_docs',
        description: 'Fetches the syntax documentation for a specific Mermaid diagram type.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            file: {
              type: Type.STRING,
              enum: [...VALID_SYNTAX_FILES],
            },
          },
          required: ['file'],
        },
      },
      {
        name: 'get_config_docs',
        description: 'Fetches shared Mermaid configuration documentation.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            file: {
              type: Type.STRING,
              enum: [...VALID_CONFIG_FILES],
            },
          },
          required: ['file'],
        },
      },
      {
        name: 'render_diagram',
        description: 'Renders a Mermaid diagram.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            mermaidCode: { type: Type.STRING },
            config: { type: Type.OBJECT },
          },
          required: ['mermaidCode'],
        },
      },
    ],
  },
];

const toolFunctions: Record<string, (args: any) => Promise<any>> = {
  get_syntax_docs: async (args: { file: string }) => getSyntaxDocs(args.file),
  get_config_docs: async (args: { file: string }) => getConfigDocs(args.file),
  render_diagram: async (args: { mermaidCode: string; config?: Record<string, unknown> }) => {
    const result = await renderDiagram(args.mermaidCode, args.config);

    if (result.diagram?.errorMessage) {
      throw new Error(result.diagram.errorMessage);
    }

    if (result.diagram?.diagramUrl) {
      const aliasId = `diagram-ref-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      return {
        ...result,
        diagram: {
          ...result.diagram,
          diagramUrl: aliasId,
          _fullUrl: result.diagram.diagramUrl,
        },
        _isArtifact: true,
      };
    }

    return result;
  },
};

const getClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server');
  }
  return new GoogleGenAI({ apiKey });
};

export const isChatConfigured = (): boolean => Boolean(process.env.GEMINI_API_KEY);
export const isMermaidConfigured = (): boolean => isMermaidToolsAvailable();

export const buildHistory = async (
  nodes: Record<string, MessageNode>,
  parentId: string | null,
  attachmentStore?: AttachmentStore,
  userId?: string
): Promise<Content[]> => {
  const history: Content[] = [];
  let currentId = parentId;

  while (currentId) {
    const node = nodes[currentId];
    if (!node) {
      break;
    }

    const parts: Part[] = [];

    if (node.attachments?.length && attachmentStore && userId) {
      for (const att of node.attachments) {
        try {
          const dbAtt = await attachmentStore.getAttachment(att.id, userId);
          if (!dbAtt) continue;

          // Helper: normalise MongoDB BSON Binary → Node.js Buffer
          const normalise = (raw: any): Buffer => {
            if (Buffer.isBuffer(raw)) return raw;
            if (raw && raw._bsontype === 'Binary') return Buffer.isBuffer(raw.buffer) ? raw.buffer : Buffer.from(raw.buffer);
            if (raw instanceof Uint8Array) return Buffer.from(raw);
            if (raw && typeof raw === 'object' && raw.buffer) return Buffer.from(raw.buffer);
            if (raw && typeof raw.value === 'function') { const v = raw.value(); return Buffer.isBuffer(v) ? v : Buffer.from(v); }
            return Buffer.from(raw);
          };

          if (att.mimeType?.startsWith('image/') && dbAtt.data) {
            const buf = normalise(dbAtt.data);
            // Validate image magic bytes
            const valid = buf.length > 8 && (
              (buf[0] === 0xFF && buf[1] === 0xD8) ||         // JPEG
              (buf[0] === 0x89 && buf[1] === 0x50) ||         // PNG
              (buf[0] === 0x47 && buf[1] === 0x49) ||         // GIF
              (buf[0] === 0x52 && buf[1] === 0x49) ||         // WebP (RIFF)
              (buf[0] === 0x42 && buf[1] === 0x4D)            // BMP
            );
            if (valid) {
              parts.push({ inlineData: { mimeType: att.mimeType, data: buf.toString('base64') } });
            } else {
              parts.push({ text: `[Attached Image: ${att.name} — could not be processed]` });
            }
          } else if (att.mimeType === 'application/pdf' && dbAtt.data) {
            const buf = normalise(dbAtt.data);
            if (buf.length > 4 && buf.slice(0, 5).toString() === '%PDF-') {
              parts.push({ inlineData: { mimeType: 'application/pdf', data: buf.toString('base64') } });
            } else if (dbAtt.extractedText) {
              parts.push({ text: `[Attached PDF: ${att.name}]\n\n${dbAtt.extractedText}` });
            }
          } else if (dbAtt.extractedText) {
            parts.push({ text: `[Attached Document: ${att.name}]\n\n${dbAtt.extractedText}` });
          } else {
            parts.push({ text: `[Attached File: ${att.name} (${att.mimeType})]` });
          }
        } catch (e: any) {
          console.warn(`[buildHistory] Failed to process attachment ${att.id}:`, e.message);
        }
      }
    }

    const cleanContent = (node.content || '').replace(/<hidden_data[^>]*>.*?<\/hidden_data>/gs, '');
    if (cleanContent) {
      parts.push({ text: cleanContent });
    }

    if (parts.length > 0) {
      history.unshift({
        role: node.role === 'user' ? 'user' : 'model',
        parts,
      });
    }

    currentId = node.parentId;
  }

  return history;
};

interface RunChatGenerationOptions {
  history: Content[];
  prompt: string;
  promptParts?: Part[];
  enableThinking: boolean;
  signal?: AbortSignal;
  onText: (text: string) => Promise<void> | void;
  onThought: (thought: string) => Promise<void> | void;
}

export const runChatGeneration = async ({
  history,
  prompt,
  promptParts,
  enableThinking,
  signal,
  onText,
  onThought,
}: RunChatGenerationOptions): Promise<void> => {
  const ai = getClient();

  // Use multi-part user turn when attachments are present, otherwise plain text
  const userParts: Part[] = promptParts && promptParts.length > 0
    ? promptParts
    : [{ text: prompt }];

  const currentHistory: Content[] = [
    ...history,
    {
      role: 'user',
      parts: userParts,
    },
  ];

  let turnCount = 0;
  const maxTurns = 5;

  while (turnCount < maxTurns) {
    if (signal?.aborted) {
      throw new Error('Aborted by user');
    }

    turnCount += 1;
    const thinkingConfig = enableThinking ? { includeThoughts: true } : undefined;

    const resultStream = await ai.models.generateContentStream({
      model: enableThinking ? DEFAULT_THINKING_MODEL : DEFAULT_MODEL,
      contents: currentHistory,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: MERMAID_TOOLS,
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        thinkingConfig,
      },
    });

    let fullFunctionCall: { name: string; args: any; thoughtSignature?: string } | null = null;

    for await (const chunk of resultStream) {
      if (signal?.aborted) {
        throw new Error('Aborted by user');
      }

      const candidates = chunk.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          const partObj = part as any;
          let handledAsThought = false;

          if (partObj.thought) {
            if (typeof partObj.thought === 'string') {
              await onThought(partObj.thought);
              handledAsThought = true;
            } else if (partObj.thought === true && part.text) {
              await onThought(part.text);
              handledAsThought = true;
            }
          }

          if (part.text && !handledAsThought) {
            const safeText = part.text.replace(/<(function_call|function_result)/g, '&lt;$1');
            await onText(safeText);
          }

          if (part.functionCall) {
            fullFunctionCall = {
              name: part.functionCall.name,
              args: part.functionCall.args,
              thoughtSignature: partObj.thoughtSignature || partObj.thought_signature,
            };
          }
        }
      }
    }

    if (!fullFunctionCall) {
      return;
    }

    const { name, args, thoughtSignature } = fullFunctionCall;
    await onText(`<function_call name="${name}" args='${JSON.stringify(args).replace(/'/g, '&#39;')}' />`);

    const toolFn = toolFunctions[name];
    if (!toolFn) {
      throw new Error(`Unknown tool: ${name}`);
    }

    let toolResult: any;
    try {
      toolResult = await toolFn(args);
      if (toolResult?._isArtifact && toolResult.diagram?.diagramUrl && toolResult.diagram?._fullUrl) {
        const aliasId = toolResult.diagram.diagramUrl;
        const hiddenDataTag = `<hidden_data key="${aliasId}" type="url">${toolResult.diagram._fullUrl}</hidden_data>`;
        await onText(`<function_result status="success">Completed. Reference: ${aliasId}</function_result>${hiddenDataTag}`);

        const { _fullUrl, ...cleanDiagram } = toolResult.diagram;
        const cleanResult = { ...toolResult, diagram: cleanDiagram };
        delete cleanResult._isArtifact;
        toolResult = cleanResult;
      } else {
        await onText('<function_result status="success">Completed</function_result>');
      }
    } catch (error: any) {
      toolResult = { error: error.message };
      await onText(`<function_result status="error">${error.message}</function_result>`);
    }

    const functionCallPart: any = { functionCall: { name, args } };
    if (thoughtSignature) {
      functionCallPart.thoughtSignature = thoughtSignature;
    }

    currentHistory.push({
      role: 'model',
      parts: [functionCallPart],
    });

    currentHistory.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name,
            response: { result: toolResult },
          },
        } as Part,
      ],
    });
  }
};

export const getSessionHistory = async (session: ChatSession, parentId: string | null, attachmentStore?: AttachmentStore, userId?: string): Promise<Content[]> => {
  return buildHistory(session.nodes, parentId, attachmentStore, userId);
};
