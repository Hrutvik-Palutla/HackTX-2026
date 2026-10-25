/** Decorative Anatomy scene with its time of day, served as a standalone SVG from public assets. */
export function HomeIllustration({ name, time, label, index }: { name: string; time: string; label: string; index: number }) {
  return (
    <figure className={`home-stop home-stop--${index + 1}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="home-figure" src={`/illustrations/${name}.svg`} alt="" draggable={false} loading="eager" decoding="async" />
      <figcaption>
        <time>{time}</time> {label}
      </figcaption>
    </figure>
  );
}
