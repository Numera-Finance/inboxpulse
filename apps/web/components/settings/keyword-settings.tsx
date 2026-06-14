"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { useKeywords, useSaveKeywords } from "@/lib/hooks"
import type { KeywordCategory } from "@crm/clients"

const CATEGORIES: Array<{
  category: KeywordCategory
  label: string
  section: string
  description: string
}> = [
  { category: 'sentiment_positive', label: 'Positive Keywords', section: 'Sentiment', description: 'Triggers positive sentiment result' },
  { category: 'sentiment_negative', label: 'Negative Keywords', section: 'Sentiment', description: 'Triggers negative sentiment result' },
  { category: 'upsell', label: 'Keywords', section: 'Upsell', description: 'Triggers upsell detection' },
  { category: 'churn', label: 'Keywords', section: 'Churn', description: 'Triggers churn risk detection' },
  { category: 'competitor', label: 'Keywords', section: 'Competitor', description: 'Triggers competitor mention detection' },
]

// Group categories by section
const SECTIONS = [
  { title: 'Sentiment', description: 'Keywords that trigger positive or negative sentiment results', categories: ['sentiment_positive', 'sentiment_negative'] },
  { title: 'Upsell', description: 'Keywords that trigger upsell opportunity detection', categories: ['upsell'] },
  { title: 'Churn', description: 'Keywords that trigger churn risk detection', categories: ['churn'] },
  { title: 'Competitor', description: 'Keywords that trigger competitor mention detection', categories: ['competitor'] },
]

export function KeywordSettings() {
  const { data: keywordEntries, isLoading } = useKeywords()
  const saveKeywords = useSaveKeywords()

  const [formState, setFormState] = React.useState<Record<string, string>>({})
  const [initialized, setInitialized] = React.useState(false)

  // Initialize form state from fetched data
  React.useEffect(() => {
    if (keywordEntries && !initialized) {
      const state: Record<string, string> = {}
      for (const entry of keywordEntries) {
        state[entry.category] = entry.keywords
      }
      setFormState(state)
      setInitialized(true)
    }
  }, [keywordEntries, initialized])

  const handleChange = (category: string, value: string) => {
    setFormState(prev => ({ ...prev, [category]: value }))
  }

  const handleSave = () => {
    const entries: Array<{ category: KeywordCategory; keywords: string }> = CATEGORIES.map(c => ({
      category: c.category,
      keywords: formState[c.category] || '',
    }))

    saveKeywords.mutate(entries, {
      onSuccess: () => {
        toast.success('Analysis keywords saved')
      },
      onError: (error) => {
        toast.error(`Failed to save keywords: ${error.message}`)
      },
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Analysis Keywords</h2>
        <p className="text-sm text-muted-foreground">
          Define keywords that trigger analysis results without AI. When a keyword is found in an email,
          the result is determined immediately. If no keywords match, the system falls back to AI analysis.
        </p>
      </div>

      {SECTIONS.map(section => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle className="text-base">{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={section.categories.length > 1 ? "space-y-4" : ""}>
              {section.categories.map(catId => {
                const cat = CATEGORIES.find(c => c.category === catId)!
                return (
                  <div key={catId} className="space-y-2">
                    <Label htmlFor={catId}>{cat.label}</Label>
                    <Textarea
                      id={catId}
                      placeholder={'e.g. urgent "well done" critical...'}
                      rows={4}
                      value={formState[catId] || ''}
                      onChange={(e) => handleChange(catId, e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Separate with spaces or new lines. Use "double quotes" for phrases. Case-insensitive.
                    </p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saveKeywords.isPending}
        >
          {saveKeywords.isPending ? 'Saving...' : 'Save Keywords'}
        </Button>
      </div>
    </div>
  )
}
