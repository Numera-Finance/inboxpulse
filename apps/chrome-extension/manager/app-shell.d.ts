/**
 * Types for the ported manager shell.
 *
 * The manager UI (`app-shell.js` and the four section modules) is plain JS,
 * carried over from the standalone dashboard unmodified apart from the shell's
 * layout. Rather than convert ~4k lines to TypeScript, its public surface —
 * the two exports the content script actually touches — is declared here.
 */

import type { ManagerResponse } from '../lib/manager-client';

/** What a section's `mount` returns; every field is optional. */
export interface SectionInstance {
  /** Push new global filters into an already-mounted section. */
  setFilters?: (filters: Filters) => void;
  /** Dashboard/Customers cross-navigation hooks. */
  openEmail?: (emailId: string) => void;
  openInbox?: (filters: Record<string, unknown>) => void;
  openCustomer?: (customerId: string) => void;
  destroy?: () => void;
}

export interface Filters {
  dateRange: { from: string; to: string };
  customerId: string;
  teamMemberId: string;
}

/** Context handed to a section at mount time. */
export interface SectionContext {
  apiFetch: ApiFetch;
  filters: Filters;
  openInAiAnalysis: (emailId: string) => void;
  drillIntoAiAnalysis: (filters: Record<string, unknown>) => void;
  openInCustomers: (customerId: string) => void;
  resetAll: () => void;
}

export interface SectionDescriptor {
  id: string;
  label: string;
  /** When false the filter drawer is hidden while this section is active. */
  usesFilters?: boolean;
  mount: (host: HTMLElement, ctx: SectionContext) => SectionInstance | null;
}

export type ApiFetch = (path: string, init?: RequestInit) => Promise<ManagerResponse>;

export interface ShellInstance {
  showSection: (id: string) => void;
  getFilters: () => Filters;
  destroy: () => void;
}

export const MANAGER_SECTIONS: SectionDescriptor[];

export function mountApp(
  root: HTMLElement,
  opts: {
    apiFetch: ApiFetch;
    sections?: SectionDescriptor[];
    initialSection?: string;
  },
): ShellInstance;
