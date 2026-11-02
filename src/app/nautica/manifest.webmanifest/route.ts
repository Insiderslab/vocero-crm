import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    id: "/nautica",
    name: "La Bambola · Tripulación",
    short_name: "Tripulación",
    start_url: "/nautica",
    scope: "/nautica",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#075985",
    icons: [
      { src: "/marine/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/marine/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
