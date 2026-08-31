import type { DateRange } from "./types.js";

const DAY_MS = 86_400_000;

function parseDate(date: string): Date {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO date: ${date}`);
  }
  return parsed;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysInRange(range: DateRange): number {
  return Math.floor((parseDate(range.end).getTime() - parseDate(range.start).getTime()) / DAY_MS) + 1;
}

export function splitDateRange(range: DateRange): [DateRange, DateRange] | null {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  const days = daysInRange(range);
  if (days <= 1) return null;

  const leftDays = Math.floor(days / 2);
  const leftEnd = new Date(start.getTime() + (leftDays - 1) * DAY_MS);
  const rightStart = new Date(leftEnd.getTime() + DAY_MS);

  return [
    { start: range.start, end: formatDate(leftEnd) },
    { start: formatDate(rightStart), end: formatDate(end) },
  ];
}
