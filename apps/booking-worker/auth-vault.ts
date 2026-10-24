import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const SNAPSHOT_NAME = 'snapshot.vault';
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

type SnapshotEnvelope = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

type SnapshotPayload = {
  version: 1;
  files: Record<string, string>;
};

export class AuthVaultError extends Error {
  readonly code: 'CONFIG' | 'UNAVAILABLE' | 'CORRUPT' | 'IO';

  constructor(message: string, code: 'CONFIG' | 'UNAVAILABLE' | 'CORRUPT' | 'IO') {
    super(message);
    this.name = 'AuthVaultError';
    this.code = code;
  }
}

export interface AuthVaultOptions {
  /** Persistent root. Only encrypted snapshots are stored below this directory. */
  directory: string;
  /** Exactly 32 bytes encoded as 64 hex characters; inject from a secret manager. */
  keyHex?: string;
  /** Private scratch root for short-lived plaintext CLI state. Defaults to OS temp. */
  tempDirectory?: string;
}

/**
 * Encrypts Link CLI's complete per-user working directory at rest. `run` materializes
 * every saved artifact in a private temporary directory, lets the CLI update it, then
 * re-encrypts all regular files (including pending-device-auth sidecars) before cleanup.
 */
export class AuthVault {
  private readonly root: string;
  private readonly scratchRoot: string;
  private readonly key: Buffer | null;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: AuthVaultOptions) {
    if (!options.directory || !isAbsolutePath(options.directory)) {
      throw new AuthVaultError('Auth vault directory must be an absolute path.', 'CONFIG');
    }
    this.root = resolve(options.directory);
    this.scratchRoot = resolve(options.tempDirectory ?? tmpdir());
    if (options.keyHex === undefined || options.keyHex === '') {
      this.key = null;
    } else if (!/^[a-fA-F0-9]{64}$/.test(options.keyHex)) {
      throw new AuthVaultError('Auth vault encryption key must be exactly 32 bytes of hex.', 'CONFIG');
    } else {
      this.key = Buffer.from(options.keyHex, 'hex');
    }
  }

  /** Serialize a single buyer's Link CLI session and provide its temporary --auth path. */
  async run<T>(userKey: string, callback: (authFile: string) => Promise<T>): Promise<T> {
    const key = this.requireKey();
    if (!userKey.trim()) throw new AuthVaultError('A user key is required for the auth vault.', 'CONFIG');
    const userHash = createHash('sha256').update(userKey).digest('hex');
    return this.withUserLock(userHash, async () => {
      const userDirectory = join(this.root, userHash);
      const snapshotPath = join(userDirectory, SNAPSHOT_NAME);
      let scratchDirectory: string | undefined;
      let result!: T;
      let callbackError: unknown;
      let callbackFailed = false;

      try {
        await this.ensurePrivateDirectory(this.root);
        await this.ensurePrivateDirectory(userDirectory);
        scratchDirectory = await this.makeScratchDirectory();
        const existing = await this.readEncryptedSnapshot(snapshotPath, userHash, key);
        await this.materializeFiles(scratchDirectory, existing);

        const authFile = join(scratchDirectory, 'auth.json');
        try {
          result = await callback(authFile);
        } catch (error) {
          callbackFailed = true;
          callbackError = error;
        }

        const files = await this.collectFiles(scratchDirectory);
        const envelope = this.encryptSnapshot(userHash, key, files);
        await this.writeEncryptedSnapshot(snapshotPath, userDirectory, envelope);
      } catch (error) {
        if (error instanceof AuthVaultError) throw error;
        throw new AuthVaultError('Could not safely read or persist the encrypted Link auth session.', 'IO');
      } finally {
        if (scratchDirectory) {
          try {
            await rm(scratchDirectory, { recursive: true, force: true });
          } catch {
            throw new AuthVaultError('Could not remove the temporary Link auth directory.', 'IO');
          }
        }
      }

      if (callbackFailed) throw callbackError;
      return result;
    });
  }

  private requireKey(): Buffer {
    if (!this.key) throw new AuthVaultError('Encrypted Link auth storage is unavailable: configure a 32-byte encryption key.', 'UNAVAILABLE');
    return this.key;
  }

  private async withUserLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const queued = previous.then(() => gate);
    this.locks.set(key, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }

  private async ensurePrivateDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
      throw new AuthVaultError('Auth vault directory permissions are not private.', 'CONFIG');
    }
  }

  private async makeScratchDirectory(): Promise<string> {
    try {
      const info = await stat(this.scratchRoot);
      if (!info.isDirectory()) throw new AuthVaultError('Auth vault scratch path is not a directory.', 'CONFIG');
      if ((info.mode & 0o077) !== 0) {
        // Use an isolated 0700 child even when the system temp parent is shared.
      }
    } catch (error) {
      if (error instanceof AuthVaultError) throw error;
      throw new AuthVaultError('Auth vault scratch directory is unavailable.', 'UNAVAILABLE');
    }
    const path = await mkdtemp(join(this.scratchRoot, 'link-auth-'));
    await chmod(path, 0o700);
    return path;
  }

  private async readEncryptedSnapshot(path: string, userHash: string, key: Buffer): Promise<Map<string, Buffer>> {
    let raw: Buffer;
    try {
      raw = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw error;
    }
    if (raw.byteLength > MAX_SNAPSHOT_BYTES) throw new AuthVaultError('Encrypted auth snapshot is too large.', 'CORRUPT');
    let envelope: SnapshotEnvelope;
    try {
      envelope = JSON.parse(raw.toString('utf8')) as SnapshotEnvelope;
    } catch {
      throw new AuthVaultError('Encrypted auth snapshot is invalid.', 'CORRUPT');
    }
    if (envelope.version !== 1 || !isBase64(envelope.iv) || !isBase64(envelope.tag) || !isBase64(envelope.ciphertext)) {
      throw new AuthVaultError('Encrypted auth snapshot has an invalid format.', 'CORRUPT');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(userHash));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
      const payload = JSON.parse(plaintext.toString('utf8')) as SnapshotPayload;
      if (payload.version !== 1 || !payload.files || typeof payload.files !== 'object' || Array.isArray(payload.files)) {
        throw new Error('bad payload');
      }
      const files = new Map<string, Buffer>();
      for (const [relativePath, contents] of Object.entries(payload.files)) {
        if (!isSafeRelativePath(relativePath) || !isBase64(contents)) throw new Error('bad file record');
        files.set(relativePath, Buffer.from(contents, 'base64'));
      }
      return files;
    } catch {
      throw new AuthVaultError('Encrypted auth snapshot authentication failed.', 'CORRUPT');
    }
  }

  private async materializeFiles(root: string, files: Map<string, Buffer>): Promise<void> {
    for (const [relativePath, contents] of files) {
      const destination = join(root, ...relativePath.split('/'));
      const parent = destination.slice(0, destination.lastIndexOf(sep));
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await chmod(parent, 0o700);
      await writeFile(destination, contents, { mode: 0o600, flag: 'wx' });
      await chmod(destination, 0o600);
    }
  }

  private async collectFiles(root: string): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>();
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        const relativePath = relative(root, fullPath).split(sep).join('/');
        if (!isSafeRelativePath(relativePath)) throw new AuthVaultError('Auth CLI wrote an unsafe session path.', 'IO');
        const info = await lstat(fullPath);
        if (info.isSymbolicLink()) throw new AuthVaultError('Auth CLI wrote a symbolic link into its session directory.', 'IO');
        if (entry.isDirectory()) {
          await visit(fullPath);
        } else if (entry.isFile()) {
          if ((info.mode & 0o077) !== 0) await chmod(fullPath, 0o600);
          files.set(relativePath, await readFile(fullPath));
          if (files.size > 100) throw new AuthVaultError('Auth CLI created too many session artifacts.', 'IO');
        } else {
          throw new AuthVaultError('Auth CLI wrote an unsupported session artifact.', 'IO');
        }
      }
    };
    await visit(root);
    return files;
  }

  private encryptSnapshot(userHash: string, key: Buffer, files: Map<string, Buffer>): SnapshotEnvelope {
    const payload: SnapshotPayload = {
      version: 1,
      files: Object.fromEntries([...files.entries()].map(([path, contents]) => [path, contents.toString('base64')])),
    };
    const plaintext = Buffer.from(JSON.stringify(payload));
    if (plaintext.byteLength > MAX_SNAPSHOT_BYTES) throw new AuthVaultError('Auth session exceeds the vault size limit.', 'IO');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(userHash));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private async writeEncryptedSnapshot(path: string, directory: string, envelope: SnapshotEnvelope): Promise<void> {
    const tempPath = join(directory, `.snapshot-${randomUUID()}.tmp`);
    try {
      const handle = await open(tempPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(envelope));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(tempPath, 0o600);
      await rename(tempPath, path);
      await chmod(path, 0o600);
    } finally {
      await rm(tempPath, { force: true });
    }
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function isSafeRelativePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.includes('\\') &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function isBase64(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
