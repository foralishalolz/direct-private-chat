"use client";

import { ChevronLeft, Gamepad2, History, Sparkles, Trophy, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Misc";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "@/hooks/useChatStore";
import { GAME_CATALOG, emptyTicTacToe, emptyConnect4Board } from "@/lib/games";
import { displayName, safeRandomId, timeAgo } from "@/lib/utils";
import { GameBoard } from "@/components/games/GameBoard";
import type { GameKind, GameSession, Profile } from "@/types/chat";

interface GamesSheetProps {
  open: boolean;
  onClose: () => void;
  groupId: string | null;
  partner: Profile | null;
}

function initialState(kind: GameKind, turnUserId: string | null) {
  switch (kind) {
    case "tictactoe":
      return { board: emptyTicTacToe(), marks: {} as Record<string, "X" | "O"> };
    case "connect4":
      return { board: emptyConnect4Board(), colors: {} as Record<string, 1 | 2> };
    case "would_you_rather":
    case "this_or_that":
      return { round: 0, picks: {} as Record<string, number>, scores: {} as Record<string, number> };
    case "truth_or_dare":
      return { history: [] as Array<{ playerId: string; choice: string; text: string }> };
    case "two_truths":
      return { phase: "submit", statements: {} as Record<string, string[]>, votes: {} as Record<string, number> };
    default:
      return { turnUserId };
  }
}

export function GamesSheet({ open, onClose, groupId, partner }: GamesSheetProps) {
  const { user, profile } = useChatStore();
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [activeGame, setActiveGame] = useState<GameSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<GameKind | null>(null);

  const loadSessions = useCallback(async () => {
    if (!supabase || !groupId) return;
    setLoading(true);
    const { data } = await supabase
      .from("game_sessions")
      .select("*")
      .eq("group_id", groupId)
      .order("updated_at", { ascending: false })
      .limit(12);
    setSessions((data ?? []) as GameSession[]);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    if (!open) return;
    void loadSessions();
  }, [loadSessions, open]);

  // Live list refresh + auto-open a game your partner just started.
  useEffect(() => {
    if (!supabase || !groupId || !open) return;

    const channel = supabase
      .channel(`games-list-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_sessions",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          void loadSessions();
          if (
            payload.eventType === "INSERT" &&
            (payload.new as GameSession).created_by !== user?.id
          ) {
            setActiveGame(payload.new as GameSession);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [groupId, loadSessions, open, user?.id]);

  useEffect(() => {
    if (activeGame) {
      const fresh = sessions.find((session) => session.id === activeGame.id);
      if (fresh) setActiveGame(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  async function startGame(kind: GameKind) {
    if (!supabase || !groupId || !user || creating) return;
    setCreating(kind);

    const definition = GAME_CATALOG.find((item) => item.kind === kind);
    const { data, error } = await supabase
      .from("game_sessions")
      .insert({
        id: safeRandomId(),
        group_id: groupId,
        kind,
        state: initialState(kind, user.id),
        turn_user_id: user.id,
        created_by: user.id,
        title: definition?.title ?? null,
        status: "active",
      })
      .select("*")
      .single();

    setCreating(null);

    if (error || !data) return;

    setActiveGame(data as GameSession);
    void loadSessions();
  }

  async function endGame(session: GameSession) {
    if (!supabase) return;
    await supabase
      .from("game_sessions")
      .update({ status: "finished" })
      .eq("id", session.id);
    setActiveGame(null);
    void loadSessions();
  }

  const activeSessions = sessions.filter((session) => session.status === "active");
  const finishedSessions = sessions.filter((session) => session.status === "finished");

  if (activeGame) {
    return (
      <Sheet
        open={open}
        onClose={() => {
          setActiveGame(null);
          onClose();
        }}
        bare
      >
        <div className="px-4 pb-4 pt-3">
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActiveGame(null)}
              className="press ml-1 flex items-center gap-1 text-[12.5px] font-semibold text-[var(--text-muted)]"
            >
              <ChevronLeft className="size-4" strokeWidth={2.6} />
              All games
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveGame(null);
                onClose();
              }}
              aria-label="Close"
              className="press grid size-8 place-items-center rounded-full bg-[var(--panel-2)] text-[var(--text-muted)]"
            >
              <X className="size-4" strokeWidth={2.4} />
            </button>
          </div>

          <GameBoard
            session={activeGame}
            onEnd={() => void endGame(activeGame)}
          />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Play together"
      description={
        partner
          ? `Real-time games with ${displayName(partner)} — turns sync instantly.`
          : "Real-time multiplayer, turns sync instantly."
      }
    >
      <div className="space-y-5">
        {activeSessions.length > 0 && (
          <section>
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">
              <Sparkles className="size-3.5" strokeWidth={2.6} />
              In progress
            </p>
            <div className="space-y-1.5">
              {activeSessions.map((session) => {
                const definition = GAME_CATALOG.find(
                  (item) => item.kind === session.kind,
                );
                const yourTurn = session.turn_user_id === user?.id;

                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setActiveGame(session)}
                    className="press flex w-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-left"
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${definition?.tint ?? "from-[var(--accent)] to-[var(--accent-2)]"} text-[16px]`}
                    >
                      {definition?.emoji ?? "🎮"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-[var(--text)]">
                        {definition?.title ?? "Game"}
                      </span>
                      <span className="block text-[11.5px] text-[var(--text-muted)]">
                        {yourTurn ? "Your turn" : "Waiting for them"} ·{" "}
                        {timeAgo(session.updated_at)}
                      </span>
                    </span>
                    {yourTurn && (
                      <span className="shrink-0 animate-pulse rounded-full bg-[var(--accent)]/18 px-2 py-0.5 text-[10.5px] font-bold text-[var(--accent)]">
                        play
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <p className="mb-2 px-1 text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
            Start something
          </p>
          <div className="grid grid-cols-2 gap-2">
            {GAME_CATALOG.map((game) => (
              <button
                key={game.kind}
                type="button"
                onClick={() => void startGame(game.kind)}
                disabled={Boolean(creating) || !groupId}
                className="press relative flex flex-col items-start gap-1.5 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-3 text-left disabled:opacity-50"
              >
                <span
                  className={`grid size-10 place-items-center rounded-2xl bg-gradient-to-br ${game.tint} text-[19px]`}
                >
                  {game.emoji}
                </span>
                <span className="text-[13px] font-bold leading-tight text-[var(--text)]">
                  {game.title}
                </span>
                <span className="text-[11px] leading-snug text-[var(--text-muted)]">
                  {game.tagline}
                </span>
                {creating === game.kind && (
                  <span className="absolute right-2.5 top-2.5">
                    <Spinner className="size-3.5" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>

        {loading && sessions.length === 0 && (
          <div className="grid place-items-center py-6">
            <Spinner className="size-4" />
          </div>
        )}

        {finishedSessions.length > 0 && (
          <section>
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              <History className="size-3.5" strokeWidth={2.4} />
              Finished
            </p>
            <div className="space-y-1">
              {finishedSessions.slice(0, 4).map((session) => {
                const definition = GAME_CATALOG.find((item) => item.kind === session.kind);
                return (
                  <div
                    key={session.id}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-[12px] text-[var(--text-muted)]"
                  >
                    <Trophy className="size-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={2.2} />
                    <span className="truncate">{definition?.title ?? "Game"}</span>
                    <span className="ml-auto shrink-0 text-[10.5px] text-[var(--text-faint)]">
                      {timeAgo(session.updated_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-faint)]">
          <Gamepad2 className="size-3" strokeWidth={2.2} />
          {partner ? `You & ${displayName(profile)}` : "Multiplayer"} · live sync
        </p>
      </div>
    </Sheet>
  );
}
