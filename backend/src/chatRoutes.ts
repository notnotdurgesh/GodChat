import express from 'express';
import { randomUUID } from 'node:crypto';
import { buildHistory, isChatConfigured, runChatGeneration, generateBranchLabel, generateClarification } from './chatRuntime';
import { ChatStateStore } from './chatStateStore';
import { StreamManager } from './streamManager';
import { requireAuth } from './authHttp';
import { AuthRequest } from './serverTypes';

export const CHAT_ROUTE_LOGS = [
  '  chat   /api/chat/*',
];

interface RegisterChatRoutesOptions {
  app: express.Express;
  stateStore: ChatStateStore;
  streamManager: StreamManager;
  attachmentStore: import('./attachmentStore').AttachmentStore;
}

export const registerChatRoutes = ({
  app,
  stateStore,
  streamManager,
  attachmentStore,
}: RegisterChatRoutesOptions): void => {
  const startChatGeneration = async ({
    userId,
    streamId,
    sessionId,
    modelMessageId,
    history,
    prompt,
    enableThinking,
    currentAttachments,
    backgroundTasks,
  }: {
    userId: string;
    streamId: string;
    sessionId: string;
    modelMessageId: string;
    history: any[];
    prompt: string;
    enableThinking: boolean;
    currentAttachments?: any[];
    backgroundTasks?: Promise<any>[];
  }): Promise<void> => {
    const abortController = new AbortController();
    streamManager.registerAbortController(streamId, abortController);

    try {
      // Build prompt parts — inject current-turn attachments first, then user text
      const promptParts: any[] = [];
      if (currentAttachments && currentAttachments.length > 0) {
        for (const att of currentAttachments) {
          try {
            const dbAtt = await attachmentStore.getAttachment(att.id, userId);
            if (!dbAtt) continue;

            // Helper: normalise MongoDB BSON Binary → Node.js Buffer
            const normaliseToBuffer = (raw: any): Buffer => {
              if (Buffer.isBuffer(raw)) return raw;
              if (raw && raw._bsontype === 'Binary') return Buffer.isBuffer(raw.buffer) ? raw.buffer : Buffer.from(raw.buffer);
              if (raw instanceof Uint8Array) return Buffer.from(raw);
              if (raw && typeof raw === 'object' && raw.buffer) return Buffer.from(raw.buffer);
              if (raw && typeof raw.value === 'function') { const v = raw.value(); return Buffer.isBuffer(v) ? v : Buffer.from(v); }
              return Buffer.from(raw);
            };

            if (dbAtt.mimeType.startsWith('image/') && dbAtt.data) {
              const imgBuffer = normaliseToBuffer(dbAtt.data);
              // Validate: image buffer should have at least a few bytes and start with known magic bytes
              const isValidImage = imgBuffer.length > 8 && (
                // JPEG: FF D8 FF
                (imgBuffer[0] === 0xFF && imgBuffer[1] === 0xD8 && imgBuffer[2] === 0xFF) ||
                // PNG: 89 50 4E 47
                (imgBuffer[0] === 0x89 && imgBuffer[1] === 0x50 && imgBuffer[2] === 0x4E && imgBuffer[3] === 0x47) ||
                // GIF: 47 49 46
                (imgBuffer[0] === 0x47 && imgBuffer[1] === 0x49 && imgBuffer[2] === 0x46) ||
                // WebP: RIFF....WEBP
                (imgBuffer[0] === 0x52 && imgBuffer[1] === 0x49 && imgBuffer[2] === 0x46 && imgBuffer[3] === 0x46) ||
                // BMP: 42 4D
                (imgBuffer[0] === 0x42 && imgBuffer[1] === 0x4D)
              );

              if (isValidImage) {
                promptParts.push({ inlineData: { mimeType: dbAtt.mimeType, data: imgBuffer.toString('base64') } });
              } else {
                console.warn(`[Chat] Skipping image "${dbAtt.name}" — invalid/corrupt image data (${imgBuffer.length} bytes, header: ${imgBuffer.slice(0, 4).toString('hex')})`);
                // Still mention it as text
                promptParts.push({ text: `[Attached Image: ${dbAtt.name} — could not be processed]` });
              }
            } else if (dbAtt.mimeType === 'application/pdf' && dbAtt.data) {
              // Gemini natively supports PDF via inlineData
              const pdfBuffer = normaliseToBuffer(dbAtt.data);
              if (pdfBuffer.length > 4 && pdfBuffer.slice(0, 5).toString() === '%PDF-') {
                promptParts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } });
              } else if (dbAtt.extractedText) {
                promptParts.push({ text: `[Attached PDF: ${dbAtt.name}]\n\n${dbAtt.extractedText}` });
              }
            } else if (dbAtt.extractedText) {
              promptParts.push({ text: `[Attached Document: ${dbAtt.name}]\n\n${dbAtt.extractedText}` });
            } else {
              // File uploaded but no text extraction and no image — just mention it
              promptParts.push({ text: `[Attached File: ${dbAtt.name} (${dbAtt.mimeType})]` });
            }
          } catch (e: any) {
            console.warn(`[Chat] Failed to process attachment ${att.id}:`, e.message);
          }
        }
      }
      if (prompt) promptParts.push({ text: prompt });

      const { tokenUsage } = await runChatGeneration({
        history,
        promptParts: promptParts.length > 0 ? promptParts : [{ text: prompt }],
        prompt,
        enableThinking,
        signal: abortController.signal,
        onText: async (text) => {
          await stateStore.updateState(userId, (state) => {
            const session = state.sessions[sessionId];
            const modelNode = session?.nodes?.[modelMessageId];
            if (!session || !modelNode) {
              return;
            }

            modelNode.content = `${modelNode.content || ''}${text}`;
            session.updatedAt = Date.now();
          });

          streamManager.publish(streamId, 'text-delta', { modelMessageId, text });
        },
        onThought: async (thought) => {
          await stateStore.updateState(userId, (state) => {
            const session = state.sessions[sessionId];
            const modelNode = session?.nodes?.[modelMessageId];
            if (!session || !modelNode) {
              return;
            }

            modelNode.thought = `${modelNode.thought || ''}${thought}`;
            session.updatedAt = Date.now();
          });

          streamManager.publish(streamId, 'thought-delta', { modelMessageId, thought });
        },
      });

      await stateStore.updateState(userId, (state) => {
        const session = state.sessions[sessionId];
        const modelNode = session?.nodes?.[modelMessageId];
        if (!session || !modelNode) {
          return;
        }

        modelNode.isStreaming = false;
        if (tokenUsage) {
          modelNode.tokenUsage = tokenUsage;
        }
        session.updatedAt = Date.now();
      });

      if (backgroundTasks && backgroundTasks.length > 0) {
        await Promise.allSettled(backgroundTasks);
      }

      streamManager.publish(streamId, 'done', { modelMessageId, tokenUsage });
    } catch (error: any) {
      const stopped = abortController.signal.aborted;
      if (!stopped) {
        console.error('[Chat Generation Error]', error);
      }
      const suffix = stopped ? '\n\n**[Stopped by User]**' : '\n\n**[Error Interrupted]**';

      await stateStore.updateState(userId, (state) => {
        const session = state.sessions[sessionId];
        const modelNode = session?.nodes?.[modelMessageId];
        if (!session || !modelNode) {
          return;
        }

        if (!modelNode.content.endsWith(suffix)) {
          modelNode.content = `${modelNode.content || ''}${suffix}`;
        }
        modelNode.isStreaming = false;
        session.updatedAt = Date.now();
      });

      streamManager.publish(streamId, stopped ? 'stopped' : 'generation-error', {
        modelMessageId,
        message: stopped ? 'Generation stopped' : (error.message || 'Generation failed'),
      });
    }
  };

  app.post('/api/chat/message', requireAuth, async (req: AuthRequest, res) => {
    if (!isChatConfigured()) {
      return res.status(503).json({ success: false, error: 'Server chat provider is not configured' });
    }

    const { sessionId, parentId, content, useThinking, attachments } = req.body || {};
    if (!sessionId || !parentId || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'sessionId, parentId, and content are required' });
    }

    const userId = req.user!.id;
    const streamId = randomUUID();
    const userMessageId = randomUUID();
    const modelMessageId = randomUUID();
    const createdAt = Date.now();

    try {
      const { state, history, isBranch } = await stateStore.updateState<{state: any, history: any[], isBranch: boolean}>(userId, async (state) => {
        const session = state.sessions[sessionId];
        if (!session) {
          throw new Error('Session not found');
        }

        const parentNode = session.nodes[parentId];
        if (!parentNode) {
          throw new Error('Parent node not found');
        }

        const history = await buildHistory(session.nodes, parentId, attachmentStore, userId);
        const isFirstMessage = session.nodes[session.rootNodeId]?.childrenIds?.length === 0;
        const isBranch = parentNode.childrenIds.length > 0;
        console.log(`[DEBUG] POST /api/chat/message - parentId: ${parentId}, parentNode.childrenIds.length: ${parentNode.childrenIds.length}, isBranch: ${isBranch}`);

        session.nodes[userMessageId] = {
          id: userMessageId,
          parentId,
          childrenIds: [modelMessageId],
          role: 'user',
          content,
          attachments: attachments || [],
          timestamp: createdAt,
        };

        parentNode.childrenIds = [...parentNode.childrenIds, userMessageId];

        session.nodes[modelMessageId] = {
          id: modelMessageId,
          parentId: userMessageId,
          childrenIds: [],
          role: 'model',
          content: '',
          thought: '',
          timestamp: createdAt + 1,
          isStreaming: true,
          wasThinkingEnabled: Boolean(useThinking),
        };

        if (isFirstMessage && session.title === 'New Chat') {
          session.title = content.length > 30 ? `${content.slice(0, 30)}...` : content;
        }

        session.lastActiveNodeId = modelMessageId;
        session.updatedAt = Date.now();

        return { state, history, isBranch };
      });

      const metadata = {
        streamId,
        userId,
        sessionId,
        modelMessageId,
        userMessageId,
        createdAt,
      };

      streamManager.createStream(metadata);
      
      const backgroundTasks: Promise<any>[] = [];

      // trigger silent intent summary if it was a branch
      if (history.length > 0 && isBranch) {
        console.log(`[DEBUG] Firing generateBranchLabel for stream: ${streamId}, userMessageId: ${userMessageId}`);
        backgroundTasks.push(
          generateBranchLabel(stateStore, userId, sessionId, userMessageId, modelMessageId, history, content, streamManager, streamId)
        );
      }

      // trigger generation with background tasks ensuring stream stays alive
      void startChatGeneration({ 
        userId, 
        streamId, 
        sessionId, 
        modelMessageId, 
        history, 
        prompt: content, 
        enableThinking: Boolean(useThinking), 
        currentAttachments: attachments || [],
        backgroundTasks
      });
      
      return res.status(202).json({
        success: true,
        data: {
          streamId,
          modelMessageId,
          userMessageId,
          state,
        },
      });
    } catch (error: any) {
      return res.status(error.message?.includes('not found') ? 404 : 500).json({ success: false, error: error.message || 'Failed to create chat turn' });
    }
  });

  app.get('/api/chat/streams/:streamId', requireAuth, (req: AuthRequest, res) => {
    streamManager.attach(req.params.streamId, req.user!.id, res);
  });

  app.post('/api/chat/streams/:streamId/stop', requireAuth, async (req: AuthRequest, res) => {
    const access = streamManager.canAccess(req.params.streamId, req.user!.id);
    if (access === 'missing') {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (access === 'forbidden') {
      return res.status(403).json({ success: false, error: 'Stream access denied' });
    }

    const stopped = await streamManager.requestStop(req.params.streamId, req.user!.id);
    res.json({ success: true, data: { stopped } });
  });

  app.post('/api/chat/:sessionId/nodes/:nodeId/clarify', requireAuth, async (req: AuthRequest, res) => {
    if (!isChatConfigured()) {
      return res.status(503).json({ success: false, error: 'Server chat provider is not configured' });
    }

    const { sessionId, nodeId } = req.params;
    const { selectedText, question, threadId } = req.body || {};

    if (!question) {
      return res.status(400).json({ success: false, error: 'question is required' });
    }

    const userId = req.user!.id;

    try {
      // 1) Read needed data to build history
      const { history } = await stateStore.updateState<{history: any[]}>(userId, async (state) => {
        const session = state.sessions[sessionId];
        if (!session) throw new Error('Session not found');
        const node = session.nodes[nodeId];
        if (!node) throw new Error('Node not found');
        
        let historyToUse: any[];
        if (node.role === 'model') {
          // If the selected text was on a model node, its history ends at its parent user node,
          // so we'll just use buildHistory from the user node and add the model node text to complete it
          historyToUse = await buildHistory(session.nodes, node.parentId, attachmentStore, userId);
          historyToUse.push({ role: 'model', parts: [{ text: node.content }] });
        } else {
          historyToUse = await buildHistory(session.nodes, nodeId, attachmentStore, userId);
        }

        return { history: historyToUse };
      });

      // 2) Generate Clarification
      // If threadId is provided, we fetch the existing clarification history and append the new question
      let answer = '';
      let existingClarification: any = null;

      const stateSnapshot = await stateStore.getState(userId);
      const node = stateSnapshot.sessions[sessionId]?.nodes[nodeId];

      if (threadId) {
        existingClarification = node?.clarifications?.find((c: any) => c.id === threadId);
        if (!existingClarification) {
          throw new Error('Clarification thread not found');
        }
        answer = await generateClarification(history, existingClarification.selectedText, question, existingClarification);
      } else {
        answer = await generateClarification(history, selectedText, question, null);
      }

      // 3) Save clarification to the node
      const { state, clarification } = await stateStore.updateState<{state: any, clarification: any}>(userId, async (state) => {
        const session = state.sessions[sessionId];
        const targetNode = session.nodes[nodeId];
        targetNode.clarifications = targetNode.clarifications || [];

        let currentClarification;

        if (threadId) {
          currentClarification = targetNode.clarifications.find((c: any) => c.id === threadId);
          if (currentClarification) {
            currentClarification.followUps = currentClarification.followUps || [];
            currentClarification.followUps.push({
              id: randomUUID(),
              question,
              answer,
              timestamp: Date.now(),
            });
          }
        } else {
          currentClarification = {
            id: randomUUID(),
            selectedText,
            question,
            answer,
            timestamp: Date.now(),
            followUps: []
          };
          targetNode.clarifications.push(currentClarification);
        }

        session.updatedAt = Date.now();
        return { state, clarification: currentClarification };
      });

      return res.json({ success: true, data: { clarification, state } });

    } catch (error: any) {
      console.error('[Clarification Error]', error);
      return res.status(error.message?.includes('not found') ? 404 : 500).json({ success: false, error: error.message || 'Failed to generate clarification' });
    }
  });

};

