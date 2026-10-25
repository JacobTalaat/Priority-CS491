import type { TodayAssignment } from "./today-client";

export const HOURS_PER_ASSIGNMENT = 1;
export const MIN_EVENING_HOURS = 0.5;
export const MAX_EVENING_HOURS = 12;

export function assignmentsThatFit(
  assignments: TodayAssignment[],
  hoursAvailable: number | null,
): TodayAssignment[] {
  if (hoursAvailable === null) {
    return assignments;
  }
  const count = Math.floor(hoursAvailable / HOURS_PER_ASSIGNMENT);
  return assignments.slice(0, count);
}

export function validEveningHours(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const hours = Number(value);
  if (
    !Number.isFinite(hours) ||
    hours < MIN_EVENING_HOURS ||
    hours > MAX_EVENING_HOURS
  ) {
    return null;
  }
  return hours;
}
