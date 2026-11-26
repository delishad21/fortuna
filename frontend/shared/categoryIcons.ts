/**
 * Category icons shared by web and mobile. `Category.icon` holds one of these
 * keys; web maps them to lucide icons (components/ui/CategoryIcon.tsx), mobile
 * to Ionicons (`ionicon` below). Older rows may still hold Material names or
 * "category" (never chosen); categoryIconKey resolves those.
 */
export const CATEGORY_ICONS = [
  { key: "shopping-cart", label: "Groceries", ionicon: "cart-outline" },
  { key: "utensils", label: "Dining", ionicon: "restaurant-outline" },
  { key: "coffee", label: "Coffee", ionicon: "cafe-outline" },
  { key: "bus", label: "Transport", ionicon: "bus-outline" },
  { key: "car", label: "Car", ionicon: "car-outline" },
  { key: "fuel", label: "Fuel", ionicon: "speedometer-outline" },
  { key: "plane", label: "Flights", ionicon: "airplane-outline" },
  { key: "luggage", label: "Travel", ionicon: "briefcase-outline" },
  { key: "bed", label: "Accommodation", ionicon: "bed-outline" },
  { key: "ticket", label: "Tickets", ionicon: "ticket-outline" },
  { key: "zap", label: "Utilities", ionicon: "flash-outline" },
  { key: "smartphone", label: "Phone", ionicon: "phone-portrait-outline" },
  { key: "home", label: "Housing", ionicon: "home-outline" },
  { key: "film", label: "Entertainment", ionicon: "film-outline" },
  { key: "gamepad", label: "Games", ionicon: "game-controller-outline" },
  { key: "music", label: "Music", ionicon: "musical-notes-outline" },
  { key: "shopping-bag", label: "Shopping", ionicon: "bag-handle-outline" },
  { key: "shirt", label: "Clothing", ionicon: "shirt-outline" },
  { key: "laptop", label: "Tech", ionicon: "laptop-outline" },
  { key: "package", label: "Essentials", ionicon: "cube-outline" },
  { key: "gift", label: "Gifts", ionicon: "gift-outline" },
  { key: "heart-pulse", label: "Health", ionicon: "medkit-outline" },
  { key: "dumbbell", label: "Fitness", ionicon: "barbell-outline" },
  { key: "mountain", label: "Outdoors", ionicon: "trail-sign-outline" },
  { key: "user", label: "Personal care", ionicon: "person-outline" },
  { key: "paw", label: "Pets", ionicon: "paw-outline" },
  { key: "baby", label: "Kids", ionicon: "happy-outline" },
  { key: "graduation-cap", label: "Education", ionicon: "school-outline" },
  { key: "book", label: "Books", ionicon: "book-outline" },
  { key: "shield", label: "Insurance", ionicon: "shield-checkmark-outline" },
  { key: "repeat", label: "Subscriptions", ionicon: "repeat-outline" },
  { key: "banknote", label: "Income", ionicon: "cash-outline" },
  { key: "badge-percent", label: "Cashback", ionicon: "pricetags-outline" },
  { key: "trending-up", label: "Investments", ionicon: "trending-up-outline" },
  { key: "landmark", label: "Government", ionicon: "business-outline" },
  { key: "coins", label: "Fees", ionicon: "wallet-outline" },
  { key: "file-text", label: "Bills", ionicon: "document-text-outline" },
  { key: "heart", label: "Charity", ionicon: "heart-outline" },
  { key: "dices", label: "Gambling", ionicon: "dice-outline" },
  { key: "sparkles", label: "AI", ionicon: "sparkles-outline" },
  { key: "receipt", label: "Reimbursement", ionicon: "receipt-outline" },
  { key: "arrow-right-left", label: "Transfers", ionicon: "swap-horizontal-outline" },
  { key: "credit-card", label: "Card", ionicon: "card-outline" },
  { key: "shapes", label: "Other", ionicon: "shapes-outline" },
  { key: "tag", label: "Uncategorized", ionicon: "pricetag-outline" },
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICONS)[number]["key"];

const KEYS = new Set<string>(CATEGORY_ICONS.map((icon) => icon.key));

/** Icon names stored by earlier versions, mapped to current keys. */
const LEGACY_ICONS: Record<string, CategoryIconKey> = {
  shopping_cart: "shopping-cart",
  restaurant: "utensils",
  directions_car: "bus",
  bolt: "zap",
  movie: "film",
  shopping_bag: "shopping-bag",
  local_hospital: "heart-pulse",
  attach_money: "banknote",
  swap_horiz: "arrow-right-left",
  "arrow-left-right": "arrow-right-left",
  label: "tag",
  "dollar-sign": "banknote",
};

/**
 * Icons for well-known category names, lowercase. The default categories are
 * all here; the migration that gives existing users these icons uses the same
 * table (services/data-service/prisma/migrations/*_category_icons).
 */
export const CATEGORY_NAME_ICONS: Record<string, CategoryIconKey> = {
  groceries: "shopping-cart",
  dining: "utensils",
  "food & dining": "utensils",
  food: "utensils",
  coffee: "coffee",
  transportation: "bus",
  transport: "bus",
  car: "car",
  fuel: "fuel",
  petrol: "fuel",
  flights: "plane",
  travel: "luggage",
  accommodation: "bed",
  attractions: "ticket",
  fees: "coins",
  utilities: "zap",
  "bills & utilities": "zap",
  bills: "file-text",
  telco: "smartphone",
  phone: "smartphone",
  housing: "home",
  rent: "home",
  entertainment: "film",
  games: "gamepad",
  gaming: "gamepad",
  music: "music",
  shopping: "shopping-bag",
  clothing: "shirt",
  clothes: "shirt",
  tech: "laptop",
  essentials: "package",
  gift: "gift",
  gifts: "gift",
  health: "heart-pulse",
  healthcare: "heart-pulse",
  medical: "heart-pulse",
  fitness: "dumbbell",
  activity: "dumbbell",
  sports: "dumbbell",
  bouldering: "mountain",
  "personal care": "user",
  pets: "paw",
  kids: "baby",
  education: "graduation-cap",
  books: "book",
  insurance: "shield",
  subscriptions: "repeat",
  income: "banknote",
  salary: "banknote",
  cashback: "badge-percent",
  rewards: "badge-percent",
  investments: "trending-up",
  "govt handouts": "landmark",
  government: "landmark",
  taxes: "landmark",
  charity: "heart",
  donations: "heart",
  gambling: "dices",
  ai: "sparkles",
  reimbursement: "receipt",
  transfers: "arrow-right-left",
  internal: "arrow-right-left",
  other: "shapes",
  uncategorized: "tag",
};

/** The icon to draw for a category: its own, else one for its name, else a tag. */
export function categoryIconKey(
  category: { icon?: string | null; name?: string | null } | null | undefined,
): CategoryIconKey {
  const icon = category?.icon?.trim() || "";
  if (KEYS.has(icon)) return icon as CategoryIconKey;
  if (LEGACY_ICONS[icon]) return LEGACY_ICONS[icon];
  const name = category?.name?.trim().toLowerCase() || "";
  return CATEGORY_NAME_ICONS[name] || "tag";
}

/** The Ionicons name for a category (mobile). */
export function categoryIonicon(
  category: { icon?: string | null; name?: string | null } | null | undefined,
) {
  const key = categoryIconKey(category);
  return CATEGORY_ICONS.find((icon) => icon.key === key)!.ionicon;
}
