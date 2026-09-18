import { Manrope, Unbounded } from "next/font/google";
import { cn } from "@/lib/utils";

// Основной логотип «Бек-бек»: знак (бегущая птица) + надпись.
// Значения — из макета «Основной логотип» (артборд 1360×600): знак 340 px,
// надпись 104 px, отступ 44 px. Здесь всё уменьшено ~в 3,4 раза; размеры
// точек после надписи заданы в em, чтобы масштабировались вместе с текстом.

const unbounded = Unbounded({
  weight: "800",
  subsets: ["cyrillic", "latin"],
});

const manrope = Manrope({
  weight: ["500", "600"],
  subsets: ["latin"],
});

const INK = "#1A2328";
const ORANGE = "#F2692E";
const PAPER = "#FBF3E4";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-3", className)}>
      <LogoMark className="h-[74px] w-[96px] shrink-0" />
      <span
        className={cn(
          unbounded.className,
          "whitespace-nowrap text-[30px] leading-none tracking-[-0.03em]",
        )}
        style={{ color: INK }}
      >
        Бек-<span style={{ color: "#D9531A" }}>бек</span>
        <Dot size={0.19} gap={0.115} opacity={1} />
        <Dot size={0.144} gap={0.087} opacity={0.7} />
        <Dot size={0.096} gap={0.077} opacity={0.45} />
      </span>
    </div>
  );
}

/** Подпись «Powered by braty» — в макете стоит внизу, под логотипом. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        manrope.className,
        "text-center text-sm font-medium tracking-[0.06em]",
        className,
      )}
      style={{ color: "#6B6558" }}
    >
      Powered by <b className="font-semibold" style={{ color: INK }}>braty</b>
    </p>
  );
}

function Dot({ size, gap, opacity }: { size: number; gap: number; opacity: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-full"
      style={{
        width: `${size}em`,
        height: `${size}em`,
        marginLeft: `${gap}em`,
        background: ORANGE,
        opacity,
      }}
    />
  );
}

/** Знак: птица в кроссовках с полосами скорости. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="-30 20 260 200" className={className} aria-hidden="true">
      {/* полосы скорости и пузырьки */}
      <path
        d="M -24 112 L 4 112 M -14 134 L 22 134 M -4 156 L 18 156"
        fill="none"
        stroke={INK}
        strokeWidth={7}
        strokeLinecap="round"
      />
      <circle cx={16} cy={206} r={7} fill={PAPER} stroke={INK} strokeWidth={4} />
      <circle cx={0} cy={193} r={4.5} fill={PAPER} stroke={INK} strokeWidth={4} />

      {/* задняя нога */}
      <Leg d="M 100 160 L 80 184 L 56 176" />
      <Sneaker transform="translate(56 176) rotate(30)" />

      {/* передняя нога */}
      <Leg d="M 124 158 L 142 182 L 146 196" />
      <Sneaker transform="translate(146 196) rotate(-10)" />

      {/* тело */}
      <path
        d="M 34 86 C 60 100 96 108 120 100 C 132 96 128 44 160 40 C 182 40 192 56 190 70 C 188 86 176 92 174 104 C 172 120 182 150 150 162 C 120 172 80 170 64 152 C 50 140 48 120 54 112 C 44 104 36 94 34 86 Z"
        fill="#FFC93C"
        stroke={INK}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path
        d="M 156 40 C 152 30 158 24 166 27"
        fill="none"
        stroke={INK}
        strokeWidth={4}
        strokeLinecap="round"
      />

      {/* крыло */}
      <path
        d="M 150 130 C 138 106 104 94 70 92 C 80 102 84 112 90 118 C 98 140 128 148 150 130 Z"
        fill="#F4A922"
        stroke={INK}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path
        d="M 100 116 L 122 119 M 110 128 L 132 131"
        fill="none"
        stroke={INK}
        strokeWidth={4}
        strokeLinecap="round"
      />

      {/* клюв, щека, глаз */}
      <path
        d="M 184 60 C 200 57 214 62 222 70 C 214 80 200 83 184 80 Z"
        fill={ORANGE}
        stroke={INK}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path d="M 190 71 L 212 71" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <circle cx={160} cy={78} r={6} fill={ORANGE} opacity={0.35} />
      <circle cx={168} cy={58} r={5.5} fill={INK} />
      <circle cx={170} cy={56} r={1.8} fill="#FFFFFF" />
    </svg>
  );
}

/** Нога: тёмный контур и оранжевая середина. */
function Leg({ d }: { d: string }) {
  const common = {
    d,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <>
      <path {...common} stroke={INK} strokeWidth={14} />
      <path {...common} stroke={ORANGE} strokeWidth={5} />
    </>
  );
}

function Sneaker({ transform }: { transform: string }) {
  return (
    <g transform={transform}>
      <path
        d="M -10 -6 C -8 -11 4 -12 10 -6 L 22 -2 C 32 0 40 4 40 10 L -14 12 C -16 6 -15 -1 -10 -6 Z"
        fill="#E23B3B"
        stroke={INK}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path
        d="M -16 10 L 42 8 C 45 12 44 17 39 18 L -12 18 C -17 18 -18 13 -16 10 Z"
        fill="#FFFFFF"
        stroke={INK}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <path
        d="M 9 -5 L 5 1 M 17 -2 L 13 3 M -4 5 C 6 2 16 3 26 6"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
}
