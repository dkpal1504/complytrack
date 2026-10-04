import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
