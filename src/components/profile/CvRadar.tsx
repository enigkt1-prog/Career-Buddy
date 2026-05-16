/**
 * Hand-rolled CV radar (F2). No charting dependency — a plain SVG
 * spider chart. Each axis label is a button that opens Buddy with a
 * prefilled prompt about that axis.
 *
 * The geometry is axis-count agnostic (angle step = 360 / n) so a
 * radar persisted with a different axis count still renders cleanly;
 * the analyze-cv Zod validator pins the live payload to 6.
 */
import { useEffect } from "react";

import type { CvRadar as CvRadarData } from "@/lib/cv-storage";
import { track } from "@/lib/telemetry";

const SIZE = 320;
const CENTER = SIZE / 2;
const MAX_R = 96;
const LABEL_R = 1.3; // label ring, as a multiple of MAX_R
const RINGS = [25, 50, 75, 100];

/** Polar → cartesian for axis `i` of `count` (0 = top, clockwise). */
function point(i: number, ratio: number, count: number): { x: number; y: number } {
  const angle = (-90 + i * (360 / count)) * (Math.PI / 180);
  const r = MAX_R * ratio;
  return { x: CENTER + r * Math.cos(angle), y: CENTER + r * Math.sin(angle) };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function polygonPoints(ratios: number[]): string {
  return ratios
    .map((r, i) => {
      const p = point(i, r, ratios.length);
      return `${p.x},${p.y}`;
    })
    .join(" ");
}

export function CvRadar({ radar }: { radar: CvRadarData }) {
  const axes = radar.axes;

  useEffect(() => {
    void track("radar_view");
  }, []);

  if (axes.length === 0) return null;

  function openBuddy(axis: string, score: number) {
    void track("radar_axis_click", { axis, score });
    window.dispatchEvent(
      new CustomEvent("open-buddy", {
        detail: {
          prefill: `Walk me through my "${axis}" score of ${score}/100 — what on my CV drove it, and the fastest way to lift it?`,
        },
      }),
    );
  }

  const dataPolygon = polygonPoints(axes.map((a) => clampScore(a.score) / 100));

  return (
    <div className="relative mx-auto" style={{ width: SIZE, maxWidth: "100%" }}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full overflow-visible"
        role="img"
        aria-label="CV radar — fit chart"
      >
        {RINGS.map((ring) => (
          <polygon
            key={ring}
            points={polygonPoints(axes.map(() => ring / 100))}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            className="text-cinema-mint"
          />
        ))}
        {axes.map((a, i) => {
          const edge = point(i, 1, axes.length);
          return (
            <line
              key={a.name}
              x1={CENTER}
              y1={CENTER}
              x2={edge.x}
              y2={edge.y}
              stroke="currentColor"
              strokeWidth={1}
              className="text-cinema-mint"
            />
          );
        })}
        <polygon
          points={dataPolygon}
          fill="currentColor"
          fillOpacity={0.22}
          stroke="currentColor"
          strokeWidth={2}
          className="text-cinema-moss"
        />
        {axes.map((a, i) => {
          const p = point(i, clampScore(a.score) / 100, axes.length);
          return (
            <circle
              key={a.name}
              cx={p.x}
              cy={p.y}
              r={3.5}
              fill="currentColor"
              className="text-cinema-moss"
            />
          );
        })}
      </svg>

      {axes.map((a, i) => {
        const p = point(i, LABEL_R, axes.length);
        return (
          <button
            key={a.name}
            type="button"
            onClick={() => openBuddy(a.name, a.score)}
            title={`Ask Buddy about ${a.name}`}
            style={{
              left: `${(p.x / SIZE) * 100}%`,
              top: `${(p.y / SIZE) * 100}%`,
            }}
            className="absolute flex max-w-[6.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded-glass border border-cinema-mint bg-white px-2 py-1 text-center text-cinema-caption text-cinema-ink transition-colors hover:bg-cinema-mint/40"
          >
            <span className="font-medium leading-tight">{a.name}</span>
            <span className="text-cinema-ink-mute">{clampScore(a.score)}</span>
          </button>
        );
      })}
    </div>
  );
}
