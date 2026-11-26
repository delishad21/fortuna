import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  { name: "Food & Dining", color: "#ef4444", icon: "utensils" },
  { name: "Transportation", color: "#3b82f6", icon: "bus" },
  { name: "Shopping", color: "#8b5cf6", icon: "shopping-bag" },
  { name: "Entertainment", color: "#ec4899", icon: "film" },
  { name: "Bills & Utilities", color: "#f97316", icon: "zap" },
  { name: "Income", color: "#22c55e", icon: "banknote" },
  { name: "Healthcare", color: "#14b8a6", icon: "heart-pulse" },
  { name: "Education", color: "#f59e0b", icon: "graduation-cap" },
  { name: "Personal Care", color: "#a855f7", icon: "user" },
  { name: "Housing", color: "#06b6d4", icon: "home" },
];

async function seedDefaultCategories(userId: string) {
  console.log(`Seeding default categories for user: ${userId}`);

  for (const category of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({
      where: {
        userId_name: {
          userId,
          name: category.name,
        },
      },
      update: {},
      create: {
        userId,
        name: category.name,
        color: category.color,
        icon: category.icon,
        isDefault: true,
      },
    });
  }

  console.log("✅ Default categories seeded successfully");
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true },
  });

  if (users.length === 0) {
    console.log("No users found. Create a user first.");
    return;
  }

  console.log(`Found ${users.length} user(s):`);
  users.forEach((user: { id: string; username: string | null }, i: number) => {
    console.log(`  ${i + 1}. ${user.username} (${user.id})`);
  });

  // Seed default categories for all users
  for (const user of users) {
    await seedDefaultCategories(user.id);
  }
}

main()
  .catch((e) => {
    console.error("Error seeding categories:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
