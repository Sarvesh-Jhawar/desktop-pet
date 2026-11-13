import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CalendarStoreService } from '../../core/calendar-store.service';
import { CalendarEvent, EventType } from '../../shared/calendar-event.model';
import { ReminderSchedulerService } from '../../core/reminder-scheduler.service';
import { listen, UnlistenFn } from '../../core/desktop-bridge';

interface CalendarDay {
  date: string;
  accessibleLabel: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  hasEvents: boolean;
}

@Component({
  selector: 'app-calendar-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './calendar-view.html',
  styleUrl: './calendar-view.css'
})
export class CalendarView implements OnInit, OnDestroy {
  private readonly store = inject(CalendarStoreService);
  private readonly reminderScheduler = inject(ReminderSchedulerService);

  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly reminderOptions: { value: number | null; label: string }[] = [
    { value: null, label: 'No reminder' },
    { value: 5, label: '5 minutes before' },
    { value: 15, label: '15 minutes before' },
    { value: 30, label: '30 minutes before' },
    { value: 60, label: '1 hour before' }
  ];
  readonly eventTypes: { value: EventType; label: string }[] = [
    { value: 'meeting', label: 'Meeting' },
    { value: 'deadline', label: 'Deadline' },
    { value: 'sprint', label: 'Coding sprint' },
    { value: 'exam', label: 'Exam' }
  ];

  readonly events = signal<CalendarEvent[]>([]);
  readonly month = signal(firstOfMonth(new Date()));
  readonly selectedDate = signal(toDateKey(new Date()));
  readonly isAddingEvent = signal(false);
  readonly isLoading = signal(true);
  readonly loadFailed = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly typeFilter = signal<EventType | 'all'>('all');
  readonly completionFilter = signal<'open' | 'completed' | 'all'>('open');
  readonly editingEventId = signal<string | null>(null);

  newTitle = '';
  newDate = toDateKey(new Date());
  newTime = '';
  newType: EventType = 'meeting';
  newDescription = '';
  newReminderMinutes: number | null = null;
  private unlistenCalendar?: UnlistenFn;

  readonly monthLabel = computed(() =>
    new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(this.month())
  );
  readonly calendarDays = computed(() => this.createCalendarDays());
  readonly selectedDateLabel = computed(() =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).format(fromDateKey(this.selectedDate()))
  );
  readonly filteredEvents = computed(() => {
    const query = this.searchQuery().trim().toLocaleLowerCase();
    return this.events().filter(event => {
      const matchesQuery =
        !query ||
        event.title.toLocaleLowerCase().includes(query) ||
        event.description?.toLocaleLowerCase().includes(query);
      const matchesType = this.typeFilter() === 'all' || event.type === this.typeFilter();
      const matchesCompletion =
        this.completionFilter() === 'all' ||
        (this.completionFilter() === 'completed' ? event.completed : !event.completed);
      return matchesQuery && matchesType && matchesCompletion;
    });
  });
  readonly selectedEvents = computed(() =>
    this.filteredEvents()
      .filter(event => event.date === this.selectedDate())
      .sort(compareEvents)
  );
  readonly upcomingEvents = computed(() =>
    this.filteredEvents()
      .filter(event => event.date >= toDateKey(new Date()))
      .sort(compareEvents)
      .slice(0, 5)
  );

  async ngOnInit(): Promise<void> {
    this.reminderScheduler.start();
    await this.refreshEvents();
    try {
      this.unlistenCalendar = await listen<CalendarEvent>(
        'calendar-event-triggered',
        event => {
          this.events.update(events =>
            events.map(existing => existing.id === event.payload.id ? event.payload : existing)
          );
        }
      );
    } catch (error) {
      this.showError('Could not listen for calendar reminders.', error);
    }
  }

  async refreshEvents(): Promise<void> {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    try {
      this.events.set(await this.store.getAll());
    } catch (error) {
      this.loadFailed.set(true);
      this.showError('Could not load calendar events.', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.unlistenCalendar?.();
  }

  changeMonth(offset: number): void {
    const current = this.month();
    this.month.set(new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    const selected = fromDateKey(date);
    if (
      selected.getMonth() !== this.month().getMonth() ||
      selected.getFullYear() !== this.month().getFullYear()
    ) {
      this.month.set(firstOfMonth(selected));
    }
  }

  goToToday(): void {
    const today = new Date();
    this.selectedDate.set(toDateKey(today));
    this.month.set(firstOfMonth(today));
  }

  onDayKeydown(event: KeyboardEvent, day: CalendarDay): void {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7
    };
    const offset = offsets[event.key];
    if (offset === undefined) return;

    event.preventDefault();
    const date = fromDateKey(day.date);
    date.setDate(date.getDate() + offset);
    const nextDate = toDateKey(date);
    this.selectedDate.set(nextDate);
    if (date.getMonth() !== this.month().getMonth()) {
      this.month.set(firstOfMonth(date));
    }
    setTimeout(() => document.getElementById(`calendar-day-${nextDate}`)?.focus());
  }

  openAddEvent(): void {
    this.error.set(null);
    this.editingEventId.set(null);
    this.newTitle = '';
    this.newDate = this.selectedDate();
    this.newTime = '';
    this.newType = 'meeting';
    this.newDescription = '';
    this.newReminderMinutes = null;
    this.isAddingEvent.set(true);
  }

  editEvent(event: CalendarEvent): void {
    this.error.set(null);
    this.editingEventId.set(event.id);
    this.newTitle = event.title;
    this.newDate = event.date;
    this.newTime = event.time ?? '';
    this.newType = event.type;
    this.newDescription = event.description ?? '';
    this.newReminderMinutes = event.reminderMinutesBefore ?? null;
    this.isAddingEvent.set(true);
  }

  cancelForm(): void {
    this.isAddingEvent.set(false);
    this.editingEventId.set(null);
  }

  async addEvent(): Promise<void> {
    const title = this.newTitle.trim();
    if (!title || !this.newDate) return;

    this.error.set(null);
    try {
      const eventInput = {
        title,
        date: this.newDate,
        time: this.newTime || undefined,
        type: this.newType,
        description: this.newDescription.trim() || undefined,
        reminderMinutesBefore: this.newReminderMinutes ?? undefined
      };
      const editingId = this.editingEventId();
      if (editingId) {
        const updated = await this.store.update(editingId, eventInput);
        if (!updated) throw new Error('The calendar event no longer exists.');
      } else {
        await this.store.create(eventInput);
      }
      this.events.set(await this.store.getAll());
      this.selectedDate.set(this.newDate);
      this.month.set(firstOfMonth(fromDateKey(this.newDate)));
      this.newTitle = '';
      this.newTime = '';
      this.newType = 'meeting';
      this.newDescription = '';
      this.newReminderMinutes = null;
      this.editingEventId.set(null);
      this.isAddingEvent.set(false);
    } catch (error) {
      this.showError('Could not save this calendar event.', error);
    }
  }

  async toggleComplete(event: CalendarEvent): Promise<void> {
    this.error.set(null);
    try {
      const updated = await this.store.update(event.id, { completed: !event.completed });
      if (!updated) throw new Error('The calendar event no longer exists.');
      this.events.set(await this.store.getAll());
    } catch (error) {
      this.showError('Could not update this calendar event.', error);
    }
  }

  async snoozeReminder(event: CalendarEvent): Promise<void> {
    this.error.set(null);
    try {
      await this.store.snoozeReminder(event.id);
      this.events.set(await this.store.getAll());
    } catch (error) {
      this.showError('Could not snooze this calendar reminder.', error);
    }
  }

  async dismissReminder(event: CalendarEvent): Promise<void> {
    this.error.set(null);
    try {
      await this.store.dismissReminder(event.id);
      this.events.set(await this.store.getAll());
    } catch (error) {
      this.showError('Could not dismiss this calendar reminder.', error);
    }
  }

  async deleteEvent(event: CalendarEvent): Promise<void> {
    this.error.set(null);
    try {
      await this.store.delete(event.id);
      this.events.set(await this.store.getAll());
    } catch (error) {
      this.showError('Could not delete this calendar event.', error);
    }
  }

  private createCalendarDays(): CalendarDay[] {
    const month = this.month();
    const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(
      firstDay.getFullYear(),
      firstDay.getMonth(),
      firstDay.getDate() - firstDay.getDay()
    );
    const today = toDateKey(new Date());
    const eventDates = new Set(this.events().map(event => event.date));

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index
      );
      const key = toDateKey(date);
      const hasEvents = eventDates.has(key);
      return {
        date: key,
        accessibleLabel: `${new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date)}${hasEvents ? ', has scheduled events' : ''}`,
        dayNumber: date.getDate(),
        isCurrentMonth: date.getMonth() === month.getMonth(),
        isToday: key === today,
        hasEvents
      };
    });
  }

  private showError(message: string, error: unknown): void {
    console.error(message, error);
    this.error.set(message);
  }
}

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromDateKey(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  return left.date.localeCompare(right.date) || (left.time ?? '').localeCompare(right.time ?? '');
}
