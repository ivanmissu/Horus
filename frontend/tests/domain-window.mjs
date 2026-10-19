import assert from "node:assert/strict";
import { canArchive, isArchived, isFocused, isInFlight, isNew, newWindowDays, parseNewWindowDays, shanghaiClock } from "../src/lib/domain.ts";

const previousHorus = process.env.HORUS_NEW_WINDOW_DAYS;
const previousPublic = process.env.NEXT_PUBLIC_NEW_WINDOW_DAYS;

function restoreEnv() {
  if (previousHorus === undefined) delete process.env.HORUS_NEW_WINDOW_DAYS;
  else process.env.HORUS_NEW_WINDOW_DAYS = previousHorus;
  if (previousPublic === undefined) delete process.env.NEXT_PUBLIC_NEW_WINDOW_DAYS;
  else process.env.NEXT_PUBLIC_NEW_WINDOW_DAYS = previousPublic;
}

try {
  delete process.env.HORUS_NEW_WINDOW_DAYS;
  delete process.env.NEXT_PUBLIC_NEW_WINDOW_DAYS;
  assert.equal(newWindowDays(), 7);
  assert.equal(parseNewWindowDays("0"), undefined);
  assert.equal(parseNewWindowDays("91"), undefined);
  assert.equal(parseNewWindowDays("7.5"), undefined);
  assert.equal(parseNewWindowDays("nope"), undefined);

  process.env.NEXT_PUBLIC_NEW_WINDOW_DAYS = "14";
  assert.equal(newWindowDays(), 14);
  process.env.HORUS_NEW_WINDOW_DAYS = "3";
  assert.equal(newWindowDays(), 3, "runtime HORUS_NEW_WINDOW_DAYS overrides the public build value");
  process.env.HORUS_NEW_WINDOW_DAYS = "bad";
  assert.equal(newWindowDays(), 14, "invalid runtime value falls back to NEXT_PUBLIC_NEW_WINDOW_DAYS");

  const now = "2026-10-16T12:00:00.000Z";
  const justInside = new Date(new Date(now).getTime() - 7 * 86400000 + 1).toISOString();
  const exact = new Date(new Date(now).getTime() - 7 * 86400000).toISOString();
  const active = status => ({ status, createdAt: justInside, blocked: false, priority: "low", expectedDate: null });
  assert.equal(isNew(active("active"), now, 7), true);
  assert.equal(isNew({ status: "active", createdAt: exact }, now, 7), false);
  assert.equal(isNew({ status: "active", createdAt: exact }, now, 8), true);
  assert.equal(isNew(active("released"), now, 7), false);
  assert.equal(isFocused({ status: "active", createdAt: exact, blocked: true, priority: "low", expectedDate: null }, now, 7), true);
  assert.equal(isFocused({ status: "active", createdAt: exact, blocked: false, priority: "low", expectedDate: null }, now, 7), false);
  assert.equal(isArchived({ archivedAt: "2026-10-16T00:00:00.000Z" }), true);
  assert.equal(isArchived({ archivedAt: null }), false);
  assert.equal(isInFlight({ archivedAt: null }), true);
  assert.equal(canArchive({ status: "released", archivedAt: null }), true);
  assert.equal(canArchive({ status: "released", archivedAt: "2026-10-16T00:00:00.000Z" }), false);
  assert.equal(canArchive({ status: "active", archivedAt: null }), false);
  assert.equal(shanghaiClock("2026-10-16T01:30:00.000Z"), "09:30");
  assert.match(shanghaiClock(), /^\d{2}:\d{2}$/);
  console.log("DOMAIN WINDOW TESTS PASSED");
} finally {
  restoreEnv();
}
