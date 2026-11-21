import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Dashboard } from './dashboard';

describe('Dashboard Notes and Stash sections', () => {
  let component: Dashboard;
  let fixture: ComponentFixture<Dashboard>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Dashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('creates and edits a note from the dashboard Notes tab', async () => {
    component.activeTab.set('notes');
    fixture.detectChanges();

    component.createNote();
    const note = component.notesService.activeNote();
    expect(note).toBeTruthy();
    component.updateNoteContent(note!.id, 'Dashboard note\nSaved automatically');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('#dashboard-notes-title').textContent).toContain(
      'Quick Notes',
    );
    expect((fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'Dashboard note\nSaved automatically',
    );
    expect(localStorage.getItem('milly.quick-notes.v1')).toContain(
      'Dashboard note\\nSaved automatically',
    );
  });

  it('opens the Stash section from a dashboard tab', () => {
    component.activeTab.set('stash');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#dashboard-stash-title').textContent).toContain(
      'Quick Stash',
    );
    expect(fixture.nativeElement.querySelector('.dashboard-empty').textContent).toContain(
      'Grab current clipboard',
    );
  });

  it('shows every exported note file rather than only the newest one', () => {
    component.activeTab.set('notes');
    component.notesService.exportFiles.set([
      { name: 'meeting.md', size: 120, modifiedAt: new Date().toISOString() },
      { name: 'shopping.txt', size: 80, modifiedAt: new Date().toISOString() },
    ]);
    fixture.detectChanges();

    const fileElements = fixture.nativeElement.querySelectorAll(
      '.dashboard-exported-file strong',
    ) as NodeListOf<HTMLElement>;
    const files = Array.from(fileElements).map((element) => element.textContent?.trim());
    expect(files).toEqual(['meeting.md', 'shopping.txt']);
  });
});
