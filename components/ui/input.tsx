import React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("rounded-md border bg-background px-3 py-2 text-sm", className)} {...props} />;
}
