"use client";

import { BadgeDollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
  iconClassName?: string;
}

export function BrandMark({ className, iconClassName }: BrandMarkProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-primary text-white",
        className,
      )}
    >
      <BadgeDollarSign className={cn("size-6", iconClassName)} />
    </div>
  );
}

interface BrandLogoProps {
  markClassName?: string;
  iconClassName?: string;
  textClassName?: string;
}

export function BrandLogo({
  markClassName = "h-[52px] w-[52px]",
  iconClassName,
  textClassName,
}: BrandLogoProps) {
  return (
    <div className="flex items-center gap-2">
      <BrandMark className={markClassName} iconClassName={iconClassName} />
      <span
        className={cn(
          "font-display text-3xl font-extrabold uppercase leading-none text-dark dark:text-white",
          textClassName,
        )}
      >
        Fortuna
      </span>
    </div>
  );
}
