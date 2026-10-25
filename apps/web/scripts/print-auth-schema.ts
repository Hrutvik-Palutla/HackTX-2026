// Read-only schema handoff to Part 2. Never runs migrations.
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAccountAuth } from "../lib/auth/config";
async function main() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const auth = createAccountAuth(pool, async () => {
      throw Error("OTP delivery is disabled in the schema tool");
    });
    const migration = await getMigrations(auth.options);
    process.stdout.write(await migration.compileMigrations());
  } finally {
    await pool.end();
  }
}
void main().catch(() => {
  process.stderr.write(
    "Unable to compile auth schema. Check database access and BETTER_AUTH_SECRET.\n",
  );
  process.exitCode = 1;
});
