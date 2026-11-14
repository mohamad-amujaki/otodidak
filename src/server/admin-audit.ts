import type { Database } from '../db/client';
import { adminAudit } from '../db/schema';
import { nowIso } from '../domain/time';

export type AdminAuditAction = 'user_update' | 'learning_erase' | 'job_requeue';

export async function recordAdminAudit(
  db: Database,
  input: {
    actorId: string;
    action: AdminAuditAction;
    targetId?: string | null;
    detail?: string | null;
  },
): Promise<void> {
  await db.insert(adminAudit).values({
    id: crypto.randomUUID(),
    actorId: input.actorId,
    action: input.action,
    targetId: input.targetId ?? null,
    detail: input.detail ?? null,
    createdAt: nowIso(),
  });
}
