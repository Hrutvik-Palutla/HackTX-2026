export function NavigationIcon({ name }: { name: string }) {
  return (
    <svg
      className="navigation-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "plans" ? (
        <>
          <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
          <path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h3M8 17.5h6" />
        </>
      ) : name === "friends" ? (
        <>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 21v-2.5a6.5 6.5 0 0 1 13 0V21M17 5a3.5 3.5 0 0 1 0 7M18.5 15a5 5 0 0 1 3 4.5V21" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="9" r="3" />
          <path d="M5.5 18a7 7 0 0 1 13 0" />
        </>
      )}
    </svg>
  );
}
