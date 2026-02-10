import type { RequestHeader } from '@crm/shared';

export type HonoEnv = {
  Variables: {
    requestHeader: RequestHeader;
    isInternalCall?: boolean;
  };
};
