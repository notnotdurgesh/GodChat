import { Collection, Db, MongoClient } from 'mongodb';
import { ChatState } from './chatTypes';

interface ChatStateRecord {
  userId: string;
  state: ChatState;
  updatedAt: number;
}

const DEFAULT_STATE: ChatState = {
  sessions: {},
  folders: {},
  currentSessionId: null,
};

const INTERRUPTION_SUFFIX = '\n\n**[Interrupted: server restarted]**';

const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const normalizeState = (state: ChatState): ChatState => {
  const next = cloneState(state || DEFAULT_STATE);
  next.sessions = next.sessions || {};
  next.folders = next.folders || {};
  next.currentSessionId = next.currentSessionId || null;

  Object.values(next.sessions).forEach((session) => {
    session.nodes = session.nodes || {};
    session.notes = session.notes || {};
  });

  return next;
};

export class ChatStateStore {
  private readonly client: MongoClient;
  private readonly dbName: string;
  private db: Db | null = null;
  private collection: Collection<ChatStateRecord> | null = null;
  private queues = new Map<string, Promise<unknown>>();

  constructor(uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', dbName = process.env.MONGODB_DB || 'fschchat') {
    this.client = new MongoClient(uri);
    this.dbName = dbName;
  }

  async start(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.collection = this.db.collection<ChatStateRecord>('chat_states');
    await this.collection.createIndex({ userId: 1 }, { unique: true });
    await this.recoverInterruptedStreams();
  }

  async shutdown(): Promise<void> {
    await this.client.close();
  }

  async getState(userId: string): Promise<ChatState> {
    this.ensureStarted();

    const existing = await this.collection!.findOne({ userId });
    if (!existing) {
      const state = normalizeState(DEFAULT_STATE);
      await this.persist(userId, state);
      return cloneState(state);
    }

    return normalizeState(existing.state);
  }

  async replaceState(userId: string, state: ChatState): Promise<void> {
    await this.enqueue(userId, async () => {
      await this.persist(userId, normalizeState(state));
    });
  }

  async updateState<T>(userId: string, mutator: (state: ChatState) => T | Promise<T>): Promise<T> {
    let result!: T;
    await this.enqueue(userId, async () => {
      const state = await this.getState(userId);
      result = await mutator(state);
      await this.persist(userId, state);
    });
    return result;
  }

  private async persist(userId: string, state: ChatState): Promise<void> {
    await this.collection!.updateOne(
      { userId },
      { $set: { state: normalizeState(state), updatedAt: Date.now() } },
      { upsert: true },
    );
  }

  private async enqueue<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const current = this.queues.get(userId) || Promise.resolve();
    const next = current.then(operation, operation);
    this.queues.set(userId, next.then(() => undefined, () => undefined));
    return next;
  }

  private async recoverInterruptedStreams(): Promise<void> {
    const records = await this.collection!.find({}).toArray();

    for (const record of records) {
      const state = normalizeState(record.state);
      let mutated = false;

      Object.values(state.sessions).forEach((session) => {
        Object.values(session.nodes).forEach((node) => {
          if (node.isStreaming) {
            node.isStreaming = false;
            if (!node.content.includes(INTERRUPTION_SUFFIX)) {
              node.content = `${node.content || ''}${INTERRUPTION_SUFFIX}`;
            }
            mutated = true;
          }
        });
      });

      if (mutated) {
        await this.persist(record.userId, state);
      }
    }
  }

  private ensureStarted(): void {
    if (!this.db || !this.collection) {
      throw new Error('ChatStateStore has not been started');
    }
  }
}
