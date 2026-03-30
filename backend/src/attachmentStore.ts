import { Collection, Db, MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

export interface AttachmentRecord {
  _id?: any;
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  size: number;
  data: Buffer;
  extractedText?: string;
  createdAt: number;
}

export class AttachmentStore {
  private readonly client: MongoClient;
  private readonly dbName: string;
  private db: Db | null = null;
  private collection: Collection<AttachmentRecord> | null = null;

  constructor(uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', dbName = process.env.MONGODB_DB || 'fschchat') {
    this.client = new MongoClient(uri);
    this.dbName = dbName;
  }

  async start(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.collection = this.db.collection<AttachmentRecord>('chat_attachments');
    // Ensure index on id and userId for quick lookup
    await this.collection.createIndex({ id: 1 }, { unique: true });
    await this.collection.createIndex({ userId: 1 });
  }

  async shutdown(): Promise<void> {
    // Only close if we are the sole manager, but usually client is shared or handled.
    // For standalone, close:
    await this.client.close();
  }

  async saveAttachment(record: Omit<AttachmentRecord, 'id' | 'createdAt'> & { id?: string }): Promise<AttachmentRecord> {
    this.ensureStarted();
    const id = record.id || randomUUID();
    const fullRecord: AttachmentRecord = {
      ...record,
      id,
      createdAt: Date.now(),
    };
    
    await this.collection!.insertOne(fullRecord);
    return fullRecord;
  }

  async getAttachment(id: string, userId: string): Promise<AttachmentRecord | null> {
    this.ensureStarted();
    return this.collection!.findOne({ id, userId });
  }

  /** Look up by ID only — for serving assets where browser can't send cookies */
  async getAttachmentById(id: string): Promise<AttachmentRecord | null> {
    this.ensureStarted();
    return this.collection!.findOne({ id });
  }

  private ensureStarted(): void {
    if (!this.db || !this.collection) {
      throw new Error('AttachmentStore has not been started');
    }
  }
}
