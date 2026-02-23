import { SearchX } from 'lucide-react';

interface NoCustomerProps {
  domain: string;
}

export function NoCustomer({ domain }: NoCustomerProps): React.ReactElement {
  return (
    <div className="mt-8 flex flex-col items-center gap-3 text-center">
      <div className="rounded-full bg-muted p-3">
        <SearchX size={20} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">No customer found</p>
        <p className="text-xs text-muted-foreground mt-1">
          No CRM customer is registered for <span className="font-medium">{domain}</span>
        </p>
      </div>
    </div>
  );
}
