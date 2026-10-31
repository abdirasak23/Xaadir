export const WEEKEND_DAYS = [5] as const;
export const TIMEZONE = "Africa/Mogadishu";

export function localDateInTimezone(date = new Date(), timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dateRange(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function isWeekend(date: string) {
  return WEEKEND_DAYS.includes(new Date(`${date}T00:00:00.000Z`).getUTCDay() as (typeof WEEKEND_DAYS)[number]);
}
