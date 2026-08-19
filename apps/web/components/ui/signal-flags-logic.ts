import {
  Signal,
  hasSignal,
  getChurnRiskFromSignals,
} from "@crm/shared"

/**
 * Pure signal → flag resolution for the inbox row chips. No React / UI imports,
 * so it's unit-testable in the default node vitest env.
 *
 * Surfaces the "action" flags only — escalation / churn / upsell / kudos /
 * competitor. Sentiment and classification are rendered by their own row
 * indicators, so they're intentionally excluded here to avoid duplication.
 *
 * Design labels are kept in sync with the add-on's signal map
 * (apps/addon/src/cards/signals.ts) so copy matches the spec.
 */

export type FlagKind = "escalation" | "churn" | "upsell" | "kudos" | "competitor"

export interface ResolvedFlag {
  kind: FlagKind
  /** tooltip / badge text (may be more specific than the base label) */
  text: string
  /** icon color class (icon variant) */
  color: string
  /** badge color classes (badge variant) */
  badge: string
}

const BASE: Record<FlagKind, { label: string; color: string; badge: string }> = {
  escalation: { label: "At risk", color: "text-red-500", badge: "bg-red-500/10 text-red-600 border-red-500/20" },
  churn: { label: "Churn risk", color: "text-amber-500", badge: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  competitor: { label: "Competitor", color: "text-violet-500", badge: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
  upsell: { label: "Upsell signal", color: "text-emerald-500", badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  kudos: { label: "Kudos", color: "text-green-500", badge: "bg-green-500/10 text-green-600 border-green-500/20" },
}

/** Churn level → color override (higher risk reads hotter). */
const CHURN_LEVEL_COLOR: Record<"low" | "medium" | "high" | "critical", { color: string; badge: string }> = {
  low: { color: "text-amber-500", badge: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  medium: { color: "text-amber-600", badge: "bg-amber-500/15 text-amber-700 border-amber-500/25" },
  high: { color: "text-red-500", badge: "bg-red-500/10 text-red-600 border-red-500/20" },
  critical: { color: "text-red-600", badge: "bg-red-500/15 text-red-700 border-red-500/25" },
}

/**
 * Resolve the ordered list of flags present in a signals array.
 * Order is by urgency: escalation, churn, competitor, upsell, kudos.
 */
export function resolveFlags(signals: number[] | null | undefined): ResolvedFlag[] {
  if (!signals || signals.length === 0) return []
  const flags: ResolvedFlag[] = []

  if (hasSignal(signals, Signal.ESCALATION)) {
    flags.push({ kind: "escalation", text: BASE.escalation.label, color: BASE.escalation.color, badge: BASE.escalation.badge })
  }

  const churnLevel = getChurnRiskFromSignals(signals)
  if (churnLevel) {
    const c = CHURN_LEVEL_COLOR[churnLevel]
    flags.push({
      kind: "churn",
      text: `Churn risk · ${churnLevel.charAt(0).toUpperCase()}${churnLevel.slice(1)}`,
      color: c.color,
      badge: c.badge,
    })
  }

  if (hasSignal(signals, Signal.COMPETITOR)) {
    flags.push({ kind: "competitor", text: BASE.competitor.label, color: BASE.competitor.color, badge: BASE.competitor.badge })
  }
  if (hasSignal(signals, Signal.UPSELL)) {
    flags.push({ kind: "upsell", text: BASE.upsell.label, color: BASE.upsell.color, badge: BASE.upsell.badge })
  }
  if (hasSignal(signals, Signal.KUDOS)) {
    flags.push({ kind: "kudos", text: BASE.kudos.label, color: BASE.kudos.color, badge: BASE.kudos.badge })
  }

  return flags
}
