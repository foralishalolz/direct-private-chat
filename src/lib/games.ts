import type { GameKind } from "@/types/chat";

export interface GameDefinition {
  kind: GameKind;
  title: string;
  tagline: string;
  emoji: string;
  tint: string;
  players: string;
}

export const GAME_CATALOG: GameDefinition[] = [
  {
    kind: "would_you_rather",
    title: "Would You Rather",
    tagline: "Pick a side, see if you match",
    emoji: "🤔",
    tint: "from-[#f472b6] to-[#a855f7]",
    players: "2 players",
  },
  {
    kind: "this_or_that",
    title: "This or That",
    tagline: "Fast, silly, surprisingly revealing",
    emoji: "⚡",
    tint: "from-[#60a5fa] to-[#a855f7]",
    players: "2 players",
  },
  {
    kind: "truth_or_dare",
    title: "Truth or Dare",
    tagline: "Soft-spice edition, take turns",
    emoji: "🙈",
    tint: "from-[#fb7185] to-[#f59e0b]",
    players: "2+ players",
  },
  {
    kind: "two_truths",
    title: "Two Truths & a Lie",
    tagline: "Guess the fib, then switch",
    emoji: "🕵️",
    tint: "from-[#34d399] to-[#0ea5e9]",
    players: "2+ players",
  },
  {
    kind: "tictactoe",
    title: "Tic-Tac-Toe",
    tagline: "First to three, real-time turns",
    emoji: "⭕",
    tint: "from-[#a3e635] to-[#22d3ee]",
    players: "2 players",
  },
  {
    kind: "connect4",
    title: "Connect 4",
    tagline: "Line up four hearts before they do",
    emoji: "🔴",
    tint: "from-[#f97316] to-[#ec4899]",
    players: "2 players",
  },
];

export const WOULD_YOU_RATHER: Array<[string, string]> = [
  ["Have a cozy night in forever", "Spontaneous adventures forever"],
  ["Only communicate in voice notes", "Only communicate in memes"],
  ["Breakfast for dinner every day", "Dessert before every meal"],
  ["Live by the ocean", "Live in the mountains"],
  ["Never argue again", "Always argue but always make up"],
  ["Know every thought of mine", "Never say a word out loud"],
  ["A tiny apartment in the city", "A cottage in the woods"],
  ["Only slow dances", "Only spontaneous karaoke"],
  ["Re-read the same book forever", "Rewatch the same show forever"],
  ["Sunrise dates", "Midnight drives"],
  ["Be the big spoon forever", "Be the little spoon forever"],
  ["Endless hugs", "Endless forehead kisses"],
];

export const THIS_OR_THAT: Array<[string, string]> = [
  ["Coffee", "Chai"],
  ["Texts", "Calls"],
  ["Beach", "Forest"],
  ["Dogs", "Cats"],
  ["Sweet", "Spicy"],
  ["Movie night", "Game night"],
  ["Early bird", "Night owl"],
  ["Books", "Podcasts"],
  ["Plan everything", "Go with it"],
  ["Handwritten", "Voice note"],
  ["Rain", "Snow"],
  ["Big group", "Just us two"],
];

export const TRUTHS = [
  "What's the first thing you noticed about me?",
  "What's a small thing I do that you secretly love?",
  "What's something you've never told anyone?",
  "When did you know you liked me?",
  "What song makes you think of us?",
  "What's your favourite memory of us so far?",
  "What's one thing you want to do with me before the year ends?",
  "What's something you're scared to say out loud?",
  "What do you think about before you fall asleep?",
  "What's the silliest thing you've googled about me?",
];

export const DARES = [
  "Send a photo of the view right now.",
  "Voice note: sing four lines of our song.",
  "Text me a compliment in a language you don't speak.",
  "Send your most-used emoji five times in a row.",
  "Describe me in exactly three words, no more.",
  "Do ten seconds of your best dance and record it.",
  "Send a selfie with zero prep, right now.",
  "Tell me your worst joke in a voice note.",
  "Send the last photo in your camera roll.",
  "Type out your feelings about me without backspacing.",
];

export const CONNECT4_ROWS = 6;
export const CONNECT4_COLS = 7;

export type Connect4Board = (0 | 1 | 2)[][];

export function emptyConnect4Board(): Connect4Board {
  return Array.from({ length: CONNECT4_ROWS }, () =>
    Array.from({ length: CONNECT4_COLS }, () => 0 as const),
  );
}

export function dropDisc(
  board: Connect4Board,
  column: number,
  player: 1 | 2,
): { board: Connect4Board; row: number } | null {
  if (column < 0 || column >= CONNECT4_COLS) return null;
  const next = board.map((row) => [...row]) as Connect4Board;

  for (let row = CONNECT4_ROWS - 1; row >= 0; row -= 1) {
    if (next[row][column] === 0) {
      next[row][column] = player;
      return { board: next, row };
    }
  }
  return null;
}

export function connect4Winner(board: Connect4Board): 1 | 2 | null {
  const at = (row: number, col: number) =>
    row >= 0 && row < CONNECT4_ROWS && col >= 0 && col < CONNECT4_COLS
      ? board[row][col]
      : 0;

  const directions: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (let row = 0; row < CONNECT4_ROWS; row += 1) {
    for (let col = 0; col < CONNECT4_COLS; col += 1) {
      const player = board[row][col];
      if (!player) continue;

      for (const [dr, dc] of directions) {
        let count = 1;
        for (let step = 1; step < 4; step += 1) {
          if (at(row + dr * step, col + dc * step) === player) count += 1;
          else break;
        }
        if (count === 4) return player;
      }
    }
  }
  return null;
}

export type TicTacToeBoard = ("" | "X" | "O")[];

export function emptyTicTacToe(): TicTacToeBoard {
  return Array.from({ length: 9 }, () => "" as const);
}

const TTT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function ticTacToeWinner(board: TicTacToeBoard): {
  winner: "X" | "O" | null;
  line: number[] | null;
} {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a] as "X" | "O", line };
    }
  }
  return { winner: null, line: null };
}
