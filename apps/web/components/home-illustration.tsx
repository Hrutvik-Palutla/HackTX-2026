"use client";
import { useState } from "react";

/** Decorative anatomy figure; stays invisible until it has actually loaded (no broken-image flash). */
export function HomeIllustration({ name, className }: { name: string; className: string }) {
  const [ready, setReady] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`home-figure ${className}`}
      data-ready={ready || undefined}
      src={`/illustrations/${name}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
      onLoad={() => setReady(true)}
    />
  );
}
