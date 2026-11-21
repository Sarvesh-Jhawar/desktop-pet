import { NotesService } from './notes.service';

describe('NotesService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('persists edited notes and derives a title from the first line', () => {
    const service = new NotesService();
    const note = service.createNote();
    service.updateContent(note.id, 'Plan for Monday\nBring the draft');

    const reloadedService = new NotesService();
    const reloadedNote = reloadedService.activeNote();

    expect(reloadedNote?.content).toBe('Plan for Monday\nBring the draft');
    expect(reloadedService.getTitle(reloadedNote!)).toBe('Plan for Monday');
  });

  it("updates another window's note list when storage changes", () => {
    const dashboardService = new NotesService();
    const petService = new NotesService();
    const note = petService.createNote();

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'milly.quick-notes.v1',
      newValue: localStorage.getItem('milly.quick-notes.v1')
    }));

    expect(dashboardService.activeNoteId()).toBe(note.id);
    expect(dashboardService.activeNote()?.id).toBe(note.id);
  });

  it('uses an editable title and sanitizes invalid filename characters', () => {
    const service = new NotesService();
    const note = service.createNote();
    service.updateContent(note.id, 'Fallback title');
    service.updateTitle(note.id, 'API / Auth: v2?');

    expect(service.getFileName(service.activeNote()!, 'txt')).toBe('API - Auth- v2-.txt');
    expect(service.getFileName({ ...note, title: '   ', content: '' }, 'md')).toBe(
      'Untitled note.md',
    );
    expect(service.getFileName({ ...note, title: 'CON' }, 'txt')).toBe('note-CON.txt');
  });

  it('deletes a note and selects the next available one', () => {
    const service = new NotesService();
    const first = service.createNote();
    const second = service.createNote();

    service.deleteNote(second.id);

    expect(service.activeNoteId()).toBe(first.id);
    expect(service.notes().map((note) => note.id)).toEqual([first.id]);
  });
});
