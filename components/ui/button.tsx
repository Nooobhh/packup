import React from "react";
import { cn } from "@/lib/utils";

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground", className)} {...props} />;
}
