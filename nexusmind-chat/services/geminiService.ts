import { GoogleGenAI, Content, FunctionCallingConfigMode, Part } from "@google/genai";
import { MessageNode, Role } from "../types";
import { DEFAULT_MODEL, SYSTEM_INSTRUCTION, DEFAULT_THINKING_MODEL } from "../constants";
import { MERMAID_TOOLS } from "@/constants/toolDefinitions";
import { mermaidToolsApi } from "./mermaidToolService";

export const hasApiKey = (): boolean => {
  const userKey = typeof window !== 'undefined' ? localStorage.getItem('nexus_api_key') : null;
  const apiKey = userKey || process.env.GEMINI_API_KEY;
  return !!apiKey && apiKey !== 'undefined';
};

const getClient = () => {
  // Check local storage first for user-configured key
  const userKey = typeof window !== 'undefined' ? localStorage.getItem('nexus_api_key') : null;
  const apiKey = userKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("API_KEY is missing. Please set it in Settings or environment variables.");
  }
  return new GoogleGenAI({ apiKey: apiKey || 'dummy_key' });
};

/**
 * Constructs the history array by traversing up the tree from the current parent node.
 */
export const buildHistory = (
  nodes: Record<string, MessageNode>,
  parentId: string | null
): Content[] => {
  const history: Content[] = [];
  let currentId = parentId;

  while (currentId) {
    const node = nodes[currentId];
    if (!node) break;

    // Prepend to history since we traverse backwards
    // Strip hidden_data tags from the content so the model doesn't see our persistence layer
    const cleanContent = node.content.replace(/<hidden_data[^>]*>.*?<\/hidden_data>/gs, '');
    history.unshift({
      role: node.role === Role.USER ? 'user' : 'model',
      parts: [{ text: cleanContent }],
    });

    currentId = node.parentId;
  }

  return history;
};


// Map tool names to their implementation
const toolFunctions: Record<string, (args: any) => Promise<any>> = {
  get_syntax_docs: mermaidToolsApi.get_syntax_docs,
  get_config_docs: mermaidToolsApi.get_config_docs,
  render_diagram: mermaidToolsApi.render_diagram,
};

export const streamResponse = async (
  history: Content[],
  prompt: string,
  enableThinking: boolean,
  onChunk: (text: string) => void,
  onThought: (thought: string) => void,
  onFinish: () => void,
  onError: (error: Error) => void,
  signal?: AbortSignal
) => {
  try {
    const ai = getClient();

    // Initial current history includes the user's latest prompt
    let currentHistory: Content[] = [
      ...history,
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ];

    let turnCount = 0;
    const MAX_TURNS = 5; // Safety limit for tool loops

    while (turnCount < MAX_TURNS) {
      if (signal?.aborted) throw new Error("Aborted by user");
      turnCount++;

      // Configure thinking based on toggle
      const thinkingConfig = enableThinking ? { includeThoughts: true } : undefined;

      const resultStream = await ai.models.generateContentStream({
        model: enableThinking ? DEFAULT_THINKING_MODEL : DEFAULT_MODEL,
        contents: currentHistory,
        config: {
          tools: MERMAID_TOOLS,
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingConfig: thinkingConfig,
        },
      });

      let fullFunctionCall: { name: string; args: any; thoughtSignature?: string } | null = null;

      for await (const chunk of resultStream) {
        if (signal?.aborted) throw new Error("Aborted by user");

        const candidates = chunk.candidates || [];
        if (candidates.length === 0) continue;

        // Process parts
        for (const candidate of candidates) {
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              const partObj = part as any;

              // Handle Thoughts
              let handledAsThought = false;
              if (partObj.thought) {
                if (typeof partObj.thought === 'string') {
                  onThought(partObj.thought);
                  handledAsThought = true;
                } else if (partObj.thought === true && part.text) {
                  onThought(part.text);
                  handledAsThought = true;
                }
              }

              // Handle Text Streaming
              if (part.text && !handledAsThought) {
                // Security: Prevent model from spoofing UI tags
                // If the model writes <function_call> in text, it's a hallucination. We escape it so it doesn't render as a tool block.
                const safeText = part.text.replace(/<(function_call|function_result)/g, "&lt;$1");
                onChunk(safeText);
              }

              // Handle Function Calls
              if (part.functionCall) {
                fullFunctionCall = {
                  name: part.functionCall.name,
                  args: part.functionCall.args,
                  thoughtSignature: (part as any).thoughtSignature || (part as any).thought_signature
                };
              }
            }
          }
        }
      }

      // If we have a function call, execute it and loop.
      if (fullFunctionCall) {
        const { name, args, thoughtSignature } = fullFunctionCall;

        // Show tool usage in UI (using Thought channel)
        const namespacedTag = `<function_call name="${name}" args='${JSON.stringify(args).replace(/'/g, "&#39;")}' />`;
        onChunk(namespacedTag);

        const toolFn = toolFunctions[name];
        if (!toolFn) {
          throw new Error(`Unknown tool: ${name}`);
        }

        let toolResult;
        try {
          toolResult = await toolFn(args);
          // Artifact System: Handle special artifact results (e.g. diagrams with hidden URLs)
          if (toolResult && toolResult._isArtifact && toolResult.diagram?.diagramUrl && toolResult.diagram?._fullUrl) {
            const aliasId = toolResult.diagram.diagramUrl;
            const fullUrl = toolResult.diagram._fullUrl;

            // 1. Persist the mapping in the content stream (hidden from user view simply, but vital for persistence)
            // We use a special tag that MarkdownRenderer or ChatMessage will parse, 
            // AND we ensure buildHistory scrubs it so LLM doesn't see it (preventing hallway hallucination).
            const hiddenDataTag = `<hidden_data key="${aliasId}" type="url">${fullUrl}</hidden_data>`;

            // We only send the status update to stream, with the hidden tag appened
            onChunk(`<function_result status="success">Completed. Reference: ${aliasId}</function_result>${hiddenDataTag}`);

            // Clean result for history (remove _fullUrl and _isArtifact so LLM history is clean)
            // Create a clean copy for the LLM
            const { _fullUrl, ...cleanDiagram } = toolResult.diagram;
            const cleanResult = { ...toolResult, diagram: cleanDiagram };
            delete cleanResult._isArtifact;
            toolResult = cleanResult;

          } else {
            onChunk(`<function_result status="success">Completed</function_result>`);
          }

        } catch (err: any) {
          console.error(`Tool execution error for ${name}:`, err);
          toolResult = { error: err.message };
          onChunk(`<function_result status="error">${err.message}</function_result>`);
        }

        // Update History
        // 1. Model's Function Call
        // IMPORTANT: Must include thoughtSignature if present (Gemini 2.0 requirement)
        const functionCallPart: any = { functionCall: { name, args } };
        if (thoughtSignature) {
          functionCallPart.thoughtSignature = thoughtSignature;
        }

        currentHistory.push({
          role: 'model',
          parts: [functionCallPart]
        });

        // 2. User's Function Response
        currentHistory.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: name,
              response: { result: toolResult }
            }
          } as Part]
        });

        // Loop continues
        continue;
      }

      // If no function call, we are done.
      break;
    }

    onFinish();

  } catch (error) {
    console.error("Gemini API Error:", error);
    onError(error instanceof Error ? error : new Error("Unknown Gemini error"));
  }
};