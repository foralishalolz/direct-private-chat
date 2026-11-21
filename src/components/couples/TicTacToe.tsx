"use client";

import { RotateCcw, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { CoupleMember, Game } from "@/types/chat";

export type CoupleMemberWithProfile = CoupleMember & { username?: string };

type Mark = "x" | "o";

const EMPTY_BOARD: (Mark | null)[] = [null, null, null, null, null, null, null, null, null];

const LINES: [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function winner(board: (Mark | null)[]): Mark | null {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

interface GameBoardProps {
  coupleId: string;
  coupleMembers: CoupleMemberWithProfile[];
  currentUserId: string;
  currentUserMark: Mark;
}

/** Multiplayer tic-tac-toe — the two players are the two members of a couple. */
export function TicTacToe({ coupleId, coupleMembers, currentUserId, currentUserMark }: GameBoardProps) {
  const client = supabase;
  const [games, setGames] = useState<Game[]>([]);
  const [activeGame, setActiveGame] = useState<Game | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Stable per-couple assignment: the member whose couple_members row was
  // created first plays "x". The current user's mark comes from the caller.
  const sortedMembers = useMemo(
    () => [...coupleMembers].sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime()),
    [coupleMembers],
  );
  const partner = coupleMembers.find((m) => m.user_id !== currentUserId);

  const load = useCallback(async () => {
    if (!client) return;
    const { data } = await client
      .from("games")
      .select("id, couple_id, kind, board, current_turn, status, winner_user_id, created_by, created_at, updated_at")
      .eq("couple_id", coupleId)
      .eq("kind", "tictactoe")
      .order("updated_at", { ascending: false })
      .limit(10);

    const rows = (data ?? []) as Game[];
    setGames(rows);

    const playing = rows.find((g) => g.status === "playing");
    setActiveGame(playing ?? rows[0] ?? null);
  }, [client, coupleId]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!client) return;
      const { data } = await client
        .from("games")
        .select("id, couple_id, kind, board, current_turn, status, winner_user_id, created_by, created_at, updated_at")
        .eq("couple_id", coupleId)
        .eq("kind", "tictactoe")
        .order("updated_at", { ascending: false })
        .limit(10);

      if (!active) return;

      const rows = (data ?? []) as Game[];
      setGames(rows);
      const playing = rows.find((g) => g.status === "playing");
      setActiveGame(playing ?? rows[0] ?? null);
    })();

    return () => {
      active = false;
    };
  }, [client, coupleId]);

  useEffect(() => {
    if (!client) return;

    const channel = client
      .channel(`couple-games-${coupleId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "games",
          filter: `couple_id=eq.${coupleId}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [client, coupleId, load]);

  async function createGame() {
    if (!client) return;
    const { data, error } = await client
      .from("games")
      .insert({
        couple_id: coupleId,
        kind: "tictactoe",
        board: EMPTY_BOARD,
        current_turn: "x",
        status: "playing",
        created_by: currentUserId,
      })
      .select("id, couple_id, kind, board, current_turn, status, winner_user_id, created_by, created_at, updated_at")
      .single();

    if (error || !data) return;

    setActiveGame(data as Game);
    setGames((current) => [data as Game, ...current.filter((g) => g.id !== (data as Game).id)]);
  }

  async function handleCell(index: number) {
    if (!client || !activeGame || isSaving) return;
    if (activeGame.status !== "playing") return;
    if (activeGame.current_turn !== currentUserMark) return;

    const nextBoard = [...activeGame.board] as (Mark | null)[];
    if (nextBoard[index]) return;

    nextBoard[index] = currentUserMark;

    const foundWinner = winner(nextBoard);
    const draw = !foundWinner && nextBoard.every((cell) => cell !== null);

    // Resolve the winner deterministically: "x" is the first member, "o" the second.
    const resolvedWinnerId = foundWinner
      ? foundWinner === "x"
        ? sortedMembers[0]?.user_id ?? null
        : sortedMembers[1]?.user_id ?? null
      : null;

    setIsSaving(true);

    const nextGame: Partial<Game> = {
      board: nextBoard,
      status: foundWinner ? "won" : draw ? "draw" : "playing",
      winner_user_id: resolvedWinnerId,
      current_turn: foundWinner || draw ? activeGame.current_turn : currentUserMark === "x" ? "o" : "x",
      updated_at: new Date().toISOString(),
    };

    const previousGame = activeGame;
    setActiveGame({ ...previousGame, ...nextGame } as Game);

    const { error } = await client.from("games").update(nextGame).eq("id", previousGame.id);

    setIsSaving(false);

    if (error) {
      setActiveGame(previousGame); // revert on failure
      return;
    }

    setGames((current) =>
      current.map((g) => (g.id === previousGame.id ? ({ ...previousGame, ...nextGame } as Game) : g)),
    );
  }

  async function rematch() {
    if (!client || !activeGame) return;
    const next = {
      board: EMPTY_BOARD as (Mark | null)[],
      current_turn: activeGame.current_turn === "x" ? "o" : "x",
      status: "playing",
      winner_user_id: null,
      updated_at: new Date().toISOString(),
    } as Partial<Game>;

    const previousGame = activeGame;
    setActiveGame({ ...previousGame, ...next } as Game);
    await client.from("games").update(next).eq("id", previousGame.id);
    setGames((current) => current.map((g) => (g.id === previousGame.id ? ({ ...previousGame, ...next } as Game) : g)));
  }

  const myWins = games.filter((g) => g.status === "won" && g.winner_user_id === currentUserId).length;
  const theirWins = games.filter(
    (g) => g.status === "won" && Boolean(g.winner_user_id) && g.winner_user_id !== currentUserId,
  ).length;

  const partnerName = partner?.username ?? "partner";
  const myMarkLabel = currentUserMark === "x" ? "✕" : "○";

  const boardLabel =
    !activeGame
      ? ""
      : activeGame.status === "won"
        ? activeGame.winner_user_id === currentUserId
          ? "You win! 🎉"
          : `${partnerName} wins!`
        : activeGame.status === "draw"
          ? "It's a draw!"
          : activeGame.current_turn === currentUserMark
            ? `Your turn — you are ${myMarkLabel}`
            : `${partnerName}'s turn — you are ${myMarkLabel}`;

  const status =
    !activeGame ? "idle" : activeGame.status !== "playing" ? "over" : activeGame.current_turn === currentUserMark ? "my-turn" : "their-turn";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Best of 10 recent rounds
          </p>
          <p className="text-[15px] font-semibold text-[var(--text)]">
            You {myWins} · {partnerName} {theirWins}
          </p>
        </div>
        {activeGame && (
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
              status === "my-turn"
                ? "bg-[var(--grad-soft)] text-[var(--text)]"
                : "bg-[var(--panel-2)] text-[var(--text-muted)]"
            }`}
          >
            {boardLabel}
          </span>
        )}
      </div>

      {!activeGame ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center">
          <Trophy aria-hidden="true" className="size-8 text-[var(--accent-text)]" strokeWidth={1.6} />
          <p className="max-w-[32ch] text-[13px] text-[var(--text-muted)]">
            A quick game for couples — take turns and see who wins.
          </p>
          <button
            type="button"
            onClick={() => void createGame()}
            className="btn-accent inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
          >
            Start tic-tac-toe
          </button>
        </div>
      ) : (
        <>
          <div className="mx-auto grid max-w-[280px] grid-cols-3 gap-2.5">
            {activeGame.board.map((cell, index) => (
              <button
                key={index}
                type="button"
                disabled={
                  isSaving ||
                  activeGame.status !== "playing" ||
                  activeGame.current_turn !== currentUserMark ||
                  Boolean(cell)
                }
                onClick={() => void handleCell(index)}
                aria-label={`Cell ${index + 1}`}
                className={`aspect-square rounded-2xl border text-2xl font-bold transition active:scale-95 ${
                  cell
                    ? cell === currentUserMark
                      ? "border-[var(--border-strong)] bg-[var(--grad-soft)] text-[var(--text)]"
                      : "border-[var(--border)] bg-[var(--panel)] text-[var(--text-muted)]"
                    : "border-[var(--border-strong)] bg-[var(--panel-2)] text-transparent hover:border-[var(--accent-text)] hover:text-[var(--text-faint)] disabled:hover:border-[var(--border-strong)] disabled:hover:text-transparent"
                }`}
              >
                {cell === "x" ? "✕" : cell === "o" ? "○" : ""}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2">
            {activeGame.status !== "playing" && (
              <button
                type="button"
                onClick={() => void rematch()}
                className="btn-accent inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
              >
                <RotateCcw aria-hidden="true" className="size-4" strokeWidth={2} />
                Rematch
              </button>
            )}
          </div>

          {activeGame.status === "playing" && activeGame.current_turn !== currentUserMark && (
            <p className="text-center text-[12px] text-[var(--text-faint)]">Waiting for {partnerName}…</p>
          )}
        </>
      )}
    </div>
  );
}
