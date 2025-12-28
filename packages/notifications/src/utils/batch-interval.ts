/**
 * Batch interval calculation utilities
 */

import { addMinutes, addHours, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { BatchInterval } from '../types/core';

/**
 * Calculate scheduled time (releaseAt) for batch interval
 * All modes use the same unified mechanism
 */
export function calculateScheduledTime(
  batchInterval: BatchInterval,
  userTimezone: string = 'UTC'
): Date {
  const now = new Date();
  
  switch (batchInterval.type) {
    case 'immediate':
      return now;
      
    case 'minutes':
      const minutesLater = addMinutes(now, batchInterval.value);
      // Round to next interval boundary
      return roundToMinutes(minutesLater, batchInterval.value);
      
    case 'hours':
      const hoursLater = addHours(now, batchInterval.value);
      // Round to next interval boundary
      return roundToHours(hoursLater, batchInterval.value);
      
    case 'end_of_day':
      // Calculate end of day in user's timezone, convert to UTC
      const userNow = toZonedTime(now, userTimezone);
      const endOfDayLocal = endOfDay(userNow);
      return fromZonedTime(endOfDayLocal, userTimezone);
      
    case 'custom':
      return batchInterval.scheduledFor;
  }
}

/**
 * Round time to next N-minute boundary
 */
function roundToMinutes(date: Date, minutes: number): Date {
  const ms = minutes * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

/**
 * Round time to next N-hour boundary
 */
function roundToHours(date: Date, hours: number): Date {
  const ms = hours * 60 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}
