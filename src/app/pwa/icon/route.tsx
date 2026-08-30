import { ImageResponse } from "next/og";

// Dinâmico: o tamanho/maskable vêm da query string, então não pode ser estático.
export const dynamic = "force-dynamic";

const NAVY = "#1a2744";
const GOLD = "#c9a84c";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const size = Math.min(1024, Math.max(48, Number(searchParams.get("size")) || 512));
  const maskable = searchParams.get("maskable") === "1";

  // Maskable icons need a safe zone (~80% of the canvas), so the monogram
  // shrinks a bit and the navy background bleeds to the edges.
  const monogramSize = maskable ? size * 0.42 : size * 0.52;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(150deg, ${NAVY} 0%, #111b33 100%)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: monogramSize,
            fontWeight: 700,
            letterSpacing: `${monogramSize * 0.02}px`,
            color: GOLD,
            fontFamily: "sans-serif",
            lineHeight: 1,
          }}
        >
          JG
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
