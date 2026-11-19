/** Ícones de traço fino no espírito dos SF Symbols (desenhados à mão, 24×24). */
const PATHS = {
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  export: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14" />,
  import: <path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" />,
  check: <path d="m5.5 12.5 4 4 9-9.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  photos: (
    <>
      <rect x="3.5" y="7" width="13.5" height="13.5" rx="2.5" />
      <path d="M7 4h11a2.5 2.5 0 0 1 2.5 2.5V17" />
    </>
  ),
  text: <path d="M5 6.5h14M5 12h14M5 17.5h9" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
      <path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2" />
    </>
  ),
  bag: (
    <>
      <path d="M5.5 8h13l-1 12h-11Z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </>
  ),
  undo: <path d="M9 7.5 5 11.5l4 4M5.5 11.5H15a4.5 4.5 0 0 1 0 9h-3" />,
  arrow: <path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" />,
  chevron: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5Z" />
    </>
  ),
  sparkle: <path d="M12 3.5c.6 4.4 2.6 6.9 7.5 8.5-4.9 1.6-6.9 4.1-7.5 8.5-.6-4.4-2.6-6.9-7.5-8.5 4.9-1.6 6.9-4.1 7.5-8.5Z" />,
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 16, stroke = 1.9 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
