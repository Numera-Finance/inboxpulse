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
    /**
     * Message content supplied by a NON-Google caller.
     *
     * Google never sends this: it sends `accessToken`, and the add-on fetches
     * the bodies itself. The Chrome extension has no Gmail credential of any
     * kind — no `identity` permission, no OAuth client, `gmail.googleapis.com`
     * absent from host_permissions — so on that path there is nothing to fetch
     * with, and the content script reads the open conversation off Gmail's own
     * DOM instead (`messageView.getBodyElement()`).
     *
     * IT IS THE CALLER'S TEXT, NOT THE MAILBOX'S. Nothing here is verified
     * against Gmail, so it may only ever be used to analyse and store the
     * message the caller is already looking at. It must never be treated as
     * evidence that a message EXISTS, that it says what it claims, or that this
     * viewer is entitled to it — the entitlement questions are answered by
     * crm-api against the viewer's own identity, exactly as before.
     *
     * Ordered oldest first, matching fetchThreadMessages().
     */
    messages?: Array<{
      id?: string;
      from?: string;
      subject?: string;
      to?: string[];
      date?: string;
      body?: string;
    }>;
  };
  /**
   * The viewer's address, supplied by a NON-Google caller.
   *
   * Google never sends this — it identifies the user through the signed
   * `userIdToken` above. It exists for the Chrome extension, which renders these
   * same cards in Gmail's rail and cannot mint a Google-signed token. Without an
   * address the homepage skips `resolveViewer`, and both entitlement-scoped
   * sections ("Where the fires are", "Unhappy clients left waiting") vanish
   * rather than reporting that they could not be scoped.
   *
   * IT IS A CLAIM, NOT A PROOF. `auth/verify.ts` honours it only inside the
   * branch where ADDON_VERIFY_ID_TOKEN is off — which already trusts the caller
   * completely — and never above that guard.
   */
  devViewerEmail?: string;
  /**
   * The caller can draw, so send the chart specs beside the card.
   *
   * NOT AN AUTHORIZATION CLAIM, and worth being explicit about because the field
   * above IS one. This says only "I am a renderer that can do better than block
   * characters". The specs it turns on carry no datum the card does not already
   * carry in its widgets — they are the same numbers in a shape something can
   * plot. Nothing is disclosed by asking, so nothing is gated on it.
   *
   * What IS gated is where the extra key may appear. A trigger response is
   * parsed by Google directly as a `RenderActions` proto, which rejects unknown
   * fields — "Cannot find field: renderActions in message …RenderActions" is the
   * error this codebase already collected once (see cards/widgets.ts). So a
   * `charts` key beside the card would not degrade in Gmail, it would fail the
   * whole card. Google never sets this flag, and the handler additionally
   * refuses to emit the key while ADDON_VERIFY_ID_TOKEN is on, so the response
   * Google actually receives cannot grow one.
   */
  chartSpecs?: boolean;

  /**
   * Which chart SHAPES the caller can actually draw. Absent means bars only.
   *
   * `chartSpecs` says "I can plot"; this says what. The distinction matters
   * because the extension is built and shipped separately from this service, so
   * an add-on that learns a new shape will be talking to panels that predate it.
   *
   * And the failure is silent in the worst way: the renderer finds a chart by its
   * TITLE and then consumes `fallbackWidgets` widgets, so a shape it does not
   * recognise does not degrade — it deletes the card's own correct rendering and
   * draws whatever it falls through to. A composition arriving at a
   * bars-only renderer comes out as a ranking, under a note explaining that the
   * longest bar is the busiest client. The quantity is wrong and it looks fine.
   *
   * So the shapes are negotiated rather than assumed, and the default is the one
   * shape every renderer that has ever existed can draw. A spec withheld costs
   * the SVG and nothing else: the card still carries the same numbers.
   */
  chartKinds?: string[];
}

/** Action parameters attached to the clicked widget ({} when absent). */
export function getActionParameters(event: AddonEvent): Record<string, string> {
  return event.commonEventObject?.parameters ?? {};
}

/**
 * Thread content the caller supplied, in the shape fetchThreadMessages returns,
 * so a caller-supplied thread and a Gmail-fetched one are interchangeable
 * downstream. Empty when Google is the caller — it sends a token instead.
 *
 * Bounded here rather than at the point of use: this is the boundary where
 * untrusted input arrives, and every consumer below it assumes a thread that
 * fits in a prompt.
 */
export function getSuppliedMessages(event: AddonEvent): Array<{
  id: string;
  from?: string;
  subject?: string;
  to?: string;
  date?: string;
  body: string;
}> {
  const raw = event.gmail?.messages;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => typeof m?.body === 'string' && m.body.trim().length > 0)
    .slice(0, 25)
    .map((m) => ({
      id: typeof m.id === 'string' ? m.id : '',
      from: typeof m.from === 'string' ? m.from : undefined,
      subject: typeof m.subject === 'string' ? m.subject : undefined,
      to: Array.isArray(m.to) ? m.to.filter((t) => typeof t === 'string').join(', ') : undefined,
      date: typeof m.date === 'string' ? m.date : undefined,
      body: (m.body as string).slice(0, 40_000),
    }));
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
