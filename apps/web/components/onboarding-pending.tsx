"use client"

import { Card } from "@/components/ui/card"

/**
 * Shown to a freshly-authenticated user who hasn't been assigned to any
 * customer yet — they can authenticate but have nothing to act on. Replaces
 * the dashboard until an admin links them to one or more customer accounts.
 *
 * Renders fullscreen with no chrome (no sidebar, no nav, no sign-out) so the
 * user just sits on this page until their admin finishes onboarding and
 * sends the access-ready email.
 */
export function OnboardingPending() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-xl p-10 text-center space-y-6">
        <div className="mx-auto h-56 w-56 overflow-hidden rounded-xl bg-muted">
          <img
            src="/onboarding-pending.gif"
            alt="Setup in progress animation"
            className="h-full w-full object-cover motion-reduce:hidden"
          />
          <div className="hidden h-full w-full items-center justify-center text-muted-foreground motion-reduce:flex">
            <span className="text-sm">Setup in progress</span>
          </div>
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
