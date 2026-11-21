import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitchAt — just us",
    short_name: "BitchAt",
    description:
      "A private real-time chat for two — media, plans, games and love notes.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#0a0812",
    theme_color: "#0a0812",
    categories: ["social", "communication"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Open chat", url: "/", description: "Jump into your chats" },
      { name: "Us", url: "/?tab=us", description: "Plans, games and notes" },
    ],
  };
}
