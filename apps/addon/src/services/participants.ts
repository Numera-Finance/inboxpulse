/**
 * Who is actually involved in a conversation, derived from every message on the
 * thread rather than guessed from the one that happens to be open.
 *
 * "Who should I loop in" is a real question and the open message answers it
 * badly: it shows the current sender and recipients, which on a long chain is a
 * snapshot, not the cast. Someone who raised the issue three messages ago and
 * was dropped off the last reply is exactly the person worth re-adding, and they
 * are invisible if you only read the open message.
 *
 * So this aggregates across the whole thread and ranks by involvement, keeping
 * the evidence (message count, who wrote versus who was copied) so the panel can
 * show why a name is suggested instead of asserting it.
 */

export interface Participant {
  address: string;
  name?: string;
  /** Messages this address appears on, in any role. */
  messages: number;
  /** Messages this address actually wrote — the strongest involvement signal. */
  sent: number;
  /** Outside the viewer's own domain. */
  external: boolean;
  /** Present on the most recent message. */
  onLatest: boolean;
}

/** Split an address-list header into `Name <addr>` entries. */
function splitAddresses(header: string | undefined): string[] {
  if (!header) return [];
  // Commas inside a quoted display name must not split the list.
  return header.match(/(?:"[^"]*"|[^,])+/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

function parseOne(entry: string): { address: string; name?: string } | null {
  const angled = entry.match(/^(.*?)<([^>]+)>\s*$/);
  const address = (angled ? angled[2] : entry).trim().toLowerCase();
  if (!address.includes('@')) return null;
  const name = angled ? angled[1].trim().replace(/^"|"$/g, '') : undefined;
  return { address, name: name || undefined };
}

export function deriveParticipants(
  messages: Array<{ from?: string; to?: string; cc?: string }>,
  viewerEmail?: string,
): Participant[] {
  const viewer = viewerEmail?.toLowerCase();
  const viewerDomain = viewer?.split('@')[1];
  const byAddress = new Map<string, Participant>();
  const latest = messages[messages.length - 1];

  const record = (entry: string, opts: { sent: boolean; onLatest: boolean }) => {
    const parsed = parseOne(entry);
    if (!parsed) return;
    // The viewer is never a candidate to loop in — they are already here.
    if (viewer && parsed.address === viewer) return;

    const existing = byAddress.get(parsed.address);
    if (existing) {
      existing.messages += 1;
      if (opts.sent) existing.sent += 1;
      if (opts.onLatest) existing.onLatest = true;
      if (!existing.name && parsed.name) existing.name = parsed.name;
      return;
    }
    byAddress.set(parsed.address, {
      address: parsed.address,
      name: parsed.name,
      messages: 1,
      sent: opts.sent ? 1 : 0,
      external: viewerDomain ? parsed.address.split('@')[1] !== viewerDomain : false,
      onLatest: opts.onLatest,
    });
  };

  for (const m of messages) {
    const onLatest = m === latest;
    splitAddresses(m.from).forEach((e) => record(e, { sent: true, onLatest }));
    [...splitAddresses(m.to), ...splitAddresses(m.cc)].forEach((e) =>
      record(e, { sent: false, onLatest }),
    );
  }

  // Rank by involvement: people who wrote outrank people who were merely copied,
  // then by how many messages they appear on.
  return [...byAddress.values()].sort(
    (a, b) => b.sent - a.sent || b.messages - a.messages || a.address.localeCompare(b.address),
  );
}

/**
 * Someone who was part of the conversation but is NOT on the latest message —
 * the person most likely to need looping back in, and the one the open message
 * cannot reveal.
 */
export function droppedOff(participants: Participant[]): Participant[] {
  return participants.filter((p) => !p.onLatest && p.messages > 0);
}
