import { useState, useSyncExternalStore } from 'react';
import { format } from 'date-fns';
import {
  getActiveMessageSnapshot,
  subscribeActiveMessage,
  type ActiveMessage,
} from '../lib/active-message-store';
import type { EmailAddress, MessageEnvelope } from '../hooks/useThreadCustomer';
import { Block, Field, SectionGroup } from './Section';

/** Above this many addresses on one line, the rest collapse behind a toggle. */
const MAX_VISIBLE_ADDRESSES = 3;

interface SelectedMessageProps {
  /** Stored envelopes for the thread, keyed by Gmail message id. */
  envelopes: Map<string, MessageEnvelope>;
}

/**
 * "Selected" — the envelope of the ONE message currently selected in the thread,
 * whether that came from expanding it in Gmail or picking it from the bar at the
 * top of the panel.
 *
 * Two sources, deliberately in this order. The stored row wins because it is the
 * only one that keeps `to` and `cc` apart: InboxSDK hands back a single flat
 * `getRecipientEmailAddresses()` list with no distinction between them. Gmail's
 * DOM then fills whatever the CRM has not ingested — most often the reader's own
 * sent replies, which are real messages in the thread but have no stored row, so
 * without the fallback this block would go blank exactly when the reader clicks
 * their own email.
 */
export function SelectedMessage({ envelopes }: SelectedMessageProps): React.ReactElement {
  const active: ActiveMessage | null = useSyncExternalStore(
    subscribeActiveMessage,
    getActiveMessageSnapshot,
    getActiveMessageSnapshot,
  );

  const stored = active ? envelopes.get(active.id) : undefined;

  return (
    <SectionGroup title="Selected" hint="(selected message)">
      <Block>
        {!active ? (
          <p className="text-xs text-muted-foreground">
            No message selected — pick one from the bar above, or expand an email
            in this conversation.
          </p>
        ) : (
          <div className="space-y-1.5">
            <Field label="From">
              <AddressList
                addresses={fromAddress(stored, active)}
                empty="Unknown sender"
              />
            </Field>
            <Field label="To">
              <AddressList addresses={toAddresses(stored, active)} empty="—" />
            </Field>
            <Field label="Cc">
              {recipientsAreUnsplit(stored, active) ? (
                <span
                  className="text-muted-foreground"
                  title="Gmail exposes one combined recipient list, so any Cc is shown under To."
                >
                  not separated
                </span>
              ) : (
                <AddressList addresses={stored?.ccs ?? []} empty="—" />
              )}
            </Field>
            <Field label="Date">{formatDate(stored, active)}</Field>
            <Field label="Subject">
              {stored?.subject || active.subject || '(no subject)'}
            </Field>
          </div>
        )}
      </Block>
    </SectionGroup>
  );
}

function fromAddress(
  stored: MessageEnvelope | undefined,
  active: ActiveMessage,
): EmailAddress[] {
  const email = stored?.fromEmail ?? active.fromEmail;
  if (!email) return [];
  return [{ email, name: stored?.fromName ?? active.fromName ?? undefined }];
}

/**
 * Recipients, preferring the stored `to` list and falling back to Gmail's.
 *
 * The fallback is per-FIELD, not per-row. An earlier version fell back only when
 * there was no stored row at all, which missed the case that actually happens:
 * the row exists (so subject and date render) but carries no recipients, because
 * the API serving it predates `tos`/`ccs` being returned. From survived that —
 * it already fell back field-by-field — while To silently showed "—".
 *
 * Gmail's list does not distinguish to from cc, so a cc'd person can surface
 * here while Cc stays empty. That imprecision is worth it: the alternative is
 * showing the reader nothing at all about who received the mail. Once the API
 * returns the split, the stored value wins and the question disappears.
 */
function toAddresses(
  stored: MessageEnvelope | undefined,
  active: ActiveMessage,
): EmailAddress[] {
  if (stored && stored.tos.length > 0) return stored.tos;
  return active.recipients.map((email) => ({ email }));
}

/** True when To is standing in for an unsplit to+cc list — worth flagging. */
function recipientsAreUnsplit(
  stored: MessageEnvelope | undefined,
  active: ActiveMessage,
): boolean {
  return (!stored || stored.tos.length === 0) && active.recipients.length > 0;
}

function formatDate(stored: MessageEnvelope | undefined, active: ActiveMessage): string {
  if (stored?.receivedAt) {
    const date = new Date(stored.receivedAt);
    if (!Number.isNaN(date.getTime())) return format(date, 'MMM d, yyyy · h:mm a');
  }
  return active.dateString ?? '—';
}

/**
 * A comma-separated address list that stays one or two lines until asked
 * otherwise. A wide cc list is common and would otherwise push everything below
 * it — including the analysis — off the visible panel.
 */
function AddressList({
  addresses,
  empty,
}: {
  addresses: EmailAddress[];
  empty: string;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  if (addresses.length === 0) {
    return <span className="text-muted-foreground">{empty}</span>;
  }

  const hidden = addresses.length - MAX_VISIBLE_ADDRESSES;
  const visible = expanded ? addresses : addresses.slice(0, MAX_VISIBLE_ADDRESSES);

  return (
    <span>
      {visible.map((address, i) => (
        <span key={`${address.email}-${i}`} title={address.email}>
          {i > 0 && ', '}
          {address.name ? (
            <>
              {address.name}{' '}
              <span className="text-muted-foreground">&lt;{address.email}&gt;</span>
            </>
          ) : (
            address.email
          )}
        </span>
      ))}
      {hidden > 0 && (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-1 text-primary hover:underline"
        >
          {expanded ? 'show less' : `+${hidden} more`}
        </button>
      )}
    </span>
  );
}
