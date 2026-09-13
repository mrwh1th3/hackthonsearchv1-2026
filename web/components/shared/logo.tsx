import { cn } from "@/lib/utils";

/** Inspector's four-point star. Keep the path in sync with public/inspector-star.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("h-5 w-5", className)}
      aria-hidden="true"
    >
      <path
        d="M16 2.5 20.1 11.9 29.5 16 20.1 20.1 16 29.5 11.9 20.1 2.5 16 11.9 11.9Z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
      <path d="M16 2.5 14.4 17.6 29.5 16M14.4 17.6 16 29.5M14.4 17.6 2.5 16" stroke="currentColor" strokeWidth="1.05" strokeLinejoin="round" />
    </svg>
  );
}

export function InspectorWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inspector-wordmark", className)}>
      <Logo className="inspector-wordmark-star" />
      <span>Inspector</span>
    </span>
  );
}
