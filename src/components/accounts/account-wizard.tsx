"use client";

/**
 * Multi-step onboarding wizard.
 *
 * Deliberately react-hook-form + Controller here, unlike the plain
 * <form action> + useActionState pattern used elsewhere (auth-form.tsx, the
 * account edit form). Native forms have no good primitive for "validate the
 * CURRENT step and block advancing without submitting anything" — RHF's
 * per-field validation state and `trigger()` do. On the final step, the
 * validated values are packed into a FormData and handed to the same
 * createAccount server action every other write in this app goes through —
 * the action re-validates them regardless, per the shared-schema rule in
 * schema.ts.
 *
 * SCOPE NOTE: the spec's original onboarding flow has phase-setup and
 * withdrawal-rule steps. Those need prop_firm_profiles / phase_rules /
 * challenge_instances, which do not exist yet — that is the rule engine
 * (M6), deliberately much harder work (versioned profiles, drawdown
 * variants, phase topology) than an accounts CRUD milestone should absorb.
 * challenge_type and the daily/max loss-limit fields below are lightweight
 * labels/thresholds this schema DOES support (see the wizard-v2 migration) —
 * still not the rule engine, and each field says so where it matters.
 */

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssetClassToggles } from "@/components/accounts/asset-class-toggles";
import { LossLimitField } from "@/components/accounts/loss-limit-field";
import { PickOrOtherField } from "@/components/accounts/pick-or-other-field";
import { TimezoneCombobox } from "@/components/accounts/timezone-combobox";
import { createAccount } from "@/lib/accounts/actions";
import { isAtLimit, type PlanLimit } from "@/lib/accounts/limits";
import { accountSchema } from "@/lib/accounts/schema";
import {
  CHALLENGE_TYPES,
  COMMON_BROKER_PLATFORMS,
  COMMON_PROP_FIRMS,
  CURRENCY_OPTIONS,
  NEEDS_CONSISTENCY_RULE,
  PHASES_FOR_CHALLENGE_TYPE,
  type ChallengeType,
} from "@/lib/accounts/types";
import { cn } from "@/lib/utils";

// z.coerce.number() on starting_balance makes the SCHEMA's input type differ
// from its output type (input: unknown/string from a form field, output: a
// real number) — RHF's resolver needs both halves, or the compiler cannot
// tell that the resolver's output actually satisfies what onSubmit receives.
type WizardInput = z.input<typeof accountSchema>;
type WizardOutput = z.output<typeof accountSchema>;

type Entitlements = {
  counts: { personal: number; prop_firm: number };
  limits: { personal: PlanLimit; prop_firm: PlanLimit };
};

const STEPS = ["Type", "Details", "Trading day", "Review"] as const;

// Fields validated before advancing OFF each step (index-aligned with STEPS).
// The last step has nothing new to validate — everything was already checked
// getting there.
const STEP_FIELDS: (keyof WizardInput)[][] = [
  ["account_type"],
  ["name", "broker_platform", "prop_firm_name", "challenge_type", "asset_classes"],
  [
    "starting_balance",
    "currency",
    "reset_timezone",
    "reset_time",
    "daily_loss_limit_value",
    "max_loss_limit_value",
    "consistency_rule_pct",
    "phase_1_profit_target_value",
    "phase_2_profit_target_value",
    "phase_3_profit_target_value",
  ],
  [],
];

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function AccountWizard({ entitlements }: { entitlements: Entitlements }) {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<WizardInput, unknown, WizardOutput>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      account_type: "personal",
      name: "",
      broker_platform: "",
      prop_firm_name: "",
      challenge_type: "",
      asset_classes: [],
      starting_balance: 0,
      currency: "USD",
      reset_timezone: detectBrowserTimezone(),
      reset_time: "00:00",
      day_label_offset: 0,
      daily_loss_limit_type: "",
      daily_loss_limit_value: "",
      max_loss_limit_type: "",
      max_loss_limit_value: "",
      consistency_rule_pct: "",
      phase_1_profit_target_type: "",
      phase_1_profit_target_value: "",
      phase_2_profit_target_type: "",
      phase_2_profit_target_value: "",
      phase_3_profit_target_type: "",
      phase_3_profit_target_value: "",
    },
  });

  const accountType = form.watch("account_type");
  const isProp = accountType === "prop_firm";
  const challengeType = form.watch("challenge_type") as ChallengeType | "" | undefined;
  const relevantPhases = challengeType ? PHASES_FOR_CHALLENGE_TYPE[challengeType] : [];
  const needsConsistency = challengeType ? NEEDS_CONSISTENCY_RULE[challengeType] : false;
  const personalAtCap = isAtLimit(
    entitlements.counts.personal,
    entitlements.limits.personal,
  );
  const propAtCap = isAtLimit(
    entitlements.counts.prop_firm,
    entitlements.limits.prop_firm,
  );
  // Cards being disabled is a visual hint, not a gate: without this, a user
  // who never explicitly picks a type keeps the default ("personal") even
  // when it is at cap, sails through all 4 steps, and only discovers the
  // problem as a generic server error at final submit. Found live — clicking
  // "Next" on step 1 with no selection advanced past a disabled Personal
  // card with nothing stopping it.
  const currentTypeAtCap =
    accountType === "personal" ? personalAtCap : propAtCap;
  const bothTypesAtCap = personalAtCap && propAtCap;

  async function goNext() {
    if (step === 0 && currentTypeAtCap) return;
    const fields = STEP_FIELDS[step];
    const valid = fields.length === 0 || (await form.trigger(fields));
    if (!valid) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function onSubmit(values: WizardOutput) {
    setSubmitError(null);
    const fd = new FormData();
    fd.set("name", values.name);
    fd.set("account_type", values.account_type);
    fd.set("broker_platform", values.broker_platform ?? "");
    fd.set("prop_firm_name", values.prop_firm_name ?? "");
    fd.set("challenge_type", values.challenge_type ?? "");
    for (const a of values.asset_classes) fd.append("asset_classes", a);
    fd.set("starting_balance", String(values.starting_balance));
    fd.set("currency", values.currency);
    fd.set("reset_timezone", values.reset_timezone);
    fd.set("reset_time", values.reset_time);
    fd.set("day_label_offset", String(values.day_label_offset));
    fd.set("daily_loss_limit_type", values.daily_loss_limit_type ?? "");
    fd.set(
      "daily_loss_limit_value",
      values.daily_loss_limit_value === "" || values.daily_loss_limit_value === undefined
        ? ""
        : String(values.daily_loss_limit_value),
    );
    fd.set("max_loss_limit_type", values.max_loss_limit_type ?? "");
    fd.set(
      "max_loss_limit_value",
      values.max_loss_limit_value === "" || values.max_loss_limit_value === undefined
        ? ""
        : String(values.max_loss_limit_value),
    );
    fd.set(
      "consistency_rule_pct",
      values.consistency_rule_pct === "" || values.consistency_rule_pct === undefined
        ? ""
        : String(values.consistency_rule_pct),
    );
    for (const n of [1, 2, 3] as const) {
      const type = values[`phase_${n}_profit_target_type`];
      const value = values[`phase_${n}_profit_target_value`];
      fd.set(`phase_${n}_profit_target_type`, type ?? "");
      fd.set(
        `phase_${n}_profit_target_value`,
        value === "" || value === undefined ? "" : String(value),
      );
    }

    startTransition(async () => {
      // createAccount redirects on success, which surfaces as a thrown
      // NEXT_REDIRECT — there is no successful branch to handle here.
      const result = await createAccount({}, fd);
      if (result?.error) {
        setSubmitError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>New account</CardTitle>
        <CardDescription>
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </CardDescription>
        <Progress value={((step + 1) / STEPS.length) * 100} className="mt-2" />
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {submitError ? (
            <Alert variant="destructive" className="mb-4" role="alert">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          {step === 0 && (
            <FieldGroup>
              <div className="grid grid-cols-2 gap-3">
                <TypeCard
                  label="Personal"
                  description="Your own capital."
                  selected={accountType === "personal"}
                  disabled={personalAtCap}
                  disabledReason={
                    personalAtCap
                      ? `You've used ${entitlements.counts.personal} of your plan's personal account allowance.`
                      : undefined
                  }
                  onSelect={() => form.setValue("account_type", "personal")}
                />
                <TypeCard
                  label="Prop firm"
                  description="A funded or evaluation challenge."
                  selected={accountType === "prop_firm"}
                  disabled={propAtCap}
                  disabledReason={
                    propAtCap
                      ? `You've used ${entitlements.counts.prop_firm} of your plan's prop firm account allowance.`
                      : undefined
                  }
                  onSelect={() => form.setValue("account_type", "prop_firm")}
                />
              </div>
              {bothTypesAtCap ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>
                    You&rsquo;ve used every account your plan allows. Archive
                    an existing account to add another.
                  </AlertDescription>
                </Alert>
              ) : currentTypeAtCap ? (
                <p className="text-muted-foreground text-xs">
                  Pick the other type above to continue, or archive an
                  existing account to free up this one.
                </p>
              ) : null}
            </FieldGroup>
          )}

          {step === 1 && (
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.name}>
                <FieldLabel htmlFor="w-name">Account name</FieldLabel>
                <Input
                  id="w-name"
                  placeholder={isProp ? "FTMO 100k #1" : "Main FX account"}
                  {...form.register("name")}
                  aria-invalid={!!form.formState.errors.name}
                />
                {form.formState.errors.name ? (
                  <FieldError errors={[form.formState.errors.name]} />
                ) : null}
              </Field>

              {isProp ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="w-firm">Firm</FieldLabel>
                    <Input
                      id="w-firm"
                      list="prop-firm-options"
                      placeholder="FTMO, Apex, Topstep…"
                      {...form.register("prop_firm_name")}
                    />
                    <datalist id="prop-firm-options">
                      {COMMON_PROP_FIRMS.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                    <FieldDescription>
                      A label only, for now — phase progress and rule tracking
                      for your firm are coming in a later update.
                    </FieldDescription>
                  </Field>

                  <Field data-invalid={!!form.formState.errors.challenge_type}>
                    <FieldLabel htmlFor="w-challenge-type">
                      Type of account
                    </FieldLabel>
                    <Select
                      value={form.watch("challenge_type") || undefined}
                      onValueChange={(v) =>
                        form.setValue("challenge_type", v as never, {
                          shouldValidate: true,
                        })
                      }
                    >
                      <SelectTrigger
                        id="w-challenge-type"
                        className="w-full"
                        aria-invalid={!!form.formState.errors.challenge_type}
                      >
                        <SelectValue placeholder="Instant, 1/2/3 phase…" />
                      </SelectTrigger>
                      <SelectContent>
                        {CHALLENGE_TYPES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.formState.errors.challenge_type ? (
                      <FieldError errors={[form.formState.errors.challenge_type]} />
                    ) : null}
                  </Field>
                </>
              ) : null}

              <Field data-invalid={!!form.formState.errors.broker_platform}>
                <FieldLabel htmlFor="w-platform">Trading platform</FieldLabel>
                <PickOrOtherField
                  id="w-platform"
                  value={form.watch("broker_platform")}
                  onChange={(v) =>
                    form.setValue("broker_platform", v, { shouldValidate: true })
                  }
                  options={COMMON_BROKER_PLATFORMS.filter((p) => p !== "Other")}
                  placeholder="Select your platform…"
                  otherPlaceholder="Name your platform"
                />
                {form.formState.errors.broker_platform ? (
                  <FieldError errors={[form.formState.errors.broker_platform]} />
                ) : null}
              </Field>

              <Field>
                <FieldLabel>
                  Assets to trade on this account{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </FieldLabel>
                <AssetClassToggles
                  value={form.watch("asset_classes") ?? []}
                  onChange={(v) => form.setValue("asset_classes", v)}
                />
                <FieldDescription>
                  A grouping hint — every trade still records its own asset
                  class. Pick as many as apply, or none.
                </FieldDescription>
              </Field>
            </FieldGroup>
          )}

          {step === 2 && (
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Field data-invalid={!!form.formState.errors.starting_balance}>
                  <FieldLabel htmlFor="w-balance">Starting balance</FieldLabel>
                  <Input
                    id="w-balance"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    {...form.register("starting_balance")}
                    // Defaults to 0, so clicking in and typing without this
                    // would APPEND rather than replace — "100000" typed into
                    // a field showing "0" becomes "0100000". Reproduced live
                    // while testing this wizard. Select-on-focus is the
                    // standard fix for a numeric field with a live default.
                    onFocus={(e) => e.currentTarget.select()}
                    aria-invalid={!!form.formState.errors.starting_balance}
                  />
                  {form.formState.errors.starting_balance ? (
                    <FieldError errors={[form.formState.errors.starting_balance]} />
                  ) : null}
                </Field>
                <Field data-invalid={!!form.formState.errors.currency}>
                  <FieldLabel htmlFor="w-currency">Currency</FieldLabel>
                  <PickOrOtherField
                    id="w-currency"
                    value={form.watch("currency")}
                    onChange={(v) =>
                      form.setValue("currency", v.toUpperCase(), {
                        shouldValidate: true,
                      })
                    }
                    options={CURRENCY_OPTIONS}
                    otherPlaceholder="e.g. AUD, JPY, USDC"
                  />
                  {form.formState.errors.currency ? (
                    <FieldError errors={[form.formState.errors.currency]} />
                  ) : null}
                </Field>
              </div>

              <Field data-invalid={!!form.formState.errors.reset_timezone}>
                <FieldLabel>When does your trading day reset?</FieldLabel>
                <FieldDescription>
                  {isProp ? (
                    <>
                      Your firm&rsquo;s daily-loss limits reset at THEIR
                      clock, not yours. We&rsquo;ve guessed your own timezone
                      as a starting point —{" "}
                      <strong>check your firm&rsquo;s rules or platform</strong>{" "}
                      for the real reset time before relying on this.
                    </>
                  ) : (
                    <>
                      This decides which calendar day a trade counts toward in
                      your journal. We&rsquo;ve guessed your own timezone —
                      change it if your broker&rsquo;s server runs on a
                      different one.
                    </>
                  )}
                </FieldDescription>
                <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
                  <TimezoneCombobox
                    value={form.watch("reset_timezone")}
                    onChange={(z) =>
                      form.setValue("reset_timezone", z, { shouldValidate: true })
                    }
                  />
                  <Input
                    type="time"
                    className="w-28"
                    {...form.register("reset_time")}
                  />
                </div>
                {form.formState.errors.reset_timezone ? (
                  <FieldError errors={[form.formState.errors.reset_timezone]} />
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="w-offset">
                  Does the session that opens after reset belong to the next
                  calendar date?
                </FieldLabel>
                <Select
                  value={String(form.watch("day_label_offset"))}
                  onValueChange={(v) =>
                    form.setValue("day_label_offset", Number(v) as 0 | 1)
                  }
                >
                  <SelectTrigger id="w-offset" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">
                      No — the day simply starts at reset
                    </SelectItem>
                    <SelectItem value="1">
                      Yes — e.g. a 5pm reset opening &ldquo;tomorrow&rdquo;
                      (CME/futures convention)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Not sure? Leave this as &ldquo;No&rdquo; — it only matters
                  for futures-style firms with an evening reset.
                </FieldDescription>
              </Field>

              <Field data-invalid={!!form.formState.errors.daily_loss_limit_value}>
                <FieldLabel htmlFor="w-daily-limit">
                  {isProp ? "Daily drawdown limit" : "Daily loss limit"}{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </FieldLabel>
                <LossLimitField
                  id="w-daily-limit"
                  type={form.watch("daily_loss_limit_type") ?? ""}
                  value={String(form.watch("daily_loss_limit_value") ?? "")}
                  onTypeChange={(v) =>
                    form.setValue("daily_loss_limit_type", v, { shouldValidate: true })
                  }
                  onValueChange={(v) =>
                    form.setValue("daily_loss_limit_value", v as never, {
                      shouldValidate: true,
                    })
                  }
                />
                {form.formState.errors.daily_loss_limit_value ? (
                  <FieldError errors={[form.formState.errors.daily_loss_limit_value]} />
                ) : (
                  <FieldDescription>
                    We&rsquo;ll show how close you are to this, computed from
                    your logged trades. No push alerts yet.
                  </FieldDescription>
                )}
              </Field>

              <Field data-invalid={!!form.formState.errors.max_loss_limit_value}>
                <FieldLabel htmlFor="w-max-limit">
                  {isProp ? "Max drawdown limit" : "Max loss limit"}{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </FieldLabel>
                <LossLimitField
                  id="w-max-limit"
                  type={form.watch("max_loss_limit_type") ?? ""}
                  value={String(form.watch("max_loss_limit_value") ?? "")}
                  onTypeChange={(v) =>
                    form.setValue("max_loss_limit_type", v, { shouldValidate: true })
                  }
                  onValueChange={(v) =>
                    form.setValue("max_loss_limit_value", v as never, {
                      shouldValidate: true,
                    })
                  }
                />
                {form.formState.errors.max_loss_limit_value ? (
                  <FieldError errors={[form.formState.errors.max_loss_limit_value]} />
                ) : (
                  <FieldDescription>
                    Measured from your starting balance — a static floor, not
                    a trailing high-water mark.
                  </FieldDescription>
                )}
              </Field>

              {isProp && relevantPhases.length > 0
                ? relevantPhases.map((n) => {
                    const typeField = `phase_${n}_profit_target_type` as const;
                    const valueField = `phase_${n}_profit_target_value` as const;
                    const errorField = form.formState.errors[valueField];
                    return (
                      <Field key={n} data-invalid={!!errorField}>
                        <FieldLabel htmlFor={`w-phase-${n}-target`}>
                          {relevantPhases.length > 1
                            ? `Phase ${n} profit target`
                            : "Profit target"}{" "}
                          <span className="text-muted-foreground font-normal">
                            (optional)
                          </span>
                        </FieldLabel>
                        <LossLimitField
                          id={`w-phase-${n}-target`}
                          type={form.watch(typeField) ?? ""}
                          value={String(form.watch(valueField) ?? "")}
                          onTypeChange={(v) =>
                            form.setValue(typeField, v, { shouldValidate: true })
                          }
                          onValueChange={(v) =>
                            form.setValue(valueField, v as never, {
                              shouldValidate: true,
                            })
                          }
                        />
                        {errorField ? (
                          <FieldError errors={[errorField]} />
                        ) : null}
                      </Field>
                    );
                  })
                : null}

              {isProp && needsConsistency ? (
                <Field data-invalid={!!form.formState.errors.consistency_rule_pct}>
                  <FieldLabel htmlFor="w-consistency">
                    Consistency rule{" "}
                    <span className="text-muted-foreground font-normal">
                      (optional)
                    </span>
                  </FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="w-consistency"
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      max="100"
                      placeholder="e.g. 30"
                      className="w-28"
                      {...form.register("consistency_rule_pct")}
                    />
                    <span className="text-muted-foreground text-sm">
                      % of total profit, max in a single day
                    </span>
                  </div>
                  {form.formState.errors.consistency_rule_pct ? (
                    <FieldError errors={[form.formState.errors.consistency_rule_pct]} />
                  ) : (
                    <FieldDescription>
                      For a valid withdrawal — most firms use around 30%.
                    </FieldDescription>
                  )}
                </Field>
              ) : null}
            </FieldGroup>
          )}

          {step === 3 && <ReviewStep values={form.getValues()} />}

          <div className="mt-6 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={goBack}
              disabled={step === 0 || pending}
              className="gap-1"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>

            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={goNext}
                disabled={step === 0 && currentTypeAtCap}
                className="gap-1"
              >
                Next
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create account"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TypeCard({
  label,
  description,
  selected,
  disabled,
  disabledReason,
  onSelect,
}: {
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "rounded-lg border p-4 text-left transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        !disabled && selected && "border-primary bg-primary/5",
        !disabled && !selected && "hover:bg-accent",
      )}
    >
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground mt-1 text-xs">
        {disabled ? disabledReason : description}
      </div>
    </button>
  );
}

function formatLossLimit(
  type: string | undefined,
  value: number | "" | undefined,
  currency: string,
): string | null {
  if (!type || value === "" || value === undefined) return null;
  return type === "percent" ? `${value}%` : `${value} ${currency}`;
}

function ReviewStep({ values }: { values: WizardInput }) {
  const challengeLabel = CHALLENGE_TYPES.find(
    (c) => c.value === values.challenge_type,
  )?.label;
  // z.input of a z.coerce.number() field is `unknown` by zod's own design
  // (coerce accepts any input prior to coercing it) — the cast below just
  // names what the value actually is at runtime, guaranteed by RHF +
  // zodResolver, not a bypass of a real check.
  const dailyLimit = formatLossLimit(
    values.daily_loss_limit_type,
    values.daily_loss_limit_value as number | "" | undefined,
    values.currency,
  );
  const maxLimit = formatLossLimit(
    values.max_loss_limit_type,
    values.max_loss_limit_value as number | "" | undefined,
    values.currency,
  );
  const phaseTargetRows: (readonly [string, string])[] = [];
  for (const n of [1, 2, 3] as const) {
    const label: string = `Phase ${n} profit target`;
    const formatted = formatLossLimit(
      values[`phase_${n}_profit_target_type`],
      values[`phase_${n}_profit_target_value`] as number | "" | undefined,
      values.currency,
    );
    if (formatted) phaseTargetRows.push([label, formatted]);
  }
  const consistency =
    values.consistency_rule_pct === "" || values.consistency_rule_pct === undefined
      ? null
      : `${values.consistency_rule_pct as number}% max/day`;

  const rows: (readonly [string, string])[] = [
    ["Type", values.account_type === "prop_firm" ? "Prop firm" : "Personal"],
    ["Name", values.name],
    ...(values.prop_firm_name ? ([["Firm", values.prop_firm_name]] as const) : []),
    ...(challengeLabel ? ([["Account type", challengeLabel]] as const) : []),
    ...(values.broker_platform
      ? ([["Trading platform", values.broker_platform]] as const)
      : []),
    ...((values.asset_classes ?? []).length
      ? ([["Assets to trade", (values.asset_classes ?? []).join(", ")]] as const)
      : []),
    [
      "Starting balance",
      `${Number(values.starting_balance).toLocaleString()} ${values.currency}`,
    ],
    ["Trading day reset", `${values.reset_time} ${values.reset_timezone}`],
    ...(dailyLimit
      ? ([[values.account_type === "prop_firm" ? "Daily drawdown limit" : "Daily loss limit", dailyLimit]] as const)
      : []),
    ...(maxLimit
      ? ([[values.account_type === "prop_firm" ? "Max drawdown limit" : "Max loss limit", maxLimit]] as const)
      : []),
    ...phaseTargetRows,
    ...(consistency ? ([["Consistency rule", consistency]] as const) : []),
  ];

  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 border-b pb-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
