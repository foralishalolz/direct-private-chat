"use client";

import dynamic from "next/dynamic";

const ProfileLanding = dynamic(() => import("@/components/ProfileLanding"), {
  ssr: false,
  loading: () => <main className="link-landing"><div className="link-card"><span className="brand"><span className="brand-mark">💌</span><span>BitchAt<span className="brand-dot">.</span></span></span></div></main>,
});

export default function SharedProfile() {
  return <ProfileLanding />;
}
