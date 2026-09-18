"use client";

import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
  iconClassName?: string;
}

export function BrandMark({ className, iconClassName }: BrandMarkProps) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black",
        className,
      )}
    >
      <img src="/images/brand/fortuna.png" alt="" aria-hidden="true" className="absolute h-[170%] w-[170%] max-w-none object-cover" />
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
