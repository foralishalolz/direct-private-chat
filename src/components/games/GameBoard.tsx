"use client";

import {
  Check,
  Crown,
  Flag,
  Heart,
  LoaderCircle,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "@/hooks/useChatStore";
import {
  CONNECT4_COLS,
  CONNECT4_ROWS,
  DARES,
  THIS_OR_THAT,
  TRUTHS,
  WOULD_YOU_RATHER,
  connect4Winner,
  dropDisc,
  ticTacToeWinner,
  type Connect4Board,
  type TicTacToeBoard,
} from "@/lib/games";
import { playSparkle, playIncoming } from "@/lib/sound";
import { displayName, vibrate } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Misc";
import type { GameSession, Profile } from "@/types/chat";

interface GameBoardProps {
  session: GameSession;
  onEnd: () => void;
}

export function GameBoard({ session: initialSession, onEnd }: GameBoardProps) {
  const { user, profile, onlineUserIds } = useChatStore();
  const [session, setSession] = useState(initialSession);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [busy, setBusy] = useState(false);
  const lastStateRef = useRef(JSON.stringify(initialSession.state));

  const currentUserId = user?.id ?? "";
  const isMyTurn = !session.turn_user_id || session.turn_user_id === currentUserId;

  // Load participant profiles.
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, accent")
      .then(({ data }) => {
        if (!active || !data) return;
        setProfiles(
          Object.fromEntries(data.map((row) => [row.id as string, row as Profile])),
        );
      });
    return () => {
      active = false;
    };
  }, []);

  // Live state sync — the whole game is a single jsonb blob per row.
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel(`game-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_sessions",
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          const updated = payload.new as GameSession;
          const serialized = JSON.stringify(updated.state);
          if (serialized !== lastStateRef.current) {
            lastStateRef.current = serialized;
            if (updated.turn_user_id === currentUserId) {
              if (localStorage.getItem("bitchat-sounds") !== "off") playIncoming();
              vibrate(10);
            }
          }
          setSession(updated);
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [currentUserId, session.id]);

  const commit = useCallback(
    async (patch: Partial<Pick<GameSession, "state" | "turn_user_id" | "status">>) => {
      if (!supabase) return;
      setBusy(true);
      const nextState = patch.state ?? session.state;
      lastStateRef.current = JSON.stringify(nextState);
      setSession((current) => ({ ...current, ...patch }));

      await supabase.from("game_sessions").update(patch).eq("id", session.id);
      setBusy(false);
    },
    [session.id, session.state],
  );

  // ------------------------------------------------------------- tic tac toe
  const tttBoard = (session.state.board as TicTacToeBoard) ?? [];
  const tttMarks = (session.state.marks as Record<string, "X" | "O">) ?? {};
  const tttResult = ticTacToeWinner(tttBoard);
  const myMark = tttMarks[currentUserId] ?? null;

  async function playTtt(index: number) {
    if (!isMyTurn || busy || tttBoard[index] || tttResult.winner) return;

    const marks = { ...tttMarks };
    if (!marks[currentUserId]) {
      const taken = Object.values(marks);
      marks[currentUserId] = taken.includes("X") ? "O" : "X";
    }

    const board = [...tttBoard];
    board[index] = marks[currentUserId];

    const result = ticTacToeWinner(board);
    const filled = board.every((cell) => cell);

    await commit({
      state: { board, marks },
      turn_user_id: session.turn_user_id === currentUserId ? null : session.turn_user_id,
      status: result.winner || filled ? "finished" : "active",
    });

    if (result.winner) {
      if (localStorage.getItem("bitchat-sounds") !== "off") playSparkle();
    }
  }

  // --------------------------------------------------------------- connect 4
  const c4Board = (session.state.board as Connect4Board) ?? [];
  const c4Colors = (session.state.colors as Record<string, 1 | 2>) ?? {};
  const c4Winner = connect4Winner(c4Board);
  const myColor = c4Colors[currentUserId] ?? null;
  const c4Full = c4Board.every((row) => row.every((cell) => cell !== 0));

  async function playConnect4(column: number) {
    if (!isMyTurn || busy || c4Winner) return;

    const colors = { ...c4Colors };
    if (!colors[currentUserId]) {
      const taken = Object.values(colors);
      colors[currentUserId] = taken.includes(1) ? 2 : 1;
    }

    const dropped = dropDisc(c4Board, column, colors[currentUserId]);
    if (!dropped) return;

    const winner = connect4Winner(dropped.board);

    await commit({
      state: { board: dropped.board, colors },
      status: winner ? "finished" : "active",
    });

    if (winner && localStorage.getItem("bitchat-sounds") !== "off") playSparkle();
  }

  // ------------------------------------------------- would you rather / this
  const roundIndex = (session.state.round as number) ?? 0;
  const picks = (session.state.picks as Record<string, number>) ?? {};
  const isWyr = session.kind === "would_you_rather";
  const deck = isWyr ? WOULD_YOU_RATHER : THIS_OR_THAT;
  const pair = deck[roundIndex % deck.length];
  const myPick = picks[currentUserId];

  async function makePick(choice: 0 | 1) {
    if (busy || myPick !== undefined) return;

    const nextPicks = { ...picks, [currentUserId]: choice };
    const voters = Object.keys(nextPicks).length;
    const shouldAdvance = voters >= 2;

    await commit({
      state: {
        round: shouldAdvance ? roundIndex + 1 : roundIndex,
        picks: shouldAdvance ? {} : nextPicks,
      },
    });

    if (shouldAdvance && localStorage.getItem("bitchat-sounds") !== "off") {
      playSparkle();
    }
  }

  async function nextRound() {
    await commit({ state: { round: roundIndex + 1, picks: {} } });
  }

  // ------------------------------------------------------- truth or dare
  const todHistory =
    (session.state.history as Array<{ playerId: string; choice: string; text: string }>) ??
    [];
  const [pendingChoice, setPendingChoice] = useState<"truth" | "dare" | null>(null);
  const [todText, setTodText] = useState<string | null>(null);

  function drawTruthOrDare(choice: "truth" | "dare") {
    const pool = choice === "truth" ? TRUTHS : DARES;
    const text = pool[Math.floor(Math.random() * pool.length)];
    setPendingChoice(choice);
    setTodText(text);
  }

  async function lockInTruthOrDare() {
    if (!pendingChoice || !todText) return;
    const entry = { playerId: currentUserId, choice: pendingChoice, text: todText };
    await commit({
      state: { history: [...todHistory, entry].slice(-20) },
      turn_user_id: session.turn_user_id === currentUserId ? null : session.turn_user_id,
    });
    setPendingChoice(null);
    setTodText(null);
  }

  // ------------------------------------------------------- two truths
  const ttStatements = (session.state.statements as Record<string, string[]>) ?? {};
  const ttVotes = (session.state.votes as Record<string, number>) ?? {};
  const [stmtInputs, setStmtInputs] = useState(["", "", ""]);
  const [lieIndex, setLieIndex] = useState<number | null>(null);
  const myStatements = ttStatements[currentUserId];

  async function submitTruths() {
    if (stmtInputs.some((value) => !value.trim()) || lieIndex === null) return;
    await commit({
      state: {
        ...session.state,
        statements: { ...ttStatements, [currentUserId]: stmtInputs },
        votes: { ...ttVotes, [`${currentUserId}:lie`]: lieIndex },
      },
    });
  }

  async function voteFor(index: number) {
    const partnerId = Object.keys(ttStatements).find((id) => id !== currentUserId);
    if (!partnerId) return;
    await commit({
      state: { ...session.state, votes: { ...ttVotes, [currentUserId]: index } },
    });
  }

  const partnerId = useMemo(
    () => Object.keys(profiles).find((id) => id !== currentUserId) ?? null,
    [currentUserId, profiles],
  );
  const partner = partnerId ? profiles[partnerId] : null;
  const partnerOnline = partnerId ? onlineUserIds.has(partnerId) : false;

  return (
    <div className="space-y-4">
      {/* Scoreboard */}
      <div className="flex items-center justify-between rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex flex-1 items-center gap-2">
          <Avatar
            name={displayName(profile)}
            seed={currentUserId}
            src={profile?.avatar_url}
            accent={profile?.accent}
            size={34}
          />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold text-[var(--text)]">You</p>
            <p className="text-[10px] text-[var(--text-faint)]">
              {isMyTurn ? "your move" : "waiting"}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center px-2">
          <span className="text-[15px] font-extrabold tracking-tight accent-text">
            {session.status === "finished" ? "finished" : "vs"}
          </span>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 text-right">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold text-[var(--text)]">
              {displayName(partner)}
            </p>
            <p className="text-[10px] text-[var(--text-faint)]">
              {partnerOnline ? "online" : "away"}
            </p>
          </div>
          <Avatar
            name={displayName(partner)}
            seed={partnerId ?? "them"}
            src={partner?.avatar_url}
            accent={partner?.accent}
            size={34}
          />
        </div>
      </div>

      {/* Game body */}
      {(session.kind === "tictactoe" || session.kind === "connect4") && (
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3">
          {session.kind === "tictactoe" ? (
            <>
              <div className="mb-2 text-center text-[12px] font-semibold text-[var(--text-muted)]">
                {tttResult.winner
                  ? tttResult.winner === myMark
                    ? "You win! 🎉"
                    : "They win 💔"
                  : tttBoard.every((cell) => cell)
                    ? "Draw — rematch?"
                    : `You are ${myMark ?? "—"}${isMyTurn ? " · your turn" : " · their turn"}`}
              </div>
              <div className="mx-auto grid max-w-[280px] grid-cols-3 gap-1.5">
                {tttBoard.map((cell, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => void playTtt(index)}
                    disabled={Boolean(cell) || !isMyTurn || Boolean(tttResult.winner)}
                    className={`grid aspect-square place-items-center rounded-xl text-[26px] font-extrabold transition ${
                      cell === "X"
                        ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                        : cell === "O"
                          ? "bg-[var(--accent-2)]/20 text-[var(--accent-2)]"
                          : "bg-[var(--panel-2)] text-transparent hover:bg-[var(--panel-3)]"
                    }`}
                  >
                    {cell || "·"}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 text-center text-[12px] font-semibold text-[var(--text-muted)]">
                {c4Winner
                  ? c4Winner === myColor
                    ? "You connected four! 🎉"
                    : "They connected four 💔"
                  : c4Full
                    ? "Board full — draw"
                    : `You are ${myColor === 1 ? "red" : myColor === 2 ? "yellow" : "—"}${isMyTurn ? " · your turn" : ""}`}
              </div>
              <div className="mx-auto flex max-w-[320px] gap-1">
                {Array.from({ length: CONNECT4_COLS }, (_, column) => (
                  <button
                    key={column}
                    type="button"
                    onClick={() => void playConnect4(column)}
                    disabled={!isMyTurn || c4Board[0]?.[column] !== 0 || Boolean(c4Winner)}
                    aria-label={`Drop in column ${column + 1}`}
                    className="group flex flex-1 flex-col gap-1 rounded-lg p-0.5 disabled:opacity-70"
                  >
                    {Array.from({ length: CONNECT4_ROWS }, (_, row) => {
                      const cell = c4Board[row]?.[column] ?? 0;
                      return (
                        <span
                          key={row}
                          className={`aspect-square w-full rounded-full transition ${
                            cell === 1
                              ? "bg-[#fb7185]"
                              : cell === 2
                                ? "bg-[#fbbf24]"
                                : "bg-[var(--panel-3)] group-hover:bg-[var(--panel-3)]/80"
                          }`}
                        />
                      );
                    })}
                  </button>
                ))}
              </div>
            </>
          )}

          {(tttResult.winner || c4Winner) && (
            <Button
              className="mt-3"
              fullWidth
              size="sm"
              variant="secondary"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() =>
                void commit({
                  state:
                    session.kind === "tictactoe"
                      ? { board: Array(9).fill(""), marks: {} }
                      : { board: Array.from({ length: 6 }, () => Array(7).fill(0)), colors: {} },
                  status: "active",
                  turn_user_id: currentUserId,
                })
              }
            >
              Rematch
            </Button>
          )}
        </div>
      )}

      {(session.kind === "would_you_rather" || session.kind === "this_or_that") && (
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              Round {roundIndex + 1}
            </span>
            <button
              type="button"
              onClick={() => void nextRound()}
              className="text-[11.5px] font-bold text-[var(--accent)]"
            >
              Skip →
            </button>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {[0, 1].map((choiceIndex) => {
              const label = pair?.[choiceIndex] ?? "—";
              const selected = myPick === choiceIndex;
              const partnerPicked = Object.entries(picks).some(
                ([id, value]) => id !== currentUserId && value === choiceIndex,
              );

              return (
                <div key={choiceIndex} className="contents">
                  {choiceIndex === 1 && (
                    <span className="text-center text-[11px] font-bold text-[var(--text-faint)]">
                      or
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void makePick(choiceIndex as 0 | 1)}
                    disabled={myPick !== undefined || busy}
                    className={`press relative flex min-h-[104px] flex-col items-center justify-center rounded-2xl border p-3 text-center transition ${
                      selected
                        ? "border-[var(--accent)]/70 bg-[var(--accent)]/18"
                        : "border-[var(--border)] bg-[var(--panel-2)]"
                    } disabled:opacity-80`}
                  >
                    <span className="text-[13px] font-semibold leading-snug text-[var(--text)]">
                      {label}
                    </span>
                    {selected && (
                      <Check
                        className="mt-1.5 size-4 text-[var(--accent)]"
                        strokeWidth={3}
                      />
                    )}
                    {partnerPicked && (
                      <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-[var(--accent-2)]/30 text-[9px] font-bold text-[var(--accent-2)]">
                        <Heart className="size-2.5 fill-current" strokeWidth={0} />
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {myPick !== undefined && (
            <p className="mt-2.5 text-center text-[12px] font-medium text-[var(--text-muted)]">
              {Object.keys(picks).length >= 2
                ? Object.values(picks).every((value) => value === myPick)
                  ? "Same answer 💞"
                  : "Different answers — fun!"
                : "Waiting for their pick…"}
            </p>
          )}
        </div>
      )}

      {session.kind === "truth_or_dare" && (
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3">
          {todText ? (
            <div className="space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">
                {pendingChoice}
              </p>
              <p className="rounded-2xl bg-[var(--panel-2)] p-3.5 text-[14.5px] font-semibold leading-snug text-[var(--text)]">
                {todText}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  icon={<RotateCcw className="size-3.5" />}
                  onClick={() => drawTruthOrDare(pendingChoice ?? "truth")}
                >
                  Redraw
                </Button>
                <Button
                  size="sm"
                  fullWidth
                  icon={<Check className="size-3.5" strokeWidth={3} />}
                  onClick={() => void lockInTruthOrDare()}
                >
                  I did it
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => drawTruthOrDare("truth")}
                className="press flex flex-col items-center gap-1 rounded-2xl bg-gradient-to-br from-[#60a5fa]/25 to-transparent py-5"
              >
                <Sparkles className="size-5 text-[#60a5fa]" strokeWidth={2} />
                <span className="text-[13.5px] font-bold text-[var(--text)]">Truth</span>
              </button>
              <button
                type="button"
                onClick={() => drawTruthOrDare("dare")}
                className="press flex flex-col items-center gap-1 rounded-2xl bg-gradient-to-br from-[#fb7185]/25 to-transparent py-5"
              >
                <Heart className="size-5 text-[#fb7185]" strokeWidth={2} />
                <span className="text-[13.5px] font-bold text-[var(--text)]">Dare</span>
              </button>
            </div>
          )}

          {todHistory.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-2">
              {[...todHistory].reverse().slice(0, 3).map((entry, index) => (
                <p key={index} className="truncate text-[11.5px] text-[var(--text-faint)]">
                  <span className="font-bold text-[var(--text-muted)]">
                    {entry.playerId === currentUserId ? "You" : displayName(partner)}:
                  </span>{" "}
                  {entry.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {session.kind === "two_truths" && (
        <div className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3">
          {!myStatements ? (
            <>
              <p className="text-[12.5px] text-[var(--text-muted)]">
                Write two true things and one lie. They&apos;ll guess which is which.
              </p>
              {stmtInputs.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLieIndex(index)}
                    aria-label="Mark as the lie"
                    className={`grid size-7 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
                      lieIndex === index
                        ? "border-[var(--danger)] bg-[var(--danger)]/20 text-[var(--danger)]"
                        : "border-[var(--border-strong)] text-[var(--text-faint)]"
                    }`}
                  >
                    lie
                  </button>
                  <input
                    value={value}
                    onChange={(event) =>
                      setStmtInputs((current) =>
                        current.map((item, position) =>
                          position === index ? event.target.value : item,
                        ),
                      )
                    }
                    placeholder={`Statement ${index + 1}`}
                    maxLength={120}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                  />
                </div>
              ))}
              <Button
                fullWidth
                size="sm"
                disabled={stmtInputs.some((value) => !value.trim()) || lieIndex === null}
                onClick={() => void submitTruths()}
                icon={<Send className="size-3.5" />}
              >
                Submit mine
              </Button>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-[var(--text-muted)]">
                Yours are in. Waiting for their three…
              </p>
              {partnerId && ttStatements[partnerId] ? (
                ttStatements[partnerId].map((statement, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => void voteFor(index)}
                    className={`press w-full rounded-2xl border px-3 py-2.5 text-left text-[13px] font-medium transition ${
                      ttVotes[currentUserId] === index
                        ? "border-[var(--accent)]/60 bg-[var(--accent)]/15 text-[var(--text)]"
                        : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text-soft)]"
                    }`}
                  >
                    {statement}
                  </button>
                ))
              ) : (
                <div className="flex items-center gap-2 text-[12px] text-[var(--text-faint)]">
                  <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2.4} />
                  They haven&apos;t submitted yet
                </div>
              )}

              {partnerId &&
                ttVotes[currentUserId] !== undefined &&
                ttVotes[`${partnerId}:lie`] !== undefined && (
                  <p className="rounded-xl bg-[var(--success)]/12 px-3 py-2 text-[12px] font-semibold text-[var(--success)]">
                    {ttVotes[currentUserId] === ttVotes[`${partnerId}:lie`]
                      ? "You caught the lie 🕵️"
                      : "They fooled you 😅"}
                  </p>
                )}
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          icon={<Flag className="size-3.5" />}
          onClick={onEnd}
        >
          End game
        </Button>
        {busy && <Spinner className="size-4" />}
      </div>

      {session.status === "finished" && (
        <p className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[var(--accent)]">
          <Crown className="size-3.5" strokeWidth={2.4} />
          Game finished — start another anytime
        </p>
      )}
    </div>
  );
}
