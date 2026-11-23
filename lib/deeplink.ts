"use client";

import { useEffect, useRef } from "react";

/**
 * Reads an @username deep link and asks the app to open that person.
 *
 *   /u/username        profile landing page (static export friendly)
 *   /?u=username       query shortcut
 *   @username          a bare handle pasted into the app
 *
 * Nothing is stored: the handler only reports the username it found.
 */

const PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/i;
const KEY = "bitchat-open-user";

export function readUsername(value: string | null | undefined) {
  if (!value) return "";
  const name = decodeURIComponent(value).trim().replace(/^@/, "").toLowerCase();
  return PATTERN.test(name) ? name : "";
}

export function usernameFromLocation(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  const path = url.pathname.match(/^\/u\/([^/]+)\/?$/);
  if (path) return readUsername(path[1]);
  return readUsername(url.searchParams.get("u") || url.searchParams.get("username"));
}

/** Persist the target across the login screen, which unmounts the app. */
export function rememberUser(username: string) {
  try { if (username) sessionStorage.setItem(KEY, username); } catch {}
}
export function takeRememberedUser() {
  try { const value = sessionStorage.getItem(KEY); if (value) sessionStorage.removeItem(KEY); return readUsername(value); } catch { return ""; }
}

export function useDeepLink(onUser: (username: string) => void, ready: boolean) {
  const callback = useRef(onUser);
  callback.current = onUser;
  useEffect(() => {
    if (!ready) return;
    const direct = usernameFromLocation();
    const pending = takeRememberedUser();
    const target = direct || pending;
    if (!target) return;
    rememberUser("");
    callback.current(target);
  }, [ready]);
}
