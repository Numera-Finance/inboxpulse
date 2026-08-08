/**
 * Shape of the request Google POSTs to an HTTP add-on endpoint when a trigger
 * fires. Only the fields we use are typed.
 * https://developers.google.com/workspace/add-ons/guides/alternate-runtimes
 */
export interface AddonEvent {
  commonEventObject?: {
    hostApp?: string;
    platform?: string;
    /**
     * Parameters attached to the action that fired this request (the `parameters`
     * of an `onClick.action`), delivered as a flat string map.
     */
    parameters?: Record<string, string>;
  };
  authorizationEventObject?: {
    userOAuthToken?: string;
    systemIdToken?: string;
    userIdToken?: string;
  };
  gmail?: {
    messageId?: string;
    threadId?: string;
    accessToken?: string;
  };
}

/** Action parameters attached to the clicked widget ({} when absent). */
export function getActionParameters(event: AddonEvent): Record<string, string> {
  return event.commonEventObject?.parameters ?? {};
}

export function getGmail(event: AddonEvent) {
  return {
    messageId: event.gmail?.messageId,
    threadId: event.gmail?.threadId,
    /** Per-message token; send as X-Goog-Gmail-Access-Token when calling Gmail. */
    accessToken: event.gmail?.accessToken,
    /** User OAuth token; send as a bearer token when calling Gmail/Google APIs. */
    oauthToken: event.authorizationEventObject?.userOAuthToken,
  };
}
