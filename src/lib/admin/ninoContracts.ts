export type AiModelRoute = {
  task: string;
  primary_model: string;
  fallback_model: string | null;
  max_latency_ms: number;
  max_steps: number;
  active: boolean;
};

export type KnowledgeEntry = {
  id: string;
  key: string;
  title: string;
  category: string;
  content: string;
  source_url: string | null;
  active: boolean;
  version: number;
};

export type SplitReminderPolicy = {
  enabled: boolean;
  due_soon_days_before: number;
  due_today_enabled: boolean;
  first_overdue_days: number;
  repeat_every_days: number;
  max_overdue_reminders: number;
  send_hour: number;
  pause_on_reply: boolean;
};
