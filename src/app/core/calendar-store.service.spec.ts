import { TestBed } from '@angular/core/testing';
import { CalendarStoreService } from './calendar-store.service';

describe('CalendarStoreService', () => {
  const storageKey = 'desktop-pet:settings.json';
  let service: CalendarStoreService;

  beforeEach(() => {
    localStorage.removeItem(storageKey);
    TestBed.configureTestingModule({
      providers: [CalendarStoreService]
    });
    service = TestBed.inject(CalendarStoreService);
  });

  afterEach(() => {
    localStorage.removeItem(storageKey);
  });

  it('creates and persists calendar events', async () => {
    const event = await service.create({
      title: 'Project review',
      date: '2026-11-18',
      time: '10:00',
      type: 'meeting'
    });

    expect(event.id).toBeTruthy();
    expect(await service.getAll()).toEqual([event]);
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}').calendarEvents).toEqual([event]);
  });

  it('deletes only the selected event', async () => {
    const first = await service.create({
      title: 'Planning',
      date: '2026-11-18',
      type: 'sprint'
    });
    const second = await service.create({
      title: 'Exam',
      date: '2026-11-20',
      type: 'exam'
    });

    await service.delete(first.id);

    expect(await service.getAll()).toEqual([second]);
  });

  it('resets the reminder state when the event schedule changes', async () => {
    const event = await service.create({
      title: 'Review',
      date: '2026-11-18',
      time: '10:00',
      type: 'meeting',
      reminderMinutesBefore: 15,
      reminderTriggered: true,
      reminderDismissed: true,
      reminderSnoozedUntil: new Date().toISOString()
    });

    await service.update(event.id, { time: '11:00' });

    const updated = (await service.getAll())[0];
    expect(updated.reminderTriggered).toBe(false);
    expect(updated.reminderDismissed).toBe(false);
    expect(updated.reminderSnoozedUntil).toBeUndefined();
  });

  it('snoozes and dismisses a reminder without completing its event', async () => {
    const event = await service.create({
      title: 'Planning',
      date: '2026-11-18',
      time: '10:00',
      type: 'sprint',
      reminderMinutesBefore: 5,
      reminderTriggered: true
    });

    await service.snoozeReminder(event.id);
    let updated = (await service.getAll())[0];
    expect(updated.reminderTriggered).toBe(false);
    expect(new Date(updated.reminderSnoozedUntil ?? 0).getTime()).toBeGreaterThan(Date.now());

    await service.dismissReminder(event.id);
    updated = (await service.getAll())[0];
    expect(updated.reminderTriggered).toBe(true);
    expect(updated.reminderDismissed).toBe(true);
    expect(updated.completed).toBeFalsy();
  });
});
