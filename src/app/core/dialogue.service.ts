import { Injectable } from '@angular/core';
import {
  PET_GREETING_MESSAGES,
  PET_HAPPY_MESSAGES,
  PET_IDLE_MESSAGES,
  PET_TASK_COMPLETE_MESSAGES,
  PET_TIMER_COMPLETE_MESSAGES,
  randomMessage
} from '../shared/pet-messages';

export type DialogueContext =
  | 'greeting'
  | 'click'
  | 'taskCompleted'
  | 'timerCompleted'
  | 'reminderDue'
  | 'idle'
  | 'sleeping'
  | 'lateNight';

const CONTEXT_MESSAGES: Record<DialogueContext, string[]> = {
  greeting: PET_GREETING_MESSAGES,
  click: PET_HAPPY_MESSAGES,
  taskCompleted: PET_TASK_COMPLETE_MESSAGES,
  timerCompleted: PET_TIMER_COMPLETE_MESSAGES,
  reminderDue: ['🔔 Don\'t forget...'],
  idle: PET_IDLE_MESSAGES,
  sleeping: ['💤 Zzz...', 'Getting sleepy...', 'Maybe take a break too?'],
  lateNight: ["It's getting late... 🌙", 'Still up? Take care of yourself.']
};

@Injectable({ providedIn: 'root' })
export class DialogueService {
  getMessage(context: DialogueContext): string {
    return randomMessage(CONTEXT_MESSAGES[context] ?? PET_IDLE_MESSAGES);
  }
}