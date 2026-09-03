import { z } from "zod";

export const journalEntrySchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date."),
  pre_market_plan: z.string().trim().max(4000).optional().or(z.literal("")),
  post_session_review: z.string().trim().max(4000).optional().or(z.literal("")),
  mood: z.string().trim().max(40).optional().or(z.literal("")),
  lessons: z.string().trim().max(4000).optional().or(z.literal("")),
});

export type JournalEntryFormValues = z.infer<typeof journalEntrySchema>;

export type JournalEntryFormState = {
  errors?: Partial<Record<keyof JournalEntryFormValues, string[]>>;
  formError?: string;
};
