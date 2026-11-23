import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

/** Figma V1 13:48 "ACTION / STATES": primary (mint), secondary (raised), disabled (muted). */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  block?: boolean;
};

export function Button({ variant = "primary", block = true, className, type = "button", ...rest }: ButtonProps) {
  const cls = [styles.button, styles[variant], block ? styles.block : "", className].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}
