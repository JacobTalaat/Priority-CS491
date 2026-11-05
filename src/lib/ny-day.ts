// The New York calendar day YYYY-MM-DD is the day key everywhere item state is
// read or stored (a skip hides an item for the day it was skipped on), so skip
// and the today list must never disagree on what "today" means.
// en-CA formats Gregorian dates as YYYY-MM-DD.
const NY_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function nyDayOf(date: Date): string {
  // formatToParts instead of trusting the formatted string's shape, so the
  // day key survives a locale data change reordering the pieces.
  const parts = NY_DAY_FORMATTER.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((entry) => entry.type === type);
    return found ? found.value : "";
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}
