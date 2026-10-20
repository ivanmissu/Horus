import type { Requirement, RequirementEventType } from "./types";

/**
 * A lifecycle event ready to be inserted into horus_requirement_events.
 * `estimated` is reserved for events reconstructed from requirement timestamps
 * (or from the current blocked flag) instead of being written at action time.
 */
export type DerivedEvent = {
  requirementId: number;
  teamId: string;
  type: RequirementEventType;
  detail: Record<string, unknown>;
  estimated: boolean;
  createdAt: string;
};

type AuditLogLike = {
  requirementId: number | null;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

/**
 * Legacy fallback used by the read-only preview and as the last resort for
 * databases created before lifecycle events existed. `created` is exact;
 * every other event is marked estimated because its timestamp comes from a
 * requirement column rather than the moment the action happened.
 */
export function deriveEventsFromRequirements(requirements: Requirement[]): DerivedEvent[] {
  const events: DerivedEvent[] = [];
  for (const r of requirements) {
    events.push({ requirementId: r.id, teamId: r.teamId, type: "created", detail: {}, estimated: false, createdAt: r.createdAt });
    if (r.status === "released") {
      events.push({ requirementId: r.id, teamId: r.teamId, type: "released", detail: { stageId: r.stageId }, estimated: !r.releasedAt, createdAt: r.releasedAt || r.enteredAt });
      if (r.archivedAt) events.push({ requirementId: r.id, teamId: r.teamId, type: "archived", detail: {}, estimated: false, createdAt: r.archivedAt });
    } else if (r.status === "cancelled") {
      const cancelledAt = r.cancelledAt || r.archivedAt || r.updatedAt;
      events.push({ requirementId: r.id, teamId: r.teamId, type: "cancelled", detail: {}, estimated: !r.cancelledAt && !r.archivedAt, createdAt: cancelledAt });
    }
    if (r.blocked) {
      events.push({ requirementId: r.id, teamId: r.teamId, type: "blocked", detail: { reason: r.blockReason }, estimated: true, createdAt: r.updatedAt || r.createdAt });
    }
  }
  return events;
}

/**
 * Builds the one-time backfill for existing installations. Exact audit-log
 * actions win over field-derived estimates; a type is only estimated when the
 * audit trail has no usable event for it.
 */
export function buildBackfillEvents(requirements: Requirement[], logs: AuditLogLike[]): DerivedEvent[] {
  const exact = new Map<string, DerivedEvent[]>();
  const addExact = (event: DerivedEvent) => {
    const key = `${event.requirementId}:${event.type}`;
    const list = exact.get(key) ?? [];
    list.push(event);
    exact.set(key, list);
  };
  for (const log of logs) {
    if (log.requirementId === null) continue;
    const base = { requirementId: log.requirementId, detail: log.detail ?? {}, estimated: false, createdAt: log.createdAt };
    if (log.action === "createRequirement") {
      const requirement = requirements.find(r => r.id === log.requirementId);
      addExact({ ...base, teamId: requirement?.teamId ?? "", type: "created" });
    } else if (log.action === "advance" && log.detail?.status === "released") {
      const requirement = requirements.find(r => r.id === log.requirementId);
      addExact({ ...base, teamId: requirement?.teamId ?? "", type: "released" });
    } else if (log.action === "cancel") {
      const requirement = requirements.find(r => r.id === log.requirementId);
      addExact({ ...base, teamId: requirement?.teamId ?? "", type: "cancelled" });
    } else if (log.action === "archive") {
      const requirement = requirements.find(r => r.id === log.requirementId);
      addExact({ ...base, teamId: requirement?.teamId ?? "", type: "archived" });
    } else if (log.action === "block" && typeof log.detail?.blocked === "boolean") {
      const requirement = requirements.find(r => r.id === log.requirementId);
      addExact({ ...base, teamId: requirement?.teamId ?? "", type: log.detail.blocked ? "blocked" : "unblocked" });
    }
  }

  const derived = deriveEventsFromRequirements(requirements);
  const result = new Map<string, DerivedEvent>();
  for (const event of derived) {
    const exactEvents = exact.get(`${event.requirementId}:${event.type}`) ?? [];
    if (exactEvents.length) continue;
    result.set(`${event.requirementId}:${event.type}:${event.createdAt}`, event);
  }
  for (const [key, events] of exact) {
    for (const event of events) result.set(`${key}:${event.createdAt}`, event);
  }
  return [...result.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
