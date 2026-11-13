import { TestBed } from '@angular/core/testing';
import { CalendarStoreService } from './calendar-store.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';

describe('ReminderSchedulerService calendar reminders', () => {
  const storageKey = 'desktop-pet:settings.json';
  let calendarStore: CalendarStoreService;
  let scheduler: ReminderSchedulerService;

  beforeEach(() => {
    localStorage.removeItem(storageKey);
    TestBed.configureTestingModule({
      providers: [CalendarStoreService, ReminderSchedulerService]
    });
    calendarStore = TestBed.inject(CalendarStoreService);
    scheduler = TestBed.inject(ReminderSchedulerService);
  });

  afterEach(() => {
    scheduler.stop();
    localStorage.removeItem(storageKey);
  });

  it('triggers an advance reminder once the lead time begins', async () => {
    const startTime = new Date(Date.now() + 2 * 60_000);
    const date = [
      startTime.getFullYear(),
      String(startTime.getMonth() + 1).padStart(2, '0'),
      String(startTime.getDate()).padStart(2, '0')
    ].join('-');
    const time = [
      String(startTime.getHours()).padStart(2, '0'),
      String(startTime.getMinutes()).padStart(2, '0')
    ].join(':');

    const event = await calendarStore.create({
      title: 'Project review',
      date,
      time,
      type: 'meeting',
      reminderMinutesBefore: 5
    });

    await scheduler.checkDue();

    expect((await calendarStore.getAll()).find(item => item.id === event.id)?.reminderTriggered)
      .toBe(true);
  });
});
