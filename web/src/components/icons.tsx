import type { SVGProps } from "react";

/**
 * Small hand-drawn-to-match icon set in Figma's own style: 1.5px stroke,
 * round caps/joins, no fill, 20x20 viewBox. Color comes from `currentColor`
 * so a parent just sets text color for default/hover/active states.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SelectIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 3.5 15.5 10l-4.3.9 2.6 4-1.7 1-2.6-4-2.8 3.1Z" strokeWidth={1.3} />
    </Base>
  );
}

export function HandIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7.5 10.2V4.8a1.2 1.2 0 1 1 2.4 0v4.4M9.9 9.2V3.6a1.2 1.2 0 1 1 2.4 0v5.6M12.3 9.4V4.9a1.2 1.2 0 1 1 2.4 0v6.6M7.5 9.6l-1.3-1.3a1.25 1.25 0 0 0-1.9 1.6l2.2 3.1c1 1.6 2 3.1 4.4 3.1h.9c2.5 0 4-1.5 4-4V9" />
    </Base>
  );
}

export function RectIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="5.5" width="12" height="9" rx="1.5" />
    </Base>
  );
}

export function EllipseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="10" cy="10" r="6" />
    </Base>
  );
}

export function DiamondIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10 3.5 16.5 10 10 16.5 3.5 10Z" />
    </Base>
  );
}

export function StickyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 4.5h8l3 3v8h-11Z" />
      <path d="M12.5 4.5v3h3" />
    </Base>
  );
}

export function TextIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 5h10M10 5v10" />
    </Base>
  );
}

export function ArrowToolIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 15 15 5M8.5 5H15v6.5" />
    </Base>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Base {...props} strokeWidth={1.3}>
      <path d="M10 3.5c.4 2.3 1 3.9 2.2 5.1 1.2 1.2 2.8 1.8 5.1 2.2-2.3.4-3.9 1-5.1 2.2-1.2 1.2-1.8 2.8-2.2 5.1-.4-2.3-1-3.9-2.2-5.1-1.2-1.2-2.8-1.8-5.1-2.2 2.3-.4 3.9-1 5.1-2.2 1.2-1.2 1.8-2.8 2.2-5.1Z" fill="currentColor" stroke="none" />
    </Base>
  );
}
