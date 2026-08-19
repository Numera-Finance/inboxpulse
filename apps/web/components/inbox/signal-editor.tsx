"use client"

import * as React from "react"
import { Tag, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Signal,
  SIGNAL_LABELS,
  getSentimentFromSignals,
  getChurnRiskFromSignals,
  getClassificationFromSignals,
  hasSignal,
  validateSignalSelection,
  type SignalType,
} from "@crm/shared"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useUpdateEmailSignals } from "@/lib/hooks/use-emails"

// Sentinel value for the "none" option in a single-select group. RadioGroup
// values are strings, so we map to/from signal ints.
const NONE = "none"

// Single-select groups (at most one signal each).
const SENTIMENT_OPTIONS: SignalType[] = [
  Signal.SENTIMENT_POSITIVE,
  Signal.SENTIMENT_NEGATIVE,
  Signal.SENTIMENT_NEUTRAL,
]
const CHURN_OPTIONS: SignalType[] = [
  Signal.CHURN_LOW,
  Signal.CHURN_MEDIUM,
  Signal.CHURN_HIGH,
  Signal.CHURN_CRITICAL,
]
const CLASSIFICATION_OPTIONS: SignalType[] = [
  Signal.CLASSIFICATION_BUSINESS,
  Signal.CLASSIFICATION_SPAM,
  Signal.CLASSIFICATION_MARKETING,
  Signal.CLASSIFICATION_TRANSACTIONAL,
  Signal.CLASSIFICATION_AUTOMATED,
]

// Multi-select boolean tags.
const TAG_OPTIONS: SignalType[] = [
  Signal.UPSELL,
  Signal.ESCALATION,
  Signal.KUDOS,
  Signal.COMPETITOR,
]

interface SignalEditorProps {
  emailId: string
  /** Current signals for the email (from the analysis pipeline or a prior override). */
  signals: number[]
  /** Called with the newly-saved signal set after a successful override. */
  onSaved: (newSignals: number[]) => void
}

/**
 * SignalEditor — lets a user correct an email's sentiment / churn-risk / tags
 * when the analysis got it wrong (e.g. flagged "Churn Risk" for what is really
 * just negative sentiment). The correction is locked against future re-analysis
 * and logged for prompt improvement.
 */
export function SignalEditor({ emailId, signals, onSaved }: SignalEditorProps) {
  const [open, setOpen] = React.useState(false)
  const update = useUpdateEmailSignals()

  // Derive the initial selections from the current signals. Re-seeded each time
  // the popover opens so it always reflects the latest saved state.
  const initialSentiment = React.useMemo(
    () => sentimentSignal(getSentimentFromSignals(signals)),
    [signals]
  )
  const initialChurn = React.useMemo(
    () => churnSignal(getChurnRiskFromSignals(signals)),
    [signals]
  )
  const initialClassification = React.useMemo(
    () => classificationSignal(getClassificationFromSignals(signals)),
    [signals]
  )
  const initialTags = React.useMemo(
    () => TAG_OPTIONS.filter((s) => hasSignal(signals, s)),
    [signals]
  )

  const [sentiment, setSentiment] = React.useState<number | null>(initialSentiment)
  const [churn, setChurn] = React.useState<number | null>(initialChurn)
  const [classification, setClassification] = React.useState<number | null>(initialClassification)
  const [tags, setTags] = React.useState<number[]>(initialTags)
  const [reason, setReason] = React.useState("")

  // Re-seed the form whenever the popover opens with the latest signals.
  const reseed = React.useCallback(() => {
    setSentiment(initialSentiment)
    setChurn(initialChurn)
    setClassification(initialClassification)
    setTags(initialTags)
    setReason("")
  }, [initialSentiment, initialChurn, initialClassification, initialTags])

  const handleOpenChange = (next: boolean) => {
    if (next) reseed()
    setOpen(next)
  }

  const toggleTag = (signal: number, checked: boolean) => {
    setTags((prev) =>
      checked ? [...new Set([...prev, signal])] : prev.filter((s) => s !== signal)
    )
  }

  const handleSave = async () => {
    const next: number[] = [
      ...(sentiment !== null ? [sentiment] : []),
      ...(churn !== null ? [churn] : []),
      ...(classification !== null ? [classification] : []),
      ...tags,
    ]

    const validationError = validateSignalSelection(next)
    if (validationError) {
      toast.error(validationError)
      return
    }

    try {
      const result = await update.mutateAsync({
        emailId,
        request: { signals: next, reason: reason.trim() || undefined },
      })
      toast.success("Tags updated")
      // Close the popover before onSaved: in the escalations page onSaved bumps
      // a key that remounts this component's parent subtree, so calling it last
      // avoids a state update on an unmounting component.
      setOpen(false)
      onSaved(result.signals)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tags")
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 px-3 text-sm">
          <Tag className="mr-1.5 h-3.5 w-3.5" />
          Edit tags
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-[70vh] overflow-y-auto">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold">Edit tags</h4>
            <p className="text-xs text-muted-foreground">
              Correct the sentiment or tags for this email. Your change is kept even if
              the email is re-analyzed.
            </p>
          </div>

          <SingleSelectGroup
            label="Sentiment"
            options={SENTIMENT_OPTIONS}
            value={sentiment}
            onChange={setSentiment}
          />

          <Separator />

          <SingleSelectGroup
            label="Churn risk"
            options={CHURN_OPTIONS}
            value={churn}
            onChange={setChurn}
          />

          <Separator />

          <SingleSelectGroup
            label="Classification"
            options={CLASSIFICATION_OPTIONS}
            value={classification}
            onChange={setClassification}
          />

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Other tags</Label>
            <div className="space-y-2">
              {TAG_OPTIONS.map((signal) => (
                <label
                  key={signal}
                  className="flex items-center gap-2 text-sm font-normal cursor-pointer"
                >
                  <Checkbox
                    checked={tags.includes(signal)}
                    onCheckedChange={(checked) => toggleTag(signal, checked === true)}
                  />
                  {SIGNAL_LABELS[signal]}
                </label>
              ))}
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="signal-reason" className="text-xs font-medium text-muted-foreground">
              Reason (optional)
            </Label>
            <Textarea
              id="signal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this correction needed? (helps improve the model)"
              className="min-h-[60px] text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={update.isPending}>
              {update.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface SingleSelectGroupProps {
  label: string
  options: SignalType[]
  value: number | null
  onChange: (value: number | null) => void
}

/** A radio group with a "None" option that maps to/from a nullable signal int. */
function SingleSelectGroup({ label, options, value, onChange }: SingleSelectGroupProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <RadioGroup
        value={value === null ? NONE : String(value)}
        onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
        className="gap-1.5"
      >
        <RadioOption groupId={label} value={NONE} text="None" />
        {options.map((signal) => (
          <RadioOption
            key={signal}
            groupId={label}
            value={String(signal)}
            text={SIGNAL_LABELS[signal]}
          />
        ))}
      </RadioGroup>
    </div>
  )
}

function RadioOption({ groupId, value, text }: { groupId: string; value: string; text: string }) {
  const id = `${groupId}-${value}`
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm font-normal cursor-pointer">
      <RadioGroupItem id={id} value={value} />
      {text}
    </label>
  )
}

// Narrowing helpers: convert the derived string enums back to signal ints.
function sentimentSignal(v: "positive" | "negative" | "neutral" | null): number | null {
  if (v === "positive") return Signal.SENTIMENT_POSITIVE
  if (v === "negative") return Signal.SENTIMENT_NEGATIVE
  if (v === "neutral") return Signal.SENTIMENT_NEUTRAL
  return null
}

function churnSignal(v: "low" | "medium" | "high" | "critical" | null): number | null {
  if (v === "low") return Signal.CHURN_LOW
  if (v === "medium") return Signal.CHURN_MEDIUM
  if (v === "high") return Signal.CHURN_HIGH
  if (v === "critical") return Signal.CHURN_CRITICAL
  return null
}

function classificationSignal(
  v: "spam" | "marketing" | "transactional" | "automated" | "business" | null
): number | null {
  if (v === "spam") return Signal.CLASSIFICATION_SPAM
  if (v === "marketing") return Signal.CLASSIFICATION_MARKETING
  if (v === "transactional") return Signal.CLASSIFICATION_TRANSACTIONAL
  if (v === "automated") return Signal.CLASSIFICATION_AUTOMATED
  if (v === "business") return Signal.CLASSIFICATION_BUSINESS
  return null
}
