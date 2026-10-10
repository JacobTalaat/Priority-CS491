import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";

type StyleOptions = {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string;
};

function buttonClassName({ variant = "primary", fullWidth, className }: StyleOptions) {
  return [styles.button, styles[variant], fullWidth ? styles.fullWidth : null, className]
    .filter(Boolean)
    .join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  StyleOptions & {
    loading?: boolean;
  };

export function Button({
  variant,
  fullWidth,
  loading = false,
  disabled,
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClassName({ variant, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & StyleOptions;

export function ButtonLink({ variant, fullWidth, className, ...props }: ButtonLinkProps) {
  return <Link {...props} className={buttonClassName({ variant, fullWidth, className })} />;
}
