export const PET_GREETING_MESSAGES: string[] = [
  'Hi! 👋',
  'Hey there!',
  'Good to see you!',
  'Hello! 🐾',
  'I missed you!',
  'Ready for the day?',
  'What are we working on?',
  'Hey human!'
];


export const PET_HAPPY_MESSAGES: string[] = [
  'Hehe! 😄',
  'That tickles!',
  'You clicked me! 🐾',
  'Yay!',
  'Again! Again!',
  'I like that!',
  'Pet me more!',
  'That was fun!',
  'I am happy! ❤️',
  'Boop!'
];


export const PET_TASK_COMPLETE_MESSAGES: string[] = [
  '🎉 Nice work!',
  'One down!',
  "You're on fire!",
  'Task crushed! 💪'
];


export const PET_TIMER_COMPLETE_MESSAGES: string[] = [
  '⏰ Focus session complete!',
  'Great focus! Take a breather.',
  "Time's up! Nicely done.",
  'You made it to the finish line!',
  'That was a brilliant stretch of focus.',
  'Your future self says thank you.',
  'Deep work complete. Tiny victory dance?',
  'The timer bows to your concentration.',
  'Excellent focus. Go enjoy a proper break.'
];


export const PET_REMINDER_MESSAGES_PREFIX = "Don't forget: ";


export const PET_SLEEPING_MESSAGES: string[] = [
  'Zzz... Milly is getting sleepy.',
  'Zzz... Time for a quiet little pause.',
  'Milly is feeling sleepy. See you soon.',
  'Sleepy mode: on.'
];


export function randomMessage(
  messages: string[]
): string {

  if (messages.length === 0) {
    return '';
  }

  const index =
    Math.floor(
      Math.random() * messages.length
    );

  return messages[index];
}