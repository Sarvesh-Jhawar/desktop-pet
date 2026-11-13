import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CalendarStoreService } from '../../core/calendar-store.service';
import { ReminderSchedulerService } from '../../core/reminder-scheduler.service';
import { CalendarEvent } from '../../shared/calendar-event.model';
import { CalendarView } from './calendar-view';

describe('CalendarView', () => {
  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-');
  const events: CalendarEvent[] = [
    {
      id: 'meeting-1',
      title: 'Planning meeting',
      date: todayKey,
      type: 'meeting'
    },
    {
      id: 'exam-1',
      title: 'Final exam',
      date: todayKey,
      type: 'exam',
      description: 'Study notes'
    }
  ];
  const store = {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    snoozeReminder: vi.fn(),
    dismissReminder: vi.fn()
  };
  const scheduler = { start: vi.fn() };
  let fixture: ComponentFixture<CalendarView>;

  beforeEach(async () => {
    vi.clearAllMocks();
    store.getAll.mockResolvedValue(events);
    await TestBed.configureTestingModule({
      imports: [CalendarView],
      providers: [
        { provide: CalendarStoreService, useValue: store },
        { provide: ReminderSchedulerService, useValue: scheduler }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarView);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('navigates to today and filters events by search and type', () => {
    fixture.componentInstance.changeMonth(-2);
    fixture.componentInstance.selectDate('2020-01-01');

    fixture.componentInstance.goToToday();
    expect(fixture.componentInstance.selectedDate()).toBe(todayKey);

    fixture.componentInstance.searchQuery.set('study');
    expect(fixture.componentInstance.filteredEvents().map(event => event.id)).toEqual(['exam-1']);
    fixture.componentInstance.typeFilter.set('meeting');
    expect(fixture.componentInstance.filteredEvents()).toEqual([]);
  });

  it('moves the selected date by a week with the arrow keys', () => {
    const component = fixture.componentInstance;
    const today = component.calendarDays().find(day => day.date === todayKey);
    expect(today).toBeDefined();
    const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
    const preventDefault = vi.spyOn(keyEvent, 'preventDefault');

    component.onDayKeydown(keyEvent, today!);

    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    const expectedDate = [
      expected.getFullYear(),
      String(expected.getMonth() + 1).padStart(2, '0'),
      String(expected.getDate()).padStart(2, '0')
    ].join('-');
    expect(component.selectedDate()).toBe(expectedDate);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('prefills the edit form and persists event changes', async () => {
    const component = fixture.componentInstance;
    component.editEvent({ ...events[0], reminderMinutesBefore: 15 });

    expect(component.newTitle).toBe('Planning meeting');
    expect(component.newReminderMinutes).toBe(15);
    component.newTitle = 'Updated meeting';
    store.update.mockResolvedValue({ ...events[0], title: component.newTitle });
    store.getAll.mockResolvedValue([{ ...events[0], title: component.newTitle }]);

    await component.addEvent();

    expect(store.update).toHaveBeenCalledWith(
      'meeting-1',
      expect.objectContaining({ title: 'Updated meeting', reminderMinutesBefore: 15 })
    );
    expect(component.isAddingEvent()).toBe(false);
  });

  afterEach(() => {
    fixture.componentInstance.ngOnDestroy();
  });
});
