import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface MotivationalStory {
  id: string;
  title: string;
  category: string;
  story: string;
  takeaway: string;
  readingTimeMinutes: number;
  sources: Array<{
    label: string;
    url: string;
  }>;
}

@Injectable({ providedIn: 'root' })
export class MotivationalStoryService {
  private readonly http = inject(HttpClient);
  private storiesPromise?: Promise<MotivationalStory[]>;
  private bag: number[] = [];
  private position = 0;
  private lastIndex = -1;

  async next(): Promise<MotivationalStory | null> {
    const stories = await this.loadStories();
    if (stories.length === 0) return null;

    if (this.position >= this.bag.length) {
      this.refill(stories.length);
    }

    const index = this.bag[this.position++];
    this.lastIndex = index;
    return stories[index];
  }

  private loadStories(): Promise<MotivationalStory[]> {
    this.storiesPromise ??= firstValueFrom(
      this.http.get<unknown>('/assets/data/motivational-stories.json')
    )
      .then(payload => this.validateStories(payload))
      .catch(error => {
        this.storiesPromise = undefined;
        throw error;
      });

    return this.storiesPromise;
  }

  private validateStories(payload: unknown): MotivationalStory[] {
    if (
      !Array.isArray(payload) ||
      !payload.every(
        (story): story is MotivationalStory =>
          typeof story === 'object' &&
          story !== null &&
          'id' in story &&
          typeof story.id === 'string' &&
          'title' in story &&
          typeof story.title === 'string' &&
          'category' in story &&
          typeof story.category === 'string' &&
          'story' in story &&
          typeof story.story === 'string' &&
          story.story.trim().length > 0 &&
          'takeaway' in story &&
          typeof story.takeaway === 'string' &&
          story.takeaway.trim().length > 0 &&
          'readingTimeMinutes' in story &&
          typeof story.readingTimeMinutes === 'number' &&
          'sources' in story &&
          Array.isArray(story.sources) &&
          story.sources.every(
            (source: unknown) =>
              typeof source === 'object' &&
              source !== null &&
              'label' in source &&
              typeof source.label === 'string' &&
              'url' in source &&
              typeof source.url === 'string'
          )
      )
    ) {
      throw new Error('The motivational stories file has an invalid format.');
    }

    return payload;
  }

  private refill(storyCount: number): void {
    this.bag = Array.from({ length: storyCount }, (_, index) => index);

    for (let index = this.bag.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [this.bag[index], this.bag[swapIndex]] = [
        this.bag[swapIndex],
        this.bag[index]
      ];
    }

    if (
      storyCount > 1 &&
      this.lastIndex !== -1 &&
      this.bag[0] === this.lastIndex
    ) {
      const swapIndex =
        1 + Math.floor(Math.random() * (storyCount - 1));
      [this.bag[0], this.bag[swapIndex]] = [
        this.bag[swapIndex],
        this.bag[0]
      ];
    }

    this.position = 0;
  }
}
