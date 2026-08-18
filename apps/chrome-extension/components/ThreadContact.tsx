import { useQuery } from '@tanstack/react-query';
import type { Contact } from '@crm/clients';
import { getContactClient } from '../lib/clients';
import { User } from 'lucide-react';
import { Block, Field } from './Section';

interface ThreadContactProps {
  /** Customer this thread resolved to, or null when it resolved to none. */
  customerId: string | null;
  /** The external sender on the thread — who the USER group is about. */
  senderEmail?: string;
  /** Display name for that sender, from the stored envelope, if we have one. */
  senderName?: string | null;
}

/** One stored field on the contact record, in reading order. */
interface DetailField {
  key: 'phone' | 'mobile' | 'address' | 'website' | 'linkedin' | 'x' | 'linktree';
  label: string;
  kind: 'tel' | 'url' | 'text';
}

const DETAIL_FIELDS: readonly DetailField[] = [
  { key: 'phone', label: 'Phone', kind: 'tel' },
  { key: 'mobile', label: 'Mobile', kind: 'tel' },
  { key: 'address', label: 'Address', kind: 'text' },
  { key: 'website', label: 'Website', kind: 'url' },
  { key: 'linkedin', label: 'LinkedIn', kind: 'url' },
  { key: 'x', label: 'X', kind: 'url' },
  { key: 'linktree', label: 'Linktree', kind: 'url' },
];

/**
 * The person on the other side of this conversation — their own CRM contact
 * record, not their employer's roster.
 *
 * This block used to sit above a "Contacts" list of everyone at the resolved
 * customer, which answered a question nobody reading a single email was asking:
 * the sender's colleagues are one click away on the customer page, whereas the
 * sender's own number, title and profiles are the thing you want while replying
 * to them. So the roster is gone and its space goes to this person's details.
 *
 * The CRM record also wins over the envelope for the name: it's the tenant's
 * own curated spelling, whereas Gmail's display name is whatever the sender
 * happens to have set on their account this week. Falls back to the envelope's
 * name, then to the address alone, so the block still identifies someone when
 * the thread resolved to no customer at all — in which case there is no record
 * to look up and only name and address are shown.
 */
export function ThreadContact({
  customerId,
  senderEmail,
  senderName,
}: ThreadContactProps): React.ReactElement {
  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ['contacts', 'customer', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const client = getContactClient();
      return client.getContactsByCustomer(customerId);
    },
    enabled: !!customerId,
    staleTime: 60_000,
  });

  const match = senderEmail
    ? contacts?.find((c) => c.email.toLowerCase() === senderEmail.toLowerCase())
    : undefined;

  const name = match?.name || senderName || null;
  const email = match?.email || senderEmail || null;

  const details = DETAIL_FIELDS.map((field) => ({
    ...field,
    value: (match?.[field.key] ?? '').trim(),
  })).filter((field) => field.value.length > 0);

  // Only worth saying once we know there was somewhere to look: with no
  // customer the lookup never ran, so "no record" would be misleading.
  const missingRecord = !!customerId && !!contacts && !match;

  if (!email) {
    return (
      <Block>
        <p className="text-xs text-muted-foreground">
          No external participant identified on this conversation.
        </p>
      </Block>
    );
  }

  return (
    <Block>
      <div className="flex items-start gap-2">
        <User size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {name && <p className="text-sm font-medium leading-snug">{name}</p>}
          {match?.title && (
            <p className="text-xs text-muted-foreground leading-snug">{match.title}</p>
          )}
          <p className="text-xs text-muted-foreground break-words">{email}</p>
        </div>
      </div>

      {details.length > 0 && (
        <div className="mt-3 space-y-1">
          {details.map((field) => (
            <Field key={field.key} label={field.label}>
              <DetailValue kind={field.kind} value={field.value} />
            </Field>
          ))}
        </div>
      )}

      {missingRecord && (
        <p className="mt-3 text-xs text-muted-foreground">No contact record in the CRM.</p>
      )}
    </Block>
  );
}

/**
 * A stored field, linked when the value is somewhere you can actually go.
 *
 * Social fields are stored free-form, so a value is as likely to be a handle
 * (`@jane`) as a URL. Promoting a bare domain to https is safe; guessing which
 * site a handle belongs to is not, so handles stay as plain text.
 */
function DetailValue({ kind, value }: { kind: DetailField['kind']; value: string }): React.ReactElement {
  if (kind === 'tel') {
    return (
      <a href={`tel:${value.replace(/[^\d+]/g, '')}`} className="text-primary hover:underline">
        {value}
      </a>
    );
  }

  const href = kind === 'url' ? toUrl(value) : null;
  if (!href) {
    return <>{value}</>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline break-all"
    >
      {value}
    </a>
  );
}

function toUrl(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(value)) return `https://${value}`;
  return null;
}
