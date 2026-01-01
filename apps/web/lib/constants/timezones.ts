/**
 * Get all IANA timezones from the browser's Intl API
 * Falls back to a common subset if the API is not available
 */

// Get the current offset for a timezone
function getTimezoneOffset(tz: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    return offsetPart?.value || '';
  } catch {
    return '';
  }
}

// Get a human-readable label for a timezone
function getTimezoneLabel(tz: string): string {
  // Convert "America/New_York" to "New York"
  const parts = tz.split('/');
  const city = parts[parts.length - 1].replace(/_/g, ' ');
  const region = parts.length > 1 ? parts[0] : '';
  return region ? `${city} (${region})` : city;
}

// Get all supported timezones
export function getSupportedTimezones(): Array<{ value: string; label: string; offset: string }> {
  try {
    // Use Intl.supportedValuesOf if available (modern browsers)
    if ('supportedValuesOf' in Intl) {
      const timezones = (Intl as any).supportedValuesOf('timeZone') as string[];
      return timezones.map(tz => ({
        value: tz,
        label: getTimezoneLabel(tz),
        offset: getTimezoneOffset(tz),
      }));
    }
  } catch (e) {
    console.warn('Failed to get timezones from Intl API:', e);
  }

  // Fallback to common timezones
  return COMMON_TIMEZONES.map(tz => ({
    value: tz,
    label: getTimezoneLabel(tz),
    offset: getTimezoneOffset(tz),
  }));
}

// Common timezones fallback (if Intl.supportedValuesOf is not available)
const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Zurich',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
];

export type Timezone = string;
