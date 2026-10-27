import * as mysqlSchema from "./schema.mysql.ts";
import * as postgresSchema from "./schema.postgres.ts";
import { databaseDialect } from "./dialect.ts";

export type Stage = mysqlSchema.Stage;
export type { RequirementEventType, PoolItemStatus } from "./schema.mysql.ts";

// Runtime schema selection must match the Drizzle driver selected by DATABASE_URL.
// The PostgreSQL model mirrors MySQL's inferred application types, so expose a
// common compile-time shape while preserving the provider-specific table objects.
const activeSchema = databaseDialect === "postgres" ? postgresSchema : mysqlSchema;
const asCommonTable = <T>(table: unknown) => table as T;

export const teams = asCommonTable<typeof mysqlSchema.teams>(activeSchema.teams);
export const members = asCommonTable<typeof mysqlSchema.members>(activeSchema.members);
export const requirements = asCommonTable<typeof mysqlSchema.requirements>(activeSchema.requirements);
export const requirementPool = asCommonTable<typeof mysqlSchema.requirementPool>(activeSchema.requirementPool);
export const sessions = asCommonTable<typeof mysqlSchema.sessions>(activeSchema.sessions);
export const auditLogs = asCommonTable<typeof mysqlSchema.auditLogs>(activeSchema.auditLogs);
export const requirementEvents = asCommonTable<typeof mysqlSchema.requirementEvents>(activeSchema.requirementEvents);
export const notificationSettings = asCommonTable<typeof mysqlSchema.notificationSettings>(activeSchema.notificationSettings);
export const notificationLogs = asCommonTable<typeof mysqlSchema.notificationLogs>(activeSchema.notificationLogs);

export const schema = activeSchema;
