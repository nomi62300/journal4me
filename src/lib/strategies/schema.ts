import { z } from "zod";

export const strategySchema = z.object({
  name: z.string().trim().min(1, "Required.").max(80, "80 characters max."),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  rules_text: z.string().trim().max(4000).optional().or(z.literal("")),
  entry_criteria: z.array(z.string().trim().min(1)).max(30),
});

export type StrategyFormValues = z.infer<typeof strategySchema>;

export type StrategyFormState = {
  errors?: Partial<Record<keyof StrategyFormValues, string[]>>;
  formError?: string;
};
