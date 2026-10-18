import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MotivationalQuoteService } from './motivational-quote.service';

describe('MotivationalQuoteService', () => {
  let service: MotivationalQuoteService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MotivationalQuoteService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(MotivationalQuoteService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the library lazily and selects every quote before repeating', async () => {
    const first = service.next();
    const request = http.expectOne('/assets/data/motivational-quotes.json');
    request.flush([
      { id: 'quote-1', text: 'One', category: 'focus' },
      { id: 'quote-2', text: 'Two', category: 'focus' },
      { id: 'quote-3', text: 'Three', category: 'focus' }
    ]);

    const selected = [await first];
    selected.push(await service.next(), await service.next());
    const ids = selected.map(quote => quote?.id);

    expect(new Set(ids).size).toBe(3);
    expect(http.match('/assets/data/motivational-quotes.json')).toHaveLength(0);
  });

  it('does not repeat the previous quote at a shuffle-bag boundary', async () => {
    const first = service.next();
    http.expectOne('/assets/data/motivational-quotes.json').flush([
      { id: 'quote-1', text: 'One', category: 'focus' },
      { id: 'quote-2', text: 'Two', category: 'focus' }
    ]);

    const previous = (await first)?.id;
    await service.next();
    const nextCycleQuote = await service.next();

    expect(nextCycleQuote?.id).not.toBe(previous);
    http.expectNone('/assets/data/motivational-quotes.json');
  });
});
