// The web and messaging worker read the same selection and fulfillment state.
import type { Db } from '@hacktx/db';
import { createSharedFulfillment, synchronizeFulfillment } from '@hacktx/integrations/fulfillment';
import { installPart4Runtime } from '@hacktx/fulfillment/http';
import type { PgPool } from '@hacktx/fulfillment/postgres';
export function configurePart4(db: Db, pool: PgPool, getUserId: (request: Request) => Promise<string | null>) {
  const part4 = createSharedFulfillment({ db, pool,
    authenticate: async request => { const userId = await getUserId(request); return userId ? { userId, source: 'web' } : null; },
    authorizeMutation: async request => request.headers.get('origin') === new URL(process.env.BETTER_AUTH_URL || process.env.APP_BASE_URL || request.url).origin,
  });
  installPart4Runtime({ ...part4.runtime, afterMutation: () => synchronizeFulfillment(db, part4.service) });
}
