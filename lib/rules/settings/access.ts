/**
 * Settings permissions live in `lib/rules/admin/access.ts`.
 *
 * This module used to define its own `maySettings` / `mayReadAuditLog` beside
 * `mayOpenAdmin`'s separate answer — two definitions of "administrator", and
 * which one applied depended on the call path. It re-exports now rather than
 * being deleted so the existing call sites keep working while there is exactly
 * one place the question is answered.
 */
export {
  canModifySettings as maySettings,
  canViewAuditLogs as mayReadAuditLog,
  AUDIT_REFUSAL,
  SETTINGS_REFUSAL,
} from "../admin/access.ts";
export type { RoleArchetype as Archetype } from "@/lib/domain/identity";
