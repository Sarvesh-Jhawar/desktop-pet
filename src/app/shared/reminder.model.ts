export interface Reminder {
  id: string;
  title: string;
  scheduledAt: string;
  completed: boolean;
  triggered: boolean;
  snoozedUntil?: string;
  repeatIntervalMinutes?: number;
}