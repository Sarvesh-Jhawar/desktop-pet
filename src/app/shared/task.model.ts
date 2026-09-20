export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string; // ISO string, e.g. "2026-09-25T14:00:00.000Z"
  createdAt: string; // ISO string
}