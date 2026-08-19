import * as React from "react"
import { ArrowDownLeft, ArrowUpRight } from "lucide-react"
import type { EmailThread, ThreadMessage } from "@crm/clients"
import { cn } from "@/lib/utils"

/**
 * The conversation as a rail: who wrote, when, and how long everyone waited.
 *
 * The panel beside this shows one message. One message cannot answer the only
 * question a reader has in front of an escalation — whose turn is it, and how
 * long has it been that way. The gap between messages is the finding; the body
 * text is supporting evidence. So the delta is rendered at least as loudly as
 * the message itself, and a long one is coloured.
 */

/** Beyond a working day, a gap stops being latency and starts being a problem. */
const SLOW_HOURS = 24

function formatGap(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m later`
  if (hours < 48) return `${hours % 1 === 0 ? hours : hours.toFixed(1)}h later`
  return `${Math.round(hours / 24)}d later`
}

function formatWhen(d: Date): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function displayName(p: ThreadMessage["from"]): string {
  return p.name?.trim() || p.email.split("@")[0]
}

function Row({
  message,
  onSelect,
}: {
  message: ThreadMessage
  onSelect?: (id: string) => void
}): React.JSX.Element {
  const slow = message.hoursSincePrevious !== null && message.hoursSincePrevious >= SLOW_HOURS

  return (
    <li className="relative pl-6">
      {/* Spine */}
      <span
        aria-hidden
        className="absolute left-[7px] top-0 bottom-0 w-px bg-border"
      />
      {/* Direction is the fastest read on the rail: arrow in means they wrote. */}
      <span
        className={cn(
          "absolute left-0 top-1.5 flex h-[15px] w-[15px] items-center justify-center rounded-full border bg-background",
          message.inbound ? "border-destructive/60 text-destructive" : "border-primary/60 text-primary"
        )}
      >
        {message.inbound ? (
          <ArrowDownLeft size={10} strokeWidth={2.5} />
        ) : (
          <ArrowUpRight size={10} strokeWidth={2.5} />
        )}
      </span>

      {message.hoursSincePrevious !== null && (
        <p
          className={cn(
            "mb-1 text-[11px] font-medium tabular-nums",
            slow ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {formatGap(message.hoursSincePrevious)}
        </p>
      )}

      <button
        type="button"
        onClick={() => onSelect?.(message.id)}
        className={cn(
          "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
          message.isFocused
            ? "border-primary bg-primary/5"
            : "border-transparent hover:border-border hover:bg-muted/50"
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-semibold">{displayName(message.from)}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatWhen(message.receivedAt)}
          </span>
        </div>

        <p className="truncate text-[11px] text-muted-foreground">
          {message.from.isStaff ? "us" : "client"} · {message.from.email}
        </p>

        {/* Every address, wrapped rather than truncated. "Who else saw this"
            is a question the reader is asking directly — a clipped list that
            ends in an ellipsis answers it worse than no list at all. Staff are
            marked, so a thread where only clients are on the To line is
            visible at a glance. */}
        {message.to.length > 0 && (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium">To </span>
            {message.to.map((r, i) => (
              <span key={r.email}>
                {i > 0 && ", "}
                <span className={cn(r.isStaff && "text-foreground")}>
                  {r.name?.trim() || r.email}
                </span>
              </span>
            ))}
          </p>
        )}

        {message.cc.length > 0 && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium">Cc </span>
            {message.cc.map((r, i) => (
              <span key={r.email}>
                {i > 0 && ", "}
                <span className={cn(r.isStaff && "text-foreground")}>
                  {r.name?.trim() || r.email}
                </span>
              </span>
            ))}
          </p>
        )}

        {message.snippet && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {message.snippet}
          </p>
        )}
      </button>
    </li>
  )
}

export function ThreadTimeline({
  thread,
  onSelect,
  className,
}: {
  thread: EmailThread | undefined
  onSelect?: (id: string) => void
  className?: string
}): React.JSX.Element | null {
  if (!thread || thread.messages.length === 0) return null

  const last = thread.messages[thread.messages.length - 1]
  // Whose turn it is, stated rather than left to be inferred from the arrows.
  const waitingOnUs = last.inbound

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        <h3 className="text-sm font-semibold">Timeline</h3>
        <p className="text-xs text-muted-foreground">
          {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
          {" · "}
          <span className={cn(waitingOnUs && "font-medium text-destructive")}>
            {waitingOnUs ? "waiting on us" : "waiting on them"}
          </span>
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {thread.messages.map((m) => (
          <Row key={m.id} message={m} onSelect={onSelect} />
        ))}
      </ol>
    </div>
  )
}
