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
 * This wizard captures everything the CURRENT schema supports and says so
 * plainly on the firm step, rather than pretending to capture rules it has
 * nowhere to put.
 */

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
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
import { TimezoneCombobox } from "@/components/accounts/timezone-combobox";
import { createAccount } from "@/lib/accounts/actions";
import { isAtLimit, type PlanLimit } from "@/lib/accounts/limits";
import { accountSchema } from "@/lib/accounts/schema";
import {
  COMMON_BROKER_PLATFORMS,
  COMMON_PROP_FIRMS,
  PRIMARY_MARKETS,
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
  ["name", "broker_platform", "prop_firm_name", "primary_market"],
  ["starting_balance", "currency", "reset_timezone", "reset_time"],
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
      primary_market: "",
      starting_balance: 0,
      currency: "USD",
      reset_timezone: detectBrowserTimezone(),
      reset_time: "00:00",
      day_label_offset: 0,
    },
  });

  const accountType = form.watch("account_type");
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
    fd.set("primary_market", values.primary_market ?? "");
    fd.set("starting_balance", String(values.starting_balance));
    fd.set("currency", values.currency);
    fd.set("reset_timezone", values.reset_timezone);
    fd.set("reset_time", values.reset_time);
    fd.set("day_label_offset", String(values.day_label_offset));

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
                  placeholder={
                    accountType === "prop_firm" ? "FTMO 100k #1" : "Main FX account"
                  }
                  {...form.register("name")}
                  aria-invalid={!!form.formState.errors.name}
                />
                {form.formState.errors.name ? (
                  <FieldError errors={[form.formState.errors.name]} />
                ) : null}
              </Field>

              {accountType === "prop_firm" ? (
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
              ) : null}

              <Field>
                <FieldLabel htmlFor="w-platform">
                  Broker / platform{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </FieldLabel>
                <Input
                  id="w-platform"
                  list="broker-platform-options"
                  placeholder="MT5, Bybit, cTrader…"
                  {...form.register("broker_platform")}
                />
                <datalist id="broker-platform-options">
                  {COMMON_BROKER_PLATFORMS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>

              <Field>
                <FieldLabel htmlFor="w-market">
                  Primary market{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </FieldLabel>
                <Select
                  value={form.watch("primary_market") || undefined}
                  onValueChange={(v) => form.setValue("primary_market", v as never)}
                >
                  <SelectTrigger id="w-market" className="w-full">
                    <SelectValue placeholder="No preference" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIMARY_MARKETS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  A grouping hint — every trade still records its own asset
                  class.
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
                  <Input
                    id="w-currency"
                    maxLength={3}
                    className="uppercase"
                    {...form.register("currency")}
                    aria-invalid={!!form.formState.errors.currency}
                  />
                  {form.formState.errors.currency ? (
                    <FieldError errors={[form.formState.errors.currency]} />
                  ) : null}
                </Field>
              </div>

              <Field data-invalid={!!form.formState.errors.reset_timezone}>
                <FieldLabel>When does your trading day reset?</FieldLabel>
                <FieldDescription>
                  Prop firm daily-loss limits reset at the FIRM&rsquo;s clock,
                  not yours. We&rsquo;ve guessed your own timezone as a
                  starting point —{" "}
                  <strong>check your firm&rsquo;s rules or platform</strong>{" "}
                  for the real reset time before relying on this.
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
              <Button type="submit" disabled={pending} className="gap-1">
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Create account
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

function ReviewStep({ values }: { values: WizardInput }) {
  const rows: (readonly [string, string])[] = [
    ["Type", values.account_type === "prop_firm" ? "Prop firm" : "Personal"],
    ["Name", values.name],
    ...(values.prop_firm_name ? ([["Firm", values.prop_firm_name]] as const) : []),
    ...(values.broker_platform
      ? ([["Broker / platform", values.broker_platform]] as const)
      : []),
    ...(values.primary_market
      ? ([["Primary market", values.primary_market]] as const)
      : []),
    [
      "Starting balance",
      `${Number(values.starting_balance).toLocaleString()} ${values.currency}`,
    ],
    ["Trading day reset", `${values.reset_time} ${values.reset_timezone}`],
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
