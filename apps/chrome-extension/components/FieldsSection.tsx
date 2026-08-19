import type { Customer } from '@crm/clients';
import { Block } from './Section';

interface FieldsSectionProps {
  customer: Customer;
}

export function FieldsSection({ customer }: FieldsSectionProps): React.ReactElement {
  const hasIndustry = !!customer.industry;
  const hasExternalId = !!customer.externalId;

  if (!hasIndustry && !hasExternalId) {
    return <></>;
  }

  return (
    <Block title="Details">
      <div className="space-y-1">
        {hasIndustry && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Industry</span>
            <span className="text-foreground">{customer.industry}</span>
          </div>
        )}
        {hasExternalId && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">External ID</span>
            <span className="text-foreground">{customer.externalId}</span>
          </div>
        )}
      </div>
    </Block>
  );
}
