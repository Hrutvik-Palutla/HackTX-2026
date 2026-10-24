import { mkdir, readFile, rename, open, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MemoryRepository, emptyState } from './repository.ts';
import type { RepositoryState } from './repository.ts';

/** Durable local/demo adapter, one process only. Use the Postgres adapter for shared deployment. */
export class FileRepository extends MemoryRepository {
  private readonly path: string;
  private constructor(path: string, initial: RepositoryState) { super(initial); this.path = path; }

  static async load(path: string): Promise<FileRepository> {
    let data = emptyState();
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as RepositoryState;
      if (parsed.schemaVersion !== 1 || !parsed.quotes || !parsed.effects || !parsed.deliveries || !parsed.authorizations || !parsed.bookings || !parsed.reimbursements || !parsed.changes) {
        throw new Error('Unsupported fulfillment data file.');
      }
      data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    return new FileRepository(path, data);
  }

  protected override async persist(next: RepositoryState): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(next)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, this.path);
  }
}
