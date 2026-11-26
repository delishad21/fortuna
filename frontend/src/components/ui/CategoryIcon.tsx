"use client";

import {
  ArrowRightLeft,
  Baby,
  BadgePercent,
  Banknote,
  BedDouble,
  BookOpen,
  Bus,
  Car,
  Coffee,
  Coins,
  CreditCard,
  Dices,
  Dumbbell,
  FileText,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  Luggage,
  Mountain,
  Music,
  Package,
  PawPrint,
  Plane,
  Receipt,
  Repeat,
  Shapes,
  Shield,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tag,
  Ticket,
  TrendingUp,
  User,
  Utensils,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { categoryIconKey, type CategoryIconKey } from "@/lib/categoryIcons";

export const CATEGORY_LUCIDE_ICONS: Record<CategoryIconKey, LucideIcon> = {
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  bus: Bus,
  car: Car,
  fuel: Fuel,
  plane: Plane,
  luggage: Luggage,
  bed: BedDouble,
  ticket: Ticket,
  zap: Zap,
  smartphone: Smartphone,
  home: House,
  film: Film,
  gamepad: Gamepad2,
  music: Music,
  "shopping-bag": ShoppingBag,
  shirt: Shirt,
  laptop: Laptop,
  package: Package,
  gift: Gift,
  "heart-pulse": HeartPulse,
  dumbbell: Dumbbell,
  mountain: Mountain,
  user: User,
  paw: PawPrint,
  baby: Baby,
  "graduation-cap": GraduationCap,
  book: BookOpen,
  shield: Shield,
  repeat: Repeat,
  banknote: Banknote,
  "badge-percent": BadgePercent,
  "trending-up": TrendingUp,
  landmark: Landmark,
  coins: Coins,
  "file-text": FileText,
  heart: Heart,
  dices: Dices,
  sparkles: Sparkles,
  receipt: Receipt,
  "arrow-right-left": ArrowRightLeft,
  "credit-card": CreditCard,
  shapes: Shapes,
  tag: Tag,
};

const UNCATEGORIZED_COLOR = "#9ca3af";

type CategoryLike = { icon?: string | null; name?: string | null; color?: string | null };

/** A category's icon in a tinted circle of its colour. */
export function CategoryIcon({
  category,
  size = 36,
  className = "",
}: {
  category: CategoryLike | null | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = CATEGORY_LUCIDE_ICONS[categoryIconKey(category)];
  const color = category?.color || UNCATEGORIZED_COLOR;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{ width: size, height: size, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      title={category?.name || "Uncategorized"}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

/** A transaction's image when it has one, else its category's icon. */
export function TransactionAvatar({
  transaction,
  size = 36,
  className = "",
}: {
  transaction: { imageId?: string | null; category?: CategoryLike | null };
  size?: number;
  className?: string;
}) {
  if (transaction.imageId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/images/${transaction.imageId}`}
        alt=""
        className={`shrink-0 rounded-full border border-stroke object-cover dark:border-dark-3 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return <CategoryIcon category={transaction.category} size={size} className={className} />;
}
