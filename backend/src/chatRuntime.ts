import { Content, FunctionCallingConfigMode, GoogleGenAI, Part, Tool, Type } from '@google/genai';
import { ChatSession, MessageNode } from './chatTypes';
import { getConfigDocs, getSyntaxDocs, isMermaidToolsAvailable, renderDiagram, VALID_CONFIG_FILES, VALID_SYNTAX_FILES } from './mermaidTools';

const DEFAULT_MODEL = 'gemini-3-flash-preview';
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

export const buildHistory = (
  nodes: Record<string, MessageNode>,
  parentId: string | null,
): Content[] => {
  const history: Content[] = [];
  let currentId = parentId;

  while (currentId) {
    const node = nodes[currentId];
    if (!node) {
      break;
    }

    const cleanContent = (node.content || '').replace(/<hidden_data[^>]*>.*?<\/hidden_data>/gs, '');
    history.unshift({
      role: node.role === 'user' ? 'user' : 'model',
      parts: [{ text: cleanContent }],
    });

    currentId = node.parentId;
  }

  return history;
};

interface RunChatGenerationOptions {
  history: Content[];
  prompt: string;
  enableThinking: boolean;
  signal?: AbortSignal;
  onText: (text: string) => Promise<void> | void;
  onThought: (thought: string) => Promise<void> | void;
}

export const runChatGeneration = async ({
  history,
  prompt,
  enableThinking,
  signal,
  onText,
  onThought,
}: RunChatGenerationOptions): Promise<void> => {
  const ai = getClient();

  const currentHistory: Content[] = [
    ...history,
    {
      role: 'user',
      parts: [{ text: prompt }],
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

export const getSessionHistory = (session: ChatSession, parentId: string | null): Content[] => {
  return buildHistory(session.nodes, parentId);
};
