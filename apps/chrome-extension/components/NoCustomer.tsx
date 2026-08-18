import { SearchX } from 'lucide-react';

interface NoCustomerProps {
  /** Optional sender email/domain to show for context. */
  label?: string;
}

export function NoCustomer({ label }: NoCustomerProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="rounded-full bg-muted p-3">
        <SearchX size={20} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">No customer linked</p>
        <p className="text-xs text-muted-foreground mt-1">
          {label ? (
            <>
              No CRM customer is linked to <span className="font-medium">{label}</span>
            </>
          ) : (
            'No CRM customer is linked to this conversation'
          )}
        </p>
      </div>
    </div>
  );
}
