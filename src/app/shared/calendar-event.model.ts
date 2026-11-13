export type EventType = 'meeting' | 'deadline' | 'sprint' | 'exam';

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time?: string;
  type: EventType;
  description?: string;
  completed?: boolean;
  reminderMinutesBefore?: number;
  reminderTriggered?: boolean;
  reminderSnoozedUntil?: string;
  reminderDismissed?: boolean;
}
