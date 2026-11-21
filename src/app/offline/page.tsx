import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="hero-bg grid min-h-dvh place-items-center px-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-16 place-items-center rounded-3xl border border-[var(--border)] bg-[var(--panel)]">
          <WifiOff className="size-7 text-[var(--text-muted)]" strokeWidth={1.6} />
        </div>
        <h1 className="mt-6 text-xl font-semibold text-[var(--text)]">
          You&apos;re offline
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          Messages you send will queue up and deliver the moment you&apos;re back
          online. Cached chats and photos are still available.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full accent-gradient px-6 text-sm font-semibold text-white"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
