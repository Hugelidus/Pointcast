import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

const VARIANTS = {
  default: "btn btn-primary",
  outline: "btn btn-outline",
  ghost: "btn btn-ghost",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  asChild?: boolean;
}

/** shadcn/ui's Button, trimmed: a Radix Slot when asChild, else a <button>. */
export function Button({ className, variant = "default", asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={[VARIANTS[variant], className].filter(Boolean).join(" ")} {...props} />;
}
