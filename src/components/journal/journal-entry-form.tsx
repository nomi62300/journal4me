"use client";

/**
 * Four plain-text fields — squarely inside AGENTS.md's "more than one or two
 * plain text fields" rule, so onSubmit + startTransition, never
 * <form action={fn}>. See trade-form.tsx's identical, more detailed comment
 * for the full requestFormReset() story; this form has no <Select> so it
 * doesn't hit that specific trap, but the defaultValue-wipe-on-failed-submit
 * risk applies to any multi-field form regardless.
 */

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveJournalEntry } from "@/lib/journal/actions";
import type { JournalEntryFormState } from "@/lib/journal/schema";
import type { JournalEntry } from "@/lib/journal/types";

export function JournalEntryForm({
  entryDate,
  entry,
}: {
  entryDate: string;
  entry: JournalEntry | null;
}) {
  const [state, formAction, actionPending] = useActionState<JournalEntryFormState, FormData>(
    saveJournalEntry,
    {},
  );
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;

  const [preMarketPlan, setPreMarketPlan] = useState(entry?.pre_market_plan ?? "");
  const [postSessionReview, setPostSessionReview] = useState(entry?.post_session_review ?? "");
  const [mood, setMood] = useState(entry?.mood ?? "");
  const [lessons, setLessons] = useState(entry?.lessons ?? "");

  useEffect(() => {
    if (state.formError) toast.error(state.formError);
  }, [state.formError]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("entry_date", entryDate);
        fd.set("pre_market_plan", preMarketPlan);
        fd.set("post_session_review", postSessionReview);
        fd.set("mood", mood);
        fd.set("lessons", lessons);
        startTransition(() => {
          formAction(fd);
        });
      }}
    >
      <FieldGroup>
        {state.formError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.formError}</AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel htmlFor="j-mood">Mood</FieldLabel>
          <Input
            id="j-mood"
            placeholder="e.g. focused, anxious, confident"
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            disabled={pending}
            maxLength={40}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="j-pre-market">Pre-market plan</FieldLabel>
          <Textarea
            id="j-pre-market"
            placeholder="What's the setup today? What are you watching for, and what would invalidate it?"
            value={preMarketPlan}
            onChange={(e) => setPreMarketPlan(e.target.value)}
            disabled={pending}
            rows={4}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="j-post-session">Post-session review</FieldLabel>
          <Textarea
            id="j-post-session"
            placeholder="How did it actually go? Did you follow the plan?"
            value={postSessionReview}
            onChange={(e) => setPostSessionReview(e.target.value)}
            disabled={pending}
            rows={4}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="j-lessons">Lessons</FieldLabel>
          <Textarea
            id="j-lessons"
            placeholder="What would you do differently next time?"
            value={lessons}
            onChange={(e) => setLessons(e.target.value)}
            disabled={pending}
            rows={3}
          />
          <FieldDescription>
            The one field worth re-reading before your next session.
          </FieldDescription>
        </Field>

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving…" : "Save entry"}
        </Button>
      </FieldGroup>
      <SuccessToast pending={pending} error={state.formError} />
    </form>
  );
}

/**
 * A ref, not state, tracks the previous `pending` value: calling toast() (a
 * side effect) during render is unsafe since render can run more than once
 * for the same commit (StrictMode double-invokes it in dev) — useEffect is
 * the correct place. Same pattern as account-edit-form.tsx's own
 * SuccessToast.
 */
function SuccessToast({ pending, error }: { pending: boolean; error: string | undefined }) {
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !error) {
      toast.success("Entry saved.");
    }
    wasPending.current = pending;
  }, [pending, error]);

  return null;
}
