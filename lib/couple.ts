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
  { id: "missing", glyph: "🥺", label: "Missing you", line: "🥺 Missing you so much it is silly" },
  { id: "sad", glyph: "😢", label: "Sad", line: "😢 A bit sad today. Can I have a hug?" },
  { id: "crying", glyph: "😭", label: "Crying", line: "😭 I need you. Call me when you can?" },
  { id: "lonely", glyph: "🌧️", label: "Lonely", line: "🌧️ Feeling lonely. Say something sweet?" },
  { id: "anxious", glyph: "🫨", label: "Anxious", line: "🫨 My head is loud today. Stay with me a minute?" },
  { id: "tired", glyph: "😴", label: "Exhausted", line: "😴 Wiped out. Tell me it will be okay?" },
  { id: "happy", glyph: "😊", label: "Happy", line: "😊 Just happy you exist" },
  { id: "giggly", glyph: "🤭", label: "Giggly", line: "🤭 Thinking about you and grinning at my phone" },
  { id: "proud", glyph: "🫶", label: "Proud of you", line: "🫶 So proud of you, always" },
  { id: "angry", glyph: "😤", label: "Annoyed", line: "😤 Annoyed at everything except you" },
  { id: "sleepy", glyph: "🌙", label: "Sleepy", line: "🌙 Sleepy. Wish you were the pillow" },
  { id: "sick", glyph: "🤒", label: "Unwell", line: "🤒 Not feeling great. Baby me a little?" },
];

/** Comfort replies that answer a sad message. */
export const COMFORTS: { id: string; glyph: string; label: string; line: string }[] = [
  { id: "here", glyph: "🫂", label: "I'm here", line: "🫂 I am right here. Breathe with me." },
  { id: "hug", glyph: "🧸", label: "Hug", line: "🧸 Sending the biggest, warmest hug" },
  { id: "stay", glyph: "🤍", label: "Not leaving", line: "🤍 Not going anywhere. Take your time." },
  { id: "talk", glyph: "☎️", label: "Let's talk", line: "☎️ Want to talk? I will listen, no advice unless you ask." },
  { id: "cry", glyph: "😢", label: "Cry it out", line: "😢 It is okay to cry. I have got you." },
  { id: "proud", glyph: "🌷", label: "You're doing ok", line: "🌷 You are doing better than you think." },
  { id: "water", glyph: "💧", label: "Drink water", line: "💧 Water, then rest. Orders from me." },
  { id: "sleep", glyph: "🌙", label: "Rest", line: "🌙 Sleep. I will be here in the morning." },
  { id: "kissforehead", glyph: "😚", label: "Forehead kiss", line: "😚 A kiss on your forehead" },
  { id: "hold", glyph: "🫱", label: "Hold my hand", line: "🫱 Holding your hand, not letting go" },
];

/** Digital kisses with a little personality. */
export const KISSES: { id: string; glyph: string; label: string; line: string }[] = [
  { id: "quick", glyph: "😘", label: "Quick kiss", line: "😘 A quick kiss on the way past" },
  { id: "forehead", glyph: "😚", label: "Forehead", line: "😚 A soft kiss on your forehead" },
  { id: "neck", glyph: "🫦", label: "Neck", line: "🫦 A slow kiss on your neck" },
  { id: "hand", glyph: "🤍", label: "Hand", line: "🤍 A kiss on your knuckles" },
  { id: "deep", glyph: "💋", label: "Deep", line: "💋 A kiss that lasts a little too long" },
  { id: "goodmorning", glyph: "☀️", label: "Good morning", line: "☀️ Good morning kiss, still sleep warm" },
  { id: "goodnight", glyph: "🌙", label: "Goodnight", line: "🌙 Goodnight kiss, lights off" },
  { id: "surprise", glyph: "💞", label: "Surprise", line: "💞 Out of nowhere, because I wanted to" },
  { id: "rain", glyph: "🌧️", label: "Rain kiss", line: "🌧️ Kissing you in the rain, hair ruined" },
  { id: "door", glyph: "🚪", label: "At the door", line: "🚪 The kiss at the door before I go" },
  { id: "makeup", glyph: "🌷", label: "Make-up", line: "🌷 The after-argument kiss. I am sorry." },
  { id: "laugh", glyph: "🤭", label: "Mid-laugh", line: "🤭 A kiss in the middle of laughing" },
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
