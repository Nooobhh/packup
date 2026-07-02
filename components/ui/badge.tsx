import React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground", className)} {...props} />;
}
