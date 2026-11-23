import type { CSSProperties } from "react";
import styles from "./Icon.module.css";

/** Icon files exported from Figma V1 (apps/web/public/icons). */
export type IconName = "search" | "navigation" | "nav-discover" | "nav-saved" | "nav-post" | "nav-account";

type IconProps = {
  name: IconName;
  size?: number;
  /** Any CSS color; defaults to currentColor so state colors come from the parent. */
  color?: string;
  className?: string;
};

/**
 * Renders the Figma SVG as a CSS mask, so the exact exported geometry is kept
 * while the color follows state (active/inactive) without editing the asset.
 */
export function Icon({ name, size = 22, color = "currentColor", className }: IconProps) {
  const style = {
    width: size,
    height: size,
    backgroundColor: color,
    maskImage: `url(/icons/${name}.svg)`,
    WebkitMaskImage: `url(/icons/${name}.svg)`,
  } satisfies CSSProperties;
  return <span aria-hidden="true" className={[styles.icon, className].filter(Boolean).join(" ")} style={style} />;
}
