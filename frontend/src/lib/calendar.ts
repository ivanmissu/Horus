/**
 * Month-grid maths for <DatePicker>, kept pure so the selectable range is unit-testable.
 *
 * Everything is computed from calendar fields with `Date.UTC`, never from the runtime
 * timezone: Horus treats 北京时间 as the authority for "今天" (see `todayString`), and a
 * picker that disagreed with the dashboard would let users pick a date the 逾期 rules
 * already consider past. Callers therefore pass `today`/`min` as YYYY-MM-DD strings.
 */

export type CalendarCell = {
  iso: string;
  day: number;
  /** True for days of the viewed month; leading/trailing days belong to neighbours. */
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  /** Out of the allowed range (before `min`) — must not be clickable. */
  disabled: boolean;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** Build/normalize a calendar date from plain fields without any timezone conversion. */
function dayFrom(year: number, monthIndex: number, day: number) {
  const shifted = new Date(Date.UTC(year, monthIndex, day));
  return { year: shifted.getUTCFullYear(), monthIndex: shifted.getUTCMonth(), day: shifted.getUTCDate(), iso: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` };
}

/** Monday-first weekday index of a calendar day (0 = Monday .. 6 = Sunday). */
function weekdayMondayFirst(year: number, monthIndex: number, day: number) {
  return (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() + 6) % 7;
}

/**
 * Six weeks (42 cells) covering `viewYear`/`viewMonth` (0-based), with leading and trailing
 * neighbour-month days muted. `min` (inclusive) disables every earlier day.
 */
export function buildMonthCells({ viewYear, viewMonth, today, min, selected }: {
  viewYear: number;
  /** 0-based, matching `Date#getMonth()`. */
  viewMonth: number;
  today: string;
  min?: string | null;
  selected?: string | null;
}): CalendarCell[] {
  const first = dayFrom(viewYear, viewMonth, 1);
  const offset = weekdayMondayFirst(first.year, first.monthIndex, first.day);
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const slot = dayFrom(first.year, first.monthIndex, index - offset + 1);
    cells.push({
      ...slot,
      isCurrentMonth: slot.monthIndex === first.monthIndex,
      isToday: slot.iso === today,
      isSelected: !!selected && slot.iso === selected,
      disabled: !!min && slot.iso < min,
    });
  }
  return cells;
}

/** Days before the first of a month can never be reachable, so compare month starts. */
export function canGoPreviousMonth(viewYear: number, viewMonth: number, min?: string | null) {
  if (!min) return true;
  return dayFrom(viewYear, viewMonth, 1).iso > min.slice(0, 8) + "01";
}

/**
 * The earliest date the picker may offer for a given field.
 * New requirements start no earlier than today; editing an existing requirement keeps an
 * already-recorded earlier date selectable, so saving (or nudging it later) never breaks.
 */
export function selectableFloor(existing: string | null | undefined, today: string) {
  return existing && existing < today ? existing : today;
}
