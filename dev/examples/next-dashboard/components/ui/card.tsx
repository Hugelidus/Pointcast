import * as React from "react";

/** shadcn/ui's Card parts, trimmed. */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={["card", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-title" className={["card-title", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={["card-content", className].filter(Boolean).join(" ")} {...props} />;
}
