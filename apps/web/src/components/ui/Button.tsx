import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

/** SaveMeal V2.1 pill button: primary (ink), secondary (white + hairline), danger (soft red), lime (electric lime). */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "lime";
  block?: boolean;
};

export function Button({ variant = "primary", block = true, className, type = "button", ...rest }: ButtonProps) {
  const cls = [styles.button, styles[variant], block ? styles.block : "", className].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}
