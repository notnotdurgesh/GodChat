import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { StreamEnvelope, StreamMetadata } from './chatTypes';

interface StreamRecord extends StreamMetadata {
  envelopes: StreamEnvelope[];
  listeners: Set<(envelope: StreamEnvelope) => void>;
  nextEventId: number;
  status: 'pending' | 'done' | 'generation-error' | 'stopped';
  abortController?: AbortController;
}

interface RedisStreamMessage {
  sourceInstanceId: string;
  metadata: StreamMetadata;
  envelope: StreamEnvelope;
}

interface RedisStopMessage {
  sourceInstanceId: string;
  streamId: string;
}

const STREAM_CHANNEL_PREFIX = 'jellyfsch:stream:';
const STOP_CHANNEL_PREFIX = 'jellyfsch:stream-stop:';
const MAX_BACKLOG = 500;
const STREAM_TTL_MS = 15 * 60 * 1000;

const isTerminalEvent = (event: string): boolean => ['done', 'generation-error', 'stopped'].includes(event);

export class StreamManager {
  private readonly streams = new Map<string, StreamRecord>();
  private readonly modelToStream = new Map<string, string>();
  private readonly instanceId = randomUUID();
  private redisPublisher: RedisClientType | null = null;
  private redisSubscriber: RedisClientType | null = null;
  private readonly redisUrl = process.env.REDIS_URL || '';
  private redisReady = false;

  constructor() {
    setInterval(() => this.cleanupExpiredStreams(), 60_000).unref();
  }

  async start(): Promise<void> {
    if (!this.redisUrl) {
      return;
    }

    try {
      this.redisPublisher = createClient({ url: this.redisUrl });
      this.redisSubscriber = createClient({ url: this.redisUrl });

      this.redisPublisher.on('error', (error) => {
        console.error('[Redis] Publisher error:', error.message);
      });
      this.redisSubscriber.on('error', (error) => {
        console.error('[Redis] Subscriber error:', error.message);
      });

      await this.redisPublisher.connect();
      await this.redisSubscriber.connect();

      await this.redisSubscriber.pSubscribe(`${STREAM_CHANNEL_PREFIX}*`, (message) => {
        this.ingestRemoteStreamMessage(message);
      });
      await this.redisSubscriber.pSubscribe(`${STOP_CHANNEL_PREFIX}*`, (message) => {
        this.ingestRemoteStopMessage(message);
      });

      this.redisReady = true;
      console.log('[Redis] Pub/Sub bridge connected');
    } catch (error) {
      this.redisReady = false;
      console.error('[Redis] Failed to initialize bridge:', error);
    }
  }

  isRedisEnabled(): boolean {
    return this.redisReady;
  }

  createStream(metadata: StreamMetadata): StreamMetadata {
    this.ensureRecord(metadata);
    this.publish(metadata.streamId, 'stream-created', metadata);
    return metadata;
  }

  canAccess(streamId: string, userId: string): 'missing' | 'forbidden' | 'allowed' {
    const record = this.streams.get(streamId);
    if (!record) {
      return 'missing';
    }
    return record.userId === userId ? 'allowed' : 'forbidden';
  }

  attach(streamId: string, userId: string, res: Response): void {
    const access = this.canAccess(streamId, userId);
    if (access === 'missing') {
      res.status(404).json({ success: false, error: 'Stream not found' });
      return;
    }

    if (access === 'forbidden') {
      res.status(403).json({ success: false, error: 'Stream access denied' });
      return;
    }

    const record = this.streams.get(streamId)!;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 1000\n\n');

    record.envelopes.forEach((envelope) => {
      this.writeEnvelope(res, envelope);
    });

    if (record.status !== 'pending') {
      res.end();
      return;
    }

    const listener = (envelope: StreamEnvelope) => {
      this.writeEnvelope(res, envelope);
      if (isTerminalEvent(envelope.event)) {
        res.end();
      }
    };

    record.listeners.add(listener);
    res.on('close', () => {
      record.listeners.delete(listener);
    });
  }

  registerAbortController(streamId: string, controller: AbortController): void {
    const record = this.streams.get(streamId);
    if (!record) {
      return;
    }
    record.abortController = controller;
  }

  getStreamIdForModel(modelMessageId: string): string | null {
    return this.modelToStream.get(modelMessageId) || null;
  }

  async requestStop(streamId: string, userId: string): Promise<boolean> {
    if (this.canAccess(streamId, userId) !== 'allowed') {
      return false;
    }

    const stopped = this.stopLocally(streamId);
    if (this.redisReady && this.redisPublisher) {
      const channel = `${STOP_CHANNEL_PREFIX}${streamId}`;
      const payload: RedisStopMessage = { sourceInstanceId: this.instanceId, streamId };
      await this.redisPublisher.publish(channel, JSON.stringify(payload));
    }
    return stopped;
  }

  publish(streamId: string, event: string, data: unknown): void {
    const record = this.streams.get(streamId);
    if (!record) {
      return;
    }

    const envelope: StreamEnvelope = {
      id: ++record.nextEventId,
      event,
      data,
    };

    this.pushEnvelope(record, envelope);

    if (this.redisReady && this.redisPublisher) {
      const payload: RedisStreamMessage = {
        sourceInstanceId: this.instanceId,
        metadata: this.toMetadata(record),
        envelope,
      };
      this.redisPublisher.publish(`${STREAM_CHANNEL_PREFIX}${streamId}`, JSON.stringify(payload)).catch((error) => {
        console.error('[Redis] Publish failed:', error.message);
      });
    }
  }

  private toMetadata(record: StreamRecord): StreamMetadata {
    return {
      streamId: record.streamId,
      userId: record.userId,
      sessionId: record.sessionId,
      modelMessageId: record.modelMessageId,
      userMessageId: record.userMessageId,
      createdAt: record.createdAt,
    };
  }

  private ensureRecord(metadata: StreamMetadata): StreamRecord {
    const existing = this.streams.get(metadata.streamId);
    if (existing) {
      return existing;
    }

    const record: StreamRecord = {
      ...metadata,
      envelopes: [],
      listeners: new Set(),
      nextEventId: 0,
      status: 'pending',
    };

    this.streams.set(metadata.streamId, record);
    this.modelToStream.set(metadata.modelMessageId, metadata.streamId);
    return record;
  }

  private pushEnvelope(record: StreamRecord, envelope: StreamEnvelope): void {
    record.envelopes.push(envelope);
    if (record.envelopes.length > MAX_BACKLOG) {
      record.envelopes.shift();
    }

    if (isTerminalEvent(envelope.event)) {
      record.status = envelope.event === 'done' ? 'done' : envelope.event === 'stopped' ? 'stopped' : 'generation-error';
      record.abortController = undefined;
    }

    record.listeners.forEach((listener) => listener(envelope));
  }

  private writeEnvelope(res: Response, envelope: StreamEnvelope): void {
    res.write(`id: ${envelope.id}\n`);
    res.write(`event: ${envelope.event}\n`);
    res.write(`data: ${JSON.stringify(envelope.data)}\n\n`);
  }

  private stopLocally(streamId: string): boolean {
    const record = this.streams.get(streamId);
    if (!record || !record.abortController) {
      return false;
    }

    if (!record.abortController.signal.aborted) {
      record.abortController.abort();
    }

    return true;
  }

  private ingestRemoteStreamMessage(rawMessage: string): void {
    try {
      const message = JSON.parse(rawMessage) as RedisStreamMessage;
      if (message.sourceInstanceId === this.instanceId) {
        return;
      }

      const record = this.ensureRecord(message.metadata);
      const alreadySeen = record.envelopes.some((entry) => entry.id === message.envelope.id && entry.event === message.envelope.event);
      if (!alreadySeen) {
        record.nextEventId = Math.max(record.nextEventId, message.envelope.id);
        this.pushEnvelope(record, message.envelope);
      }
    } catch (error) {
      console.error('[Redis] Failed to parse stream payload:', error);
    }
  }

  private ingestRemoteStopMessage(rawMessage: string): void {
    try {
      const message = JSON.parse(rawMessage) as RedisStopMessage;
      if (message.sourceInstanceId === this.instanceId) {
        return;
      }
      this.stopLocally(message.streamId);
    } catch (error) {
      console.error('[Redis] Failed to parse stop payload:', error);
    }
  }

  private cleanupExpiredStreams(): void {
    const cutoff = Date.now() - STREAM_TTL_MS;
    Array.from(this.streams.values()).forEach((record) => {
      if (record.createdAt < cutoff && record.status !== 'pending' && record.listeners.size === 0) {
        this.streams.delete(record.streamId);
        this.modelToStream.delete(record.modelMessageId);
      }
    });
  }
}
