import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./IconButton.module.css";

/** Round floating button from Figma V1 01 (2:67 "locate me"). `label` is required for screen readers. */
type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> & {
  icon: IconName;
  label: string;
};

export function IconButton({ icon, label, className, ...rest }: IconButtonProps) {
  return (
    <button type="button" aria-label={label} className={[styles.button, className].filter(Boolean).join(" ")} {...rest}>
      <Icon name={icon} size={24} color="var(--color-sky)" />
    </button>
  );
}
