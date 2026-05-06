"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"

/**
 * Onboarding-pending screen for freshly-authenticated users who haven't been
 * assigned to any customer yet — they can authenticate but have nothing to
 * act on. Intended to be rendered in place of the dashboard once the gate
 * trigger is wired up (caller TBD).
 *
 * Renders fullscreen with no chrome (no sidebar, no nav, no sign-out) so the
 * user just sits on this page until their admin finishes onboarding and
 * sends the access-ready email.
 */
export function OnboardingPending() {
  const prefersReducedMotion = usePrefersReducedMotion()

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-xl p-10 text-center space-y-6">
        <div className="mx-auto flex h-56 w-56 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {prefersReducedMotion ? (
            <span className="text-sm text-muted-foreground">Setup in progress</span>
          ) : (
            <img
              src="/onboarding-pending.gif"
              alt="Setup in progress animation"
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Hang tight — we're setting up your account
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            Your administrator is finishing your onboarding. As soon as you're
            onboarded, the dashboard will unlock and you'll be off to the
            races. We'll email you the moment access is ready.
          </p>
        </div>
      </Card>
    </div>
  )
}

/**
 * Watches `prefers-reduced-motion`. Returning the boolean lets callers
 * conditionally render the GIF, which avoids the network fetch entirely for
 * users who've opted out of motion (CSS `motion-reduce:hidden` only hides the
 * element after the browser has already downloaded it).
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  return reduced
}
