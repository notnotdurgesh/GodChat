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

<context_processing>
- CRITICAL: When the user provides attachments (documents, code, text, etc.), you MUST prioritize the content of those files over your own internal training data.
- Do not make assumptions or rely on your own definitions if the files contain the necessary information.
- Treat the provided files as the absolute source of truth for the task.
- If asked to process, map, or summarize an attachment, read and use the exact text provided in the [Attached Document: ... | ID="..."], [Attached PDF: ... | ID="..."], or related blocks in the chat history.
</context_processing>

<operational_constraints>
- Never output XML tags <function_call> or <function_result> to the user directly.
- Use native tool calls only.
- Do not display raw JSON to the user.
- If asked to process an attachment with a tool (e.g., generate_cognitive_map), you MUST pass the exact string from the ID="..." explicitly provided in the chat history into the \`attachmentIds\` array or \`attachmentId\` property. NEVER copy-paste the entire document text into \`inlineText\`.
- \`inlineText\` is strictly for short snippets, NOT full document contents. Large documents passed in \`inlineText\` will crash the system rate limits.
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
      {
        name: 'generate_cognitive_map',
        description: 'Take attached Documents (PDF, DOCX, DOC, Excel, CSV, text), or inline text to build an interactive cognitive map / X-Ray schema. You can provide an array of attachmentIds, a single attachmentId, or inlineText. Providing customInstructions is highly recommended to guide the focus.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            attachmentId: { type: Type.STRING, description: 'The ID of a single attached document.' },
            attachmentIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'The IDs of multiple attached documents.' },
            inlineText: { type: Type.STRING, description: 'Raw text or data to construct the map from if there is no attachment.' },
            customInstructions: { type: Type.STRING, description: 'Specific goals, constraints, or context to focus on.' }
          },
        },
      },
    ],
  },
];

import { CognitiveMapService } from './cognitiveMapService';

interface ToolContext {
  streamManager?: import('./streamManager').StreamManager;
  streamId?: string;
  userId?: string;
  attachmentStore?: import('./attachmentStore').AttachmentStore;
}

const toolFunctions: Record<string, (args: any, context: ToolContext) => Promise<any>> = {
  generate_cognitive_map: async (args: { attachmentId?: string; attachmentIds?: string[]; inlineText?: string; customInstructions?: string }, context) => {
    if (!context.userId || !context.streamManager || !context.streamId) {
      throw new Error('Required context missing for tool generate_cognitive_map');
    }

    let text = args.inlineText || '';
    const ids = new Set<string>();
    
    if (args.attachmentIds && Array.isArray(args.attachmentIds)) {
      args.attachmentIds.forEach(id => ids.add(id));
    }
    if (args.attachmentId) {
      ids.add(args.attachmentId);
    }

    if (ids.size > 0) {
      if (!context.attachmentStore) {
        throw new Error('Attachment store not configured');
      }
      
      let totalLength = text.length;
      const MAX_TOTAL_LENGTH = 100000;

      for (const attrId of ids) {
        const attachment = await context.attachmentStore.getAttachment(attrId, context.userId);
        if (attachment) {
          const attText = attachment.extractedText || attachment.data?.toString('utf-8');
          if (attText) {
            // Ensure we don't go wildly over rate limits when assembling multiple documents
            const chunk = `\n\n--- Document: ${attachment.name} ---\n${attText}`;
            if (totalLength + chunk.length > MAX_TOTAL_LENGTH) {
               const remaining = MAX_TOTAL_LENGTH - totalLength;
               if (remaining > 100) {
                 text += chunk.substring(0, remaining) + '\n...[Text Truncated from this document to preserve token limits]...';
                 totalLength = MAX_TOTAL_LENGTH;
               }
            } else {
               text += chunk;
               totalLength += chunk.length;
            }
          }
        }
      }
    }

    if (!text.trim()) {
      throw new Error('Must provide either attachmentId(s) or inlineText with content.');
    }

    const service = new CognitiveMapService(process.env.GEMINI_API_KEY || '');
    const result = await service.buildCognitiveMap(text.toString(), context.streamManager, context.streamId, args.customInstructions);
    return {
      _isArtifact: true,
      _isCognitiveMap: true,
      cognitiveMap: result
    };
  },
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

          // Explicitly register attachment metadata so tools requiring attachmentId have it in context
          parts.push({ text: `[Attachment Meta: ID="${att.id}", Name="${att.name}"]` });

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
              parts.push({ text: `[Attached PDF: ${att.name} | ID="${att.id}"]\n\n${dbAtt.extractedText}` });
            }
          } else if (dbAtt.extractedText) {
            parts.push({ text: `[Attached Document: ${att.name} | ID="${att.id}"]\n\n${dbAtt.extractedText}` });
          } else {
            parts.push({ text: `[Attached File: ${att.name} | ID="${att.id}"] (${att.mimeType})` });
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
  streamManager?: import('./streamManager').StreamManager;
  streamId?: string;
  userId?: string;
  attachmentStore?: import('./attachmentStore').AttachmentStore;
}

export const runChatGeneration = async ({
  history,
  prompt,
  promptParts,
  enableThinking,
  signal,
  onText,
  onThought,
  streamManager,
  streamId,
  userId,
  attachmentStore,
}: RunChatGenerationOptions): Promise<{ tokenUsage?: import('./chatTypes').TokenUsage }> => {
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
  let finalTokenUsage: import('./chatTypes').TokenUsage | undefined = undefined;

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

      if ((chunk as any).usageMetadata) {
        const metadata = (chunk as any).usageMetadata;
        finalTokenUsage = {
          promptTokens: metadata.promptTokenCount || 0,
          candidatesTokens: metadata.candidatesTokenCount || 0,
          totalTokens: metadata.totalTokenCount || 0,
        };
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
      return { tokenUsage: finalTokenUsage };
    }

    const { name, args, thoughtSignature } = fullFunctionCall;
    await onText(`<function_call name="${name}" args='${JSON.stringify(args).replace(/'/g, '&#39;')}' />`);

    const toolFn = toolFunctions[name];
    if (!toolFn) {
      throw new Error(`Unknown tool: ${name}`);
    }

    let toolResult: any;
    try {
      toolResult = await toolFn(args, {
        streamManager,
        streamId,
        userId,
        attachmentStore
      });
      if (toolResult?._isCognitiveMap) {
        const aliasId = `xray-${Date.now()}`;
        const hiddenDataTag = `<hidden_data key="${aliasId}" type="cognitive-map">${JSON.stringify(toolResult.cognitiveMap)}</hidden_data>`;
        await onText(`<function_result status="success">Completed. Map: ${aliasId}</function_result>${hiddenDataTag}`);
        
        const { _isArtifact, _isCognitiveMap, ...cleanResult } = toolResult;
        toolResult = cleanResult;
      } else if (toolResult?._isArtifact && toolResult.diagram?.diagramUrl && toolResult.diagram?._fullUrl) {
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

  return { tokenUsage: finalTokenUsage };
};

export const getSessionHistory = async (session: ChatSession, parentId: string | null, attachmentStore?: AttachmentStore, userId?: string): Promise<Content[]> => {
  return buildHistory(session.nodes, parentId, attachmentStore, userId);
};

export const generateClarification = async (
  history: Content[],
  selectedText: string,
  question: string,
  existingThread: any | null
): Promise<string> => {
  const ai = getClient();
  const sysInstruction = `You are a helpful assistant answering follow-up questions or providing clarifications on a specific piece of text from a chat message. Keep your answers brief, concise, and helpful. Use markdown formatting. Return ONLY your answer.
Context: The user previously asked about the selected text: "${selectedText}"`;

  const contents = [...history];

  if (existingThread) {
    contents.push({ role: 'user', parts: [{ text: `Regarding the text: "${selectedText}"\n\nQuestion: ${existingThread.question}` }] });
    contents.push({ role: 'model', parts: [{ text: existingThread.answer }] });
    if (existingThread.followUps) {
      for (const fu of existingThread.followUps) {
        contents.push({ role: 'user', parts: [{ text: fu.question }] });
        contents.push({ role: 'model', parts: [{ text: fu.answer }] });
      }
    }
    contents.push({ role: 'user', parts: [{ text: question }] });
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: `Regarding the text: "${selectedText}"\n\nQuestion: ${question}` }]
    });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: contents as Content[],
    config: {
      systemInstruction: sysInstruction,
      temperature: 0.3,
    }
  });

  return response.text || "Could not generate clarification.";
};

export const generateBranchLabel = async (
  stateStore: import('./chatStateStore').ChatStateStore,
  userId: string,
  sessionId: string,
  userMessageId: string,
  modelMessageId: string,
  history: Content[],
  prompt: string,
  streamManager: import('./streamManager').StreamManager,
  streamId: string
): Promise<void> => {
  try {
    const ai = getClient();
    console.log(`[DEBUG] generateBranchLabel initiated - userMessageId: ${userMessageId}`);
    
    const sysInstruction = `You are a background agent task assistant. Summarize the user's intent for diverging into this new conversational branch.
Return ONLY a short, punchy 3-5 word title describing the new task or topic. No explanation, no quotes, no markdown. Just the raw text. Examples: "Debugging Nginx Config", "Refactoring UI Components"`;
    
    const branchContext: Content[] = [
      ...history,
      { role: 'user', parts: [{ text: prompt }] },
    ];
    
    console.log(`[DEBUG] Calling gemini-3.1-flash-lite-preview for branch label...`);
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: branchContext,
      config: {
        systemInstruction: sysInstruction,
        temperature: 0.3,
      }
    });
    
    const label = response.text?.trim()?.replace(/^["']|["']$/g, '')?.replace(/\*+/g, '');
    console.log(`[DEBUG] Branch label generated: "${label}"`);
    
    if (label) {
      console.log(`[DEBUG] Saving branchLabel: "${label}" to stateStore for nodeId: ${userMessageId}`);
      await stateStore.updateState(userId, (state) => {
        const session = state.sessions[sessionId];
        if (session && session.nodes[userMessageId]) {
          session.nodes[userMessageId].branchLabel = label;
          session.updatedAt = Date.now();
        }
      });
      console.log(`[DEBUG] Publishing stream event 'branch-label' to streamId: ${streamId}`);
      streamManager.publish(streamId, 'branch-label', { userMessageId, modelMessageId, label });
    } else {
      console.log(`[DEBUG] Branch label empty or generation failed to stringify`);
    }
  } catch (error) {
    console.error('[Branch Labeling Error]', error);
  }
};
