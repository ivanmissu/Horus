// SQL scripts and older databases may contain SQL NULL or JSON null for this
// field. Drizzle's $defaultFn only applies to inserts made through the ORM.
export function normalizePendingItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
