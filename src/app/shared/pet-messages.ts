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