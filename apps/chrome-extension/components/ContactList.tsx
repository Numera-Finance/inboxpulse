import { useQuery } from '@tanstack/react-query';
import { getContactClient, WEB_URL } from '../lib/clients';
import type { Contact } from '@crm/clients';
import { Users, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

const MAX_VISIBLE = 3;

interface ContactListProps {
  customerId: string;
  senderEmail?: string;
}

export function ContactList({ customerId, senderEmail }: ContactListProps): React.ReactElement {
  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ['contacts', 'customer', customerId],
    queryFn: async () => {
      const client = getContactClient();
      return client.getContactsByCustomer(customerId);
    },
    staleTime: 60_000,
  });

  // Sort: thread sender first
  const sorted = contacts
    ? [...contacts].sort((a, b) => {
        const aMatch = senderEmail && a.email.toLowerCase() === senderEmail.toLowerCase() ? -1 : 0;
        const bMatch = senderEmail && b.email.toLowerCase() === senderEmail.toLowerCase() ? -1 : 0;
        return aMatch - bMatch;
      })
    : [];

  const visible = sorted.slice(0, MAX_VISIBLE);
  const totalCount = sorted.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Users size={12} className="text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Contacts
        </h3>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-2">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">No contacts found</p>
      ) : (
        <div className="space-y-0.5">
          {visible.map((contact) => {
            const isSender = senderEmail && contact.email.toLowerCase() === senderEmail.toLowerCase();
            return (
              <div
                key={contact.id}
                className={cn(
                  'flex items-center justify-between rounded px-2 py-1 text-xs',
                  isSender && 'bg-accent/50',
                )}
              >
                <span className="font-medium truncate">
                  {contact.name || contact.email}
                </span>
                <span className="text-muted-foreground truncate ml-2 shrink-0">
                  {contact.email}
                </span>
              </div>
            );
          })}

          {totalCount > MAX_VISIBLE && (
            <a
              href={`${WEB_URL}/customers/${customerId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-primary hover:underline px-2 pt-1"
            >
              View all {totalCount} contacts
            </a>
          )}
        </div>
      )}
    </div>
  );
}
