import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface MotivationalQuote {
  id: string;
  text: string;
  category: string;
}

@Injectable({ providedIn: 'root' })
export class MotivationalQuoteService {
  private readonly http = inject(HttpClient);
  private quotesPromise?: Promise<MotivationalQuote[]>;
  private bag: number[] = [];
  private position = 0;
  private lastIndex = -1;

  async next(): Promise<MotivationalQuote | null> {
    const quotes = await this.loadQuotes();
    if (quotes.length === 0) return null;

    if (this.position >= this.bag.length) {
      this.refill(quotes.length);
    }

    const index = this.bag[this.position++];
    this.lastIndex = index;
    return quotes[index];
  }

  private loadQuotes(): Promise<MotivationalQuote[]> {
    this.quotesPromise ??= firstValueFrom(
      this.http.get<unknown>('/assets/data/motivational-quotes.json')
    )
      .then(payload => this.validateQuotes(payload))
      .catch(error => {
        this.quotesPromise = undefined;
        throw error;
      });

    return this.quotesPromise;
  }

  private validateQuotes(payload: unknown): MotivationalQuote[] {
    if (
      !Array.isArray(payload) ||
      !payload.every(
        (quote): quote is MotivationalQuote =>
          typeof quote === 'object' &&
          quote !== null &&
          'id' in quote &&
          typeof quote.id === 'string' &&
          'text' in quote &&
          typeof quote.text === 'string' &&
          quote.text.trim().length > 0 &&
          'category' in quote &&
          typeof quote.category === 'string'
      )
    ) {
      throw new Error('The motivational quotes file has an invalid format.');
    }

    return payload;
  }

  private refill(quoteCount: number): void {
    this.bag = Array.from({ length: quoteCount }, (_, index) => index);

    for (let index = this.bag.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [this.bag[index], this.bag[swapIndex]] = [
        this.bag[swapIndex],
        this.bag[index]
      ];
    }

    if (
      quoteCount > 1 &&
      this.lastIndex !== -1 &&
      this.bag[0] === this.lastIndex
    ) {
      const swapIndex =
        1 + Math.floor(Math.random() * (quoteCount - 1));
      [this.bag[0], this.bag[swapIndex]] = [
        this.bag[swapIndex],
        this.bag[0]
      ];
    }

    this.position = 0;
  }
}
