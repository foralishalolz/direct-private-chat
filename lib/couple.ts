/**
 * Words for the soft, sad, silly and spicy parts of a couple's day.
 *
 * Rules for this file: everything is written for two consenting adults who
 * already talk like this; nothing is graphic, and every prompt is a question or
 * an invitation the other person can decline. Nothing here is sent anywhere on
 * its own — the person has to tap.
 */

export type Mood = { id: string; glyph: string; label: string; line: string };

/** Quick "how I feel right now" notes that land as a message. */
export const FEELINGS: Mood[] = [
  { id: "missing", glyph: "🥺", label: "Missing you", line: "🥺 I miss you" },
  { id: "sad", glyph: "😢", label: "Sad", line: "😢 Feeling sad. Can I have a hug?" },
  { id: "crying", glyph: "😭", label: "Crying", line: "😭 I’m crying. Can you call me?" },
  { id: "lonely", glyph: "🌧️", label: "Lonely", line: "🌧️ Feeling lonely. Are you around?" },
  { id: "anxious", glyph: "🫨", label: "Anxious", line: "🫨 Feeling anxious. Can you stay with me?" },
  { id: "tired", glyph: "😴", label: "Exhausted", line: "😴 I’m exhausted today" },
  { id: "happy", glyph: "😊", label: "Happy", line: "😊 You make me happy" },
  { id: "giggly", glyph: "🤭", label: "Giggly", line: "🤭 You’re making me smile" },
  { id: "proud", glyph: "🫶", label: "Proud of you", line: "🫶 I’m proud of you" },
  { id: "angry", glyph: "😤", label: "Annoyed", line: "😤 Having a rough day" },
  { id: "sleepy", glyph: "🌙", label: "Sleepy", line: "🌙 Wish you were here with me" },
  { id: "sick", glyph: "🤒", label: "Unwell", line: "🤒 I’m not feeling well" },
];

/** Comfort replies that answer a sad message. */
export const COMFORTS: { id: string; glyph: string; label: string; line: string }[] = [
  { id: "here", glyph: "🫂", label: "I'm here", line: "🫂 I’m here for you" },
  { id: "hug", glyph: "🧸", label: "Hug", line: "🧸 Sending you a big hug" },
  { id: "stay", glyph: "🤍", label: "Not leaving", line: "🤍 Take your time, I’m here" },
  { id: "talk", glyph: "☎️", label: "Let's talk", line: "☎️ Want to talk? I’m listening" },
  { id: "cry", glyph: "😢", label: "Cry it out", line: "😢 It’s okay to cry. I’ve got you" },
  { id: "proud", glyph: "🌷", label: "You're doing ok", line: "🌷 I’m proud of you" },
  { id: "water", glyph: "💧", label: "Drink water", line: "💧 Please get some water and rest" },
  { id: "sleep", glyph: "🌙", label: "Rest", line: "🌙 Get some rest. I’m here" },
  { id: "kissforehead", glyph: "😚", label: "Forehead kiss", line: "😚 Forehead kiss for you" },
  { id: "hold", glyph: "🫱", label: "Hold my hand", line: "🫱 Holding your hand" },
];

/** Digital kisses with a little personality. */
export const KISSES: { id: string; glyph: string; label: string; line: string }[] = [
  { id: "quick", glyph: "😘", label: "Quick kiss", line: "😘 A kiss for you" },
  { id: "forehead", glyph: "😚", label: "Forehead", line: "😚 Kiss on your forehead" },
  { id: "neck", glyph: "🫦", label: "Neck", line: "🫦 A kiss on your neck" },
  { id: "hand", glyph: "🤍", label: "Hand", line: "🤍 A kiss on your hand" },
  { id: "deep", glyph: "💋", label: "Deep", line: "💋 I want to kiss you" },
  { id: "goodmorning", glyph: "☀️", label: "Good morning", line: "☀️ Good morning kiss" },
  { id: "goodnight", glyph: "🌙", label: "Goodnight", line: "🌙 Goodnight kiss" },
  { id: "surprise", glyph: "💞", label: "Surprise", line: "💞 Surprise kiss" },
  { id: "rain", glyph: "🌧️", label: "Rain kiss", line: "🌧️ Let’s kiss in the rain" },
  { id: "door", glyph: "🚪", label: "At the door", line: "🚪 One more kiss before you go" },
  { id: "makeup", glyph: "🌷", label: "Make-up", line: "🌷 I’m sorry. Can I kiss you?" },
  { id: "laugh", glyph: "🤭", label: "Mid-laugh", line: "🤭 Kissing you mid-laugh" },
];

/** Too much love, too little time: romantic dares, all soft, all declinable. */
export const DARES: { id: string; text: string }[] = [
  { id: "d1", text: "Send the next photo you take of something that reminded you of me." },
  { id: "d2", text: "Type the first thing you thought about me today. No deleting." },
  { id: "d3", text: "Send a voice note saying my name the way you say it best." },
  { id: "d4", text: "Tell me one thing you want to do to me when we are alone next." },
  { id: "d5", text: "Compliment me in exactly five words." },
  { id: "d6", text: "Describe what you would wear to a night out with me." },
  { id: "d7", text: "Send the song that feels like us right now." },
  { id: "d8", text: "Pick a kiss from the kiss drawer and send it with a reason." },
  { id: "d9", text: "Tell me a secret you have never typed out loud." },
  { id: "d10", text: "Write two lines of a story where we meet tonight." },
  { id: "d11", text: "Say the most romantic thing you can in one breath." },
  { id: "d12", text: "Tell me where on your body you want my hand right now." },
  { id: "d13", text: "Describe our next date in three sentences. Be specific." },
  { id: "d14", text: "Send me the last thing you saved because it reminded you of me." },
  { id: "d15", text: "Confess something small you have been too shy to say." },
];

/** Conversation starters for quiet nights. */
export const QUESTIONS: string[] = [
  "What is the first thing you noticed about me?",
  "Which version of me do you like best — sleepy, excited, or annoyed?",
  "What is a smell that is only ours?",
  "When did you last want to kiss me and not say it?",
  "What is the smallest thing I do that you would miss?",
  "What do you want our kitchen to smell like?",
  "What is a fear you want me to hold with you?",
  "Which of our photos would you frame?",
  "What is something you want to be told more often?",
  "What would you do with a free evening and me?",
  "What is the best compliment I have ever given you?",
  "Where would you take me if money did not exist?",
  "What is one habit of mine you find cute?",
  "What do you want to be doing in five years with me?",
  "What is the last thing that made you cry happy tears?",
  "What part of my voice do you hear when I am not talking?",
  "What is a tiny promise we could keep this week?",
  "What song would play if we had a film about us?",
  "What do you wish I asked you more often?",
  "When did you know I was your safe place?",
  "What is your favourite way I say your name?",
  "What small thing can I do tomorrow to make your day?",
  "What do you daydream about when I am quiet?",
  "If you could keep one of our days forever, which one?",
  "What is something we never do that you want to try?",
  "What do you think I need right now?",
  "What is the most romantic sentence you could say tonight?",
  "What would you whisper if everyone else was asleep?",
  "What do you want more of from me?",
  "What should we forgive each other for this week?",
];

/** Would-you-rather pairs, cosy to flirty. */
export const RATHERS: [string, string][] = [
  ["Breakfast in bed", "Midnight snacks together"],
  ["A slow dance in the kitchen", "A film under one blanket"],
  ["A rainy day inside", "A sunny day doing nothing"],
  ["Long hug at the door", "Texting all day from another room"],
  ["A surprise gift", "A handwritten letter"],
  ["Stay up talking till 3am", "Wake up early for a sunrise"],
  ["One perfect date", "A hundred ordinary evenings"],
  ["Kiss me awake", "Kiss me goodnight"],
  ["A playlist made for me", "A voice note every morning"],
  ["Hold my hand in public", "Kiss me when nobody is watching"],
  ["A weekend away", "A month of small dates"],
  ["Say it out loud", "Write it down"],
  ["A bath together", "A shower with cold water because we used all the hot"],
  ["My hoodie", "My perfume on your pillow"],
  ["Dance badly with me", "Sing badly to me"],
  ["A slow kiss", "A long hug"],
  ["Cooking together badly", "Ordering in perfectly"],
  ["A photo of us", "A minute of us in a voice note"],
  ["Little texts all day", "One long call at night"],
  ["Be big spoon", "Be little spoon"],
];


/** Flirty prompts for consenting adults. Skip anything that isn't your thing. */
export const SPICY_QUESTIONS: string[] = [
  "What kind of kiss do you want from me tonight?",
  "Where would you like me to kiss you?",
  "What do I do that gives you butterflies?",
  "What would you whisper to me right now?",
  "What should our next night together look like?",
  "What do you like hearing from me when we flirt?",
  "What outfit would you like to see me in?",
  "What makes you feel most wanted?",
  "What should we try on our next date, if we're both in the mood?",
  "What is your favourite way for me to tease you?",
  "What would you like me to do when we're alone?",
  "What kind of touch do you like most?",
];

/** Prompts for the sad days. Never a fix, just company. */
export const SOFT_QUESTIONS: string[] = [
  "What do you need from me right now: quiet, talking, or a distraction?",
  "What was the hardest five minutes of your day?",
  "What can I take off your plate this week?",
  "Do you want me to listen, or to help?",
  "Where does it hurt most right now — head, heart, or body?",
  "What made you feel a little lighter today, even for a second?",
  "What would make tonight easier?",
  "Do you want a hug in person or one by text right now?",
  "What should I say when you are like this?",
  "Has it been like this all day, or did something happen?",
];

export function randomOf<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** How far through the current deck a couple is, for the "don't repeat" logic. */
export function nextUnseen<T extends { id: string }>(list: T[], seen: Set<string>): T {
  const fresh = list.filter(item => !seen.has(item.id));
  return randomOf(fresh.length ? fresh : list);
}
