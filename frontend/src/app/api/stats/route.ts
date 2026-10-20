import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requirementEvents, requirements, teams } from "@/db/schema";
import { ensureStatsBaseline } from "@/db/backfill-events";
import { AppError, getActor } from "@/lib/auth";
import { deriveEventsFromRequirements } from "@/lib/events";
import { isPreviewMode } from "@/lib/preview";
import { previewWorkspace } from "@/lib/preview-data";
import { buildStats, statsPeriods } from "@/lib/stats";
import type { StatsGranularity } from "@/lib/types";

export const dynamic = "force-dynamic";

function fail(error: unknown) {
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Horus statistics request failed", error);
  return NextResponse.json({ error: "暂时无法加载统计数据，请稍后重试" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const granularity: StatsGranularity = params.get("granularity") === "month" ? "month" : "week";
    const fallback = statsPeriods(granularity);
    const requestedRaw = params.get("periods");
    const requested = requestedRaw === null ? NaN : Number(requestedRaw);
    const min = granularity === "week" ? 4 : 3;
    const max = granularity === "week" ? 26 : 12;
    const periods = Number.isInteger(requested) ? Math.min(Math.max(requested, min), max) : fallback;
    const teamId = params.get("teamId")?.trim() || undefined;
    const now = new Date().toISOString();

    if (isPreviewMode()) {
      const snapshot = previewWorkspace();
      return NextResponse.json(buildStats({
        requirements: snapshot.requirements,
        events: deriveEventsFromRequirements(snapshot.requirements),
        teams: snapshot.teams,
        now,
        granularity,
        periods,
        teamId,
      }), { headers: { "Cache-Control": "no-store" } });
    }

    await getActor();
    await ensureStatsBaseline();
    const [allTeams, allRequirements, allEvents] = await Promise.all([
      db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams),
      db.select().from(requirements),
      db.select({
        requirementId: requirementEvents.requirementId,
        type: requirementEvents.type,
        createdAt: requirementEvents.createdAt,
        estimated: requirementEvents.estimated,
      }).from(requirementEvents),
    ]);
    return NextResponse.json(buildStats({
      requirements: allRequirements,
      events: allEvents,
      teams: allTeams,
      now,
      granularity,
      periods,
      teamId,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
