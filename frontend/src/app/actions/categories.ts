"use server";

import { auth } from "@/lib/actionAuth";
import { prisma } from "@/lib/db/client";
import { TRIP_CATEGORY_DEFINITIONS } from "@/lib/tripCategories";

export interface Category {
  id: string;
  name: string;
  color: string;
}

const TRIP_CATEGORY_NAME_SET = new Set(
  TRIP_CATEGORY_DEFINITIONS.map((item) => item.name.toLowerCase()),
);

const isTripCategoryName = (name: string) =>
  TRIP_CATEGORY_NAME_SET.has(name.trim().toLowerCase());

async function ensureTripCategories(userId: string): Promise<void> {
  await Promise.all(
    TRIP_CATEGORY_DEFINITIONS.map((item) =>
      prisma.category.upsert({
        where: {
          userId_name: {
            userId,
            name: item.name,
          },
        },
        update: {},
        create: {
          userId,
          name: item.name,
          color: item.color,
          isDefault: true,
          icon: "trip",
        },
      }),
    ),
  );
}

export async function getCategories(options?: {
  scope?: "main" | "trips" | "settings";
}): Promise<Category[]> {
  const session = await auth();

  if (!session?.user?.id) {
    return [];
  }

  const scope = options?.scope || "main";
  if (scope === "trips" || scope === "settings") {
    await ensureTripCategories(session.user.id);
  }

  const categories = await prisma.category.findMany({
    where: {
      userId: session.user.id,
      ...(scope === "main"
        ? {
            NOT: TRIP_CATEGORY_DEFINITIONS.map((item) => ({
              name: { equals: item.name, mode: "insensitive" as const },
            })),
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  return categories;
}

export async function createCategory(
  name: string,
  color: string,
): Promise<Category> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  if (isTripCategoryName(name)) {
    throw new Error(
      "Trip categories are system-defined. Edit their color in Settings instead.",
    );
  }

  const category = await prisma.category.create({
    data: {
      userId: session.user.id,
      name,
      color,
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });

  return category;
}

export async function deleteCategory(categoryId: string): Promise<void> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  // Verify the category belongs to the user before deleting
  const category = await prisma.category.findFirst({
    where: {
      id: categoryId,
      userId: session.user.id,
    },
  });

  if (!category) {
    throw new Error("Category not found or unauthorized");
  }

  if (isTripCategoryName(category.name)) {
    throw new Error("Trip categories cannot be deleted.");
  }

  // Delete the category (transactions will have categoryId set to null due to onDelete: SetNull)
  await prisma.category.delete({
    where: {
      id: categoryId,
    },
  });
}

export async function updateCategory(
  categoryId: string,
  name: string,
  color: string,
): Promise<Category> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  // Verify the category belongs to the user before updating
  const existingCategory = await prisma.category.findFirst({
    where: {
      id: categoryId,
      userId: session.user.id,
    },
  });

  if (!existingCategory) {
    throw new Error("Category not found or unauthorized");
  }

  const nextName = name.trim();
  const existingIsTrip = isTripCategoryName(existingCategory.name);
  const nextIsTrip = isTripCategoryName(nextName);

  if (!nextName) {
    throw new Error("Category name is required");
  }

  if (existingIsTrip && existingCategory.name !== nextName) {
    throw new Error("Trip category names are fixed and cannot be changed.");
  }

  if (!existingIsTrip && nextIsTrip) {
    throw new Error("Trip category names are reserved.");
  }

  const category = await prisma.category.update({
    where: {
      id: categoryId,
    },
    data: {
      name: nextName,
      color,
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });

  return category;
}
