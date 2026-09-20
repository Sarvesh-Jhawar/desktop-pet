import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Pet } from './pet';

describe('Pet', () => {
  let component: Pet;
  let fixture: ComponentFixture<Pet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Pet],
    }).compileComponents();

    fixture = TestBed.createComponent(Pet);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
