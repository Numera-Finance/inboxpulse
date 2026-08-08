import { cn } from '../lib/utils';

/**
 * The panel's two-level structure: named groups (SELECTED / ANALYSIS / USER /
 * THREAD), each holding one or more titled blocks.
 *
 * Factored out because the sidebar's problem was never any one section — it was
 * that eight sections shared one flat rhythm, so nothing signalled where the
 * message-scoped content ended and the thread-scoped content began. Every
 * heading is fenced by a rule above and below, and the two levels differ in
 * size and weight; keeping that in one place is what keeps every section
 * agreeing on it.
 */

interface SectionGroupProps {
  /** Group name, rendered in caps above the rule. */
  title: string;
  /** Parenthetical shown next to the title, e.g. "selected message". */
  hint?: string;
  children: React.ReactNode;
}

export function SectionGroup({ title, hint, children }: SectionGroupProps): React.ReactElement {
  return (
    <section>
      {/* Rules above and below the name, so a group reads as a banner rather
          than as a heading that happens to sit near a line. */}
      <div className="border-y border-border py-2">
        <h2 className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold uppercase tracking-wider text-foreground">
          {title}
          {hint && (
            <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
              {hint}
            </span>
          )}
        </h2>
      </div>
      {/* Blocks need their own container: `first:border-t-0` inside Block keys
          off :first-child, and the banner above would otherwise claim it. */}
      <div>{children}</div>
    </section>
  );
}

interface BlockProps {
  /** Optional block heading. Omit for a group with a single unnamed block. */
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * One block inside a group. Every block heading is fenced by a rule above and
 * below, matching the group banner one size down.
 *
 * The rule above is the block's own top border rather than a line under the
 * previous block, and `first:border-t-0` drops it on the block that sits
 * directly beneath a group banner — the banner's lower rule already serves as
 * that heading's "before" line. Without this the two would stack into a
 * doubled rule with nothing between them, which reads as a rendering bug.
 */
export function Block({ title, children, className }: BlockProps): React.ReactElement {
  return (
    <div className={cn('border-t border-border/60 first:border-t-0', className)}>
      {title && (
        <div className="border-b border-border/60 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
        </div>
      )}
      <div className="py-3">{children}</div>
    </div>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

/**
 * A `label: value` row. The label column is fixed so from / to / cc / date /
 * subject line up down the left edge — the whole point of the "Selected" block
 * is being scannable at a glance.
 */
export function Field({ label, children }: FieldProps): React.ReactElement {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 break-words text-foreground">{children}</div>
    </div>
  );
}
