export type JournalEntry = {
  id: number;
  user_id: string;
  entry_date: string;
  pre_market_plan: string | null;
  post_session_review: string | null;
  mood: string | null;
  lessons: string | null;
  created_at: string;
  updated_at: string;
};

/** One user, one calendar-date scope — never account-scoped or reset-timezone-aware.
 *  Journaling is a daily habit independent of any one account's session boundary,
 *  unlike prop.trading_day, which exists specifically to bucket account activity. */
export type JournalDaySummary = {
  entry_date: string;
  has_entry: boolean;
  mood: string | null;
};
