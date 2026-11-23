"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usernameFromLocation } from "@/lib/deeplink";
import { db } from "@/lib/supabase";

/**
 * Landing for a shared @username link. The static export serves one shell and
 * Vercel rewrites /u/<name>/ onto it, so the handle is read from the URL.
 */
export default function ProfileLanding() {
  const [handle, setHandle] = useState("");
  useEffect(() => {
    const found = usernameFromLocation();
    setHandle(found);
    // A signed-in visitor should land on the profile, not on this doorway.
    if (!found) return;
    let active = true;
    void db().auth.getSession().then(({ data }) => {
      if (active && data.session) window.location.replace("/?u=" + encodeURIComponent(found));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <main className="link-landing">
      <div className="link-card">
        <span className="brand"><span className="brand-mark">💌</span><span>BitchAt<span className="brand-dot">.</span></span></span>
        <h1>{handle ? "@" + handle : "A profile on BitchAt"}</h1>
        <p>Open BitchAt to see this profile and say hi. Your handle comes with you, so you land on the right person after signing in.</p>
        <Link className="primary" href={handle ? "/?u=" + encodeURIComponent(handle) : "/"}>Open profile</Link>
        <small>Nothing is shared until you press send.</small>
      </div>
    </main>
  );
}
