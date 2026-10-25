/** Decorative Anatomy figure, served as a standalone SVG from public assets. */
export function HomeIllustration({ name, className }: { name: string; className: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`home-figure ${className}`}
      src={`/illustrations/${name}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="eager"
      decoding="async"
    />
  );
}
