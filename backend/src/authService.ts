import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Collection, Db, MongoClient } from 'mongodb';
import { AuthenticatedUser } from './chatTypes';

interface UserRecord {
  userId: string;
  username: string;
  usernameLower: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: number;
  lastSignedInAt: number;
  passwordUpdatedAt: number;
}

interface SessionRecord {
  sessionId: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: Date;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const normalizeUsername = (username: string): string => username.trim();

const validateUsername = (username: string): string | null => {
  const trimmed = normalizeUsername(username);
  if (!trimmed) return 'Username is required';
  if (trimmed.length < 3) return 'Username must be at least 3 characters';
  if (trimmed.length > 24) return 'Username must be 24 characters or fewer';
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return 'Username can only use letters, numbers, and underscores';
  return null;
};

const validatePassword = (password: string): string | null => {
  if (!password) return 'Password is required';
  if (password.length < 6) return 'Password must be at least 6 characters';
  if (password.length > 128) return 'Password must be 128 characters or fewer';
  return null;
};

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const hashPassword = (password: string, salt: string): string => {
  return scryptSync(password, salt, 64).toString('hex');
};

const mapUser = (record: UserRecord, sessionLastUsedAt?: number): AuthenticatedUser => ({
  id: record.userId,
  username: record.username,
  createdAt: record.createdAt,
  lastSignedInAt: record.lastSignedInAt,
  passwordUpdatedAt: record.passwordUpdatedAt,
  currentSessionLastUsedAt: sessionLastUsedAt,
});

export class AuthService {
  private readonly client: MongoClient;
  private readonly dbName: string;
  private db: Db | null = null;
  private users: Collection<UserRecord> | null = null;
  private sessions: Collection<SessionRecord> | null = null;

  constructor(uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', dbName = process.env.MONGODB_DB || 'fschchat') {
    this.client = new MongoClient(uri);
    this.dbName = dbName;
  }

  async start(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.users = this.db.collection<UserRecord>('users');
    this.sessions = this.db.collection<SessionRecord>('auth_sessions');

    await this.users.createIndex({ usernameLower: 1 }, { unique: true });
    await this.sessions.createIndex({ tokenHash: 1 }, { unique: true });
    await this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  async shutdown(): Promise<void> {
    await this.client.close();
  }

  async signup(username: string, password: string): Promise<{ token: string; user: AuthenticatedUser }> {
    this.ensureStarted();

    const usernameError = validateUsername(username);
    if (usernameError) {
      throw new Error(usernameError);
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const normalizedUsername = normalizeUsername(username);
    const lower = normalizedUsername.toLowerCase();
    const existing = await this.users!.findOne({ usernameLower: lower });
    if (existing) {
      throw new Error('Username is already taken');
    }

    const now = Date.now();
    const user: UserRecord = {
      userId: randomUUID(),
      username: normalizedUsername,
      usernameLower: lower,
      passwordSalt: randomBytes(16).toString('hex'),
      passwordHash: '',
      createdAt: now,
      lastSignedInAt: now,
      passwordUpdatedAt: now,
    };
    user.passwordHash = hashPassword(password, user.passwordSalt);

    await this.users!.insertOne(user);
    return this.createSession(user);
  }

  async login(username: string, password: string): Promise<{ token: string; user: AuthenticatedUser }> {
    this.ensureStarted();

    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || !password) {
      throw new Error('Username and password are required');
    }

    const user = await this.users!.findOne({ usernameLower: normalizedUsername.toLowerCase() });
    if (!user) {
      throw new Error('Invalid username or password');
    }

    const expectedHash = Buffer.from(user.passwordHash, 'hex');
    const candidateHash = Buffer.from(hashPassword(password, user.passwordSalt), 'hex');
    if (expectedHash.length !== candidateHash.length || !timingSafeEqual(expectedHash, candidateHash)) {
      throw new Error('Invalid username or password');
    }

    const now = Date.now();
    const updatedUser = {
      ...user,
      lastSignedInAt: now,
    };

    await this.users!.updateOne(
      { userId: user.userId },
      { $set: { lastSignedInAt: now } },
    );

    return this.createSession(updatedUser);
  }

  async getUserFromToken(token: string | null | undefined): Promise<AuthenticatedUser | null> {
    this.ensureStarted();
    if (!token) {
      return null;
    }

    const session = await this.sessions!.findOne({ tokenHash: hashToken(token) });
    if (!session) {
      return null;
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions!.deleteOne({ sessionId: session.sessionId });
      return null;
    }

    const user = await this.users!.findOne({ userId: session.userId });
    if (!user) {
      await this.sessions!.deleteOne({ sessionId: session.sessionId });
      return null;
    }

    const now = Date.now();
    await this.sessions!.updateOne(
      { sessionId: session.sessionId },
      { $set: { lastUsedAt: now, expiresAt: new Date(now + SESSION_TTL_MS) } },
    );

    return mapUser(user, now);
  }

  async updateUsername(userId: string, username: string): Promise<AuthenticatedUser> {
    this.ensureStarted();

    const usernameError = validateUsername(username);
    if (usernameError) {
      throw new Error(usernameError);
    }

    const normalizedUsername = normalizeUsername(username);
    const usernameLower = normalizedUsername.toLowerCase();
    const existing = await this.users!.findOne({ usernameLower, userId: { $ne: userId } });
    if (existing) {
      throw new Error('Username is already taken');
    }

    const updateResult = await this.users!.updateOne(
      { userId },
      { $set: { username: normalizedUsername, usernameLower } },
    );

    if (updateResult.matchedCount === 0) {
      throw new Error('User not found');
    }

    const updatedUser = await this.users!.findOne({ userId });
    if (!updatedUser) {
      throw new Error('User not found');
    }

    return mapUser(updatedUser);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    this.ensureStarted();

    if (!currentPassword) {
      throw new Error('Current password is required');
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const user = await this.users!.findOne({ userId });
    if (!user) {
      throw new Error('User not found');
    }

    const expectedHash = Buffer.from(user.passwordHash, 'hex');
    const candidateHash = Buffer.from(hashPassword(currentPassword, user.passwordSalt), 'hex');
    if (expectedHash.length !== candidateHash.length || !timingSafeEqual(expectedHash, candidateHash)) {
      throw new Error('Current password is incorrect');
    }

    const nextSalt = randomBytes(16).toString('hex');
    await this.users!.updateOne(
      { userId },
      {
        $set: {
          passwordSalt: nextSalt,
          passwordHash: hashPassword(newPassword, nextSalt),
          passwordUpdatedAt: Date.now(),
        },
      },
    );
  }

  async logout(token: string | null | undefined): Promise<void> {
    this.ensureStarted();
    if (!token) {
      return;
    }

    await this.sessions!.deleteOne({ tokenHash: hashToken(token) });
  }

  private async createSession(user: UserRecord): Promise<{ token: string; user: AuthenticatedUser }> {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();

    await this.sessions!.insertOne({
      sessionId: randomUUID(),
      userId: user.userId,
      tokenHash: hashToken(token),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now + SESSION_TTL_MS),
    });

    return { token, user: mapUser(user, now) };
  }

  private ensureStarted(): void {
    if (!this.db || !this.users || !this.sessions) {
      throw new Error('AuthService has not been started');
    }
  }
}

