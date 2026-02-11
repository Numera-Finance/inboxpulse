/**
 * Supported timezones for the application.
 * Used in user create/edit forms and user preferences.
 */
export const SUPPORTED_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'America/New_York', label: 'US Eastern (EST)' },
  { value: 'America/Chicago', label: 'US Central (CST)' },
  { value: 'America/Denver', label: 'US Mountain (MST)' },
  { value: 'America/Los_Angeles', label: 'US Pacific (PST)' },
] as const;
