export type Strategy = {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  rules_text: string | null;
  entry_criteria: string[];
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};
