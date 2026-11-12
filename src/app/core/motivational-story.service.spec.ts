import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MotivationalStoryService } from './motivational-story.service';

describe('MotivationalStoryService', () => {
  let service: MotivationalStoryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MotivationalStoryService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(MotivationalStoryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads stories lazily and selects each story before repeating', async () => {
    const first = service.next();
    http.expectOne('/assets/data/motivational-stories.json').flush([
      {
        id: 'story-1',
        title: 'First',
        category: 'resilience',
        story: 'Story one.',
        takeaway: 'Keep going.',
        readingTimeMinutes: 1,
        sources: []
      },
      {
        id: 'story-2',
        title: 'Second',
        category: 'resilience',
        story: 'Story two.',
        takeaway: null,
        readingTimeMinutes: 1,
        sources: []
      },
      {
        id: 'story-3',
        title: 'Third',
        category: 'resilience',
        story: 'Story three.',
        takeaway: 'Try again.',
        readingTimeMinutes: 1,
        sources: []
      }
    ]);

    const selected = [await first];
    selected.push(await service.next(), await service.next());

    expect(new Set(selected.map(story => story?.id)).size).toBe(3);
    http.expectNone('/assets/data/motivational-stories.json');
  });
});
