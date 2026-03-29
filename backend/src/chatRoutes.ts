import express from 'express';
import { randomUUID } from 'node:crypto';
import { buildHistory, isChatConfigured, runChatGeneration } from './chatRuntime';
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
}

export const registerChatRoutes = ({
  app,
  stateStore,
  streamManager,
}: RegisterChatRoutesOptions): void => {
  const startChatGeneration = async ({
    userId,
    streamId,
    sessionId,
    modelMessageId,
    history,
    prompt,
    enableThinking,
  }: {
    userId: string;
    streamId: string;
    sessionId: string;
    modelMessageId: string;
    history: any[];
    prompt: string;
    enableThinking: boolean;
  }): Promise<void> => {
    const abortController = new AbortController();
    streamManager.registerAbortController(streamId, abortController);

    try {
      await runChatGeneration({
        history,
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
        session.updatedAt = Date.now();
      });

      streamManager.publish(streamId, 'done', { modelMessageId });
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

    const { sessionId, parentId, content, useThinking } = req.body || {};
    if (!sessionId || !parentId || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'sessionId, parentId, and content are required' });
    }

    const userId = req.user!.id;
    const streamId = randomUUID();
    const userMessageId = randomUUID();
    const modelMessageId = randomUUID();
    const createdAt = Date.now();

    try {
      const { state, history } = await stateStore.updateState(userId, (state) => {
        const session = state.sessions[sessionId];
        if (!session) {
          throw new Error('Session not found');
        }

        const parentNode = session.nodes[parentId];
        if (!parentNode) {
          throw new Error('Parent node not found');
        }

        const history = buildHistory(session.nodes, parentId);
        const isFirstMessage = session.nodes[session.rootNodeId]?.childrenIds?.length === 0;

        session.nodes[userMessageId] = {
          id: userMessageId,
          parentId,
          childrenIds: [modelMessageId],
          role: 'user',
          content,
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

        return { state, history };
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
      void startChatGeneration({ userId, streamId, sessionId, modelMessageId, history, prompt: content, enableThinking: Boolean(useThinking) });

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
};

