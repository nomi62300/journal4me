"use client";

/**
 * Name, description, rules_text, and a dynamic entry_criteria list — well
 * past AGENTS.md's "one or two plain text fields" line, so onSubmit +
 * startTransition, never <form action={fn}>. Same pattern as
 * journal-entry-form.tsx / trade-form.tsx.
 */

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/trades/tag-input";
import { createStrategy, updateStrategy } from "@/lib/strategies/actions";
import type { StrategyFormState } from "@/lib/strategies/schema";
import type { Strategy } from "@/lib/strategies/types";

export function StrategyForm({ strategy }: { strategy?: Strategy }) {
  const isEdit = !!strategy;
  const boundAction = isEdit ? updateStrategy.bind(null, strategy.id) : createStrategy;
  const [state, formAction, actionPending] = useActionState<StrategyFormState, FormData>(
    boundAction,
    {},
  );
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;

  const [name, setName] = useState(strategy?.name ?? "");
  const [description, setDescription] = useState(strategy?.description ?? "");
  const [rulesText, setRulesText] = useState(strategy?.rules_text ?? "");
  const [entryCriteria, setEntryCriteria] = useState<string[]>(strategy?.entry_criteria ?? []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("name", name);
        fd.set("description", description);
        fd.set("rules_text", rulesText);
        for (const c of entryCriteria) fd.append("entry_criteria", c);
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

        <Field data-invalid={!!state.errors?.name}>
          <FieldLabel htmlFor="s-name">Name</FieldLabel>
          <Input
            id="s-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            placeholder="e.g. London breakout, Trend pullback"
            aria-invalid={!!state.errors?.name}
          />
          {state.errors?.name ? <FieldError errors={state.errors.name.map((m) => ({ message: m }))} /> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="s-description">Description</FieldLabel>
          <Textarea
            id="s-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
            placeholder="What is this setup, in a sentence or two?"
            rows={3}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="s-rules">Rules</FieldLabel>
          <Textarea
            id="s-rules"
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            disabled={pending}
            placeholder="The full playbook — entries, stops, targets, invalidation."
            rows={5}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="s-criteria">Entry criteria</FieldLabel>
          <TagInput
            value={entryCriteria}
            onChange={setEntryCriteria}
            disabled={pending}
            placeholder="Add a criterion and press Enter…"
          />
          <FieldDescription>
            Each trade logged against this strategy can be scored against this checklist —
            &quot;my A+ setups make money&quot; becomes a report instead of a feeling.
          </FieldDescription>
        </Field>

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create strategy"}
        </Button>
      </FieldGroup>
      {isEdit ? <SuccessToast pending={pending} error={state.formError} /> : null}
    </form>
  );
}

/** Same ref-gated useEffect pattern as account-edit-form.tsx's own
 *  SuccessToast: calling toast() during render is unsafe (render can run
 *  more than once for the same commit under StrictMode), so a ref tracks
 *  the previous pending value and the toast fires from an effect instead. */
function SuccessToast({ pending, error }: { pending: boolean; error: string | undefined }) {
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !error) {
      toast.success("Strategy updated.");
    }
    wasPending.current = pending;
  }, [pending, error]);

  return null;
}
