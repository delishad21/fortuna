"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { compare, hash } from "bcryptjs";

export interface UserProfile {
  id: string;
  name: string | null;
  username: string;
  email: string | null;
  baseCurrency: string;
  autoLabelEnabled: boolean;
  autoLabelThreshold: number;
  analyticsExcludedCategoryIds: string[];
}

const parseCategoryIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

export async function getCurrentUser(): Promise<UserProfile | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      settings: {
        select: {
          currency: true,
          autoLabelEnabled: true,
          autoLabelThreshold: true,
          analyticsExcludedCategoryIds: true,
        },
      },
    },
  });
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    baseCurrency: user.settings?.currency || "SGD",
    autoLabelEnabled: user.settings?.autoLabelEnabled ?? false,
    autoLabelThreshold: Number(user.settings?.autoLabelThreshold ?? 0.5),
    analyticsExcludedCategoryIds: parseCategoryIdList(
      user.settings?.analyticsExcludedCategoryIds,
    ),
  };
}

export async function updateUserProfile(
  data: Pick<UserProfile, "name" | "username" | "email">,
): Promise<UserProfile> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const existingByUsername = await prisma.user.findFirst({
    where: {
      username: data.username,
      id: { not: session.user.id },
    },
    select: { id: true },
  });

  if (existingByUsername) {
    throw new Error("Username already in use");
  }

  if (data.email) {
    const existingByEmail = await prisma.user.findFirst({
      where: {
        email: data.email,
        id: { not: session.user.id },
      },
      select: { id: true },
    });

    if (existingByEmail) {
      throw new Error("Email already in use");
    }
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: data.name,
      username: data.username,
      email: data.email,
    },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      settings: {
        select: {
          currency: true,
          autoLabelEnabled: true,
          autoLabelThreshold: true,
          analyticsExcludedCategoryIds: true,
        },
      },
    },
  });
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    baseCurrency: user.settings?.currency || "SGD",
    autoLabelEnabled: user.settings?.autoLabelEnabled ?? false,
    autoLabelThreshold: Number(user.settings?.autoLabelThreshold ?? 0.5),
    analyticsExcludedCategoryIds: parseCategoryIdList(
      user.settings?.analyticsExcludedCategoryIds,
    ),
  };
}

export async function updateAutoLabelSettings(
  autoLabelEnabled: boolean,
  autoLabelThreshold: number,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const normalizedThreshold = Number(
    Math.min(1, Math.max(0, Number(autoLabelThreshold || 0.5))).toFixed(2),
  );

  const settings = await prisma.userSettings.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      autoLabelEnabled,
      autoLabelThreshold: normalizedThreshold,
    },
    update: {
      autoLabelEnabled,
      autoLabelThreshold: normalizedThreshold,
    },
    select: {
      autoLabelEnabled: true,
      autoLabelThreshold: true,
    },
  });

  return {
    autoLabelEnabled: settings.autoLabelEnabled,
    autoLabelThreshold: Number(settings.autoLabelThreshold),
  };
}

export async function updateAnalyticsExcludedCategories(categoryIds: string[]) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const validCategories = await prisma.category.findMany({
    where: {
      userId: session.user.id,
      id: { in: parseCategoryIdList(categoryIds) },
    },
    select: { id: true },
  });
  const analyticsExcludedCategoryIds = validCategories.map((category) => category.id);

  const settings = await prisma.userSettings.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      analyticsExcludedCategoryIds,
    },
    update: {
      analyticsExcludedCategoryIds,
    },
    select: {
      analyticsExcludedCategoryIds: true,
    },
  });

  return {
    analyticsExcludedCategoryIds: parseCategoryIdList(
      settings.analyticsExcludedCategoryIds,
    ),
  };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  });

  if (!user?.password) {
    throw new Error("Password not set");
  }

  const valid = await compare(currentPassword, user.password);
  if (!valid) {
    throw new Error("Current password is incorrect");
  }

  const hashed = await hash(newPassword, 12);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { password: hashed },
  });

  return { success: true };
}
