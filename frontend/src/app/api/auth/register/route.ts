import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://data-service:4001";

const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  baseCurrency: z
    .string()
    .length(3, "Base currency must be a 3-letter ISO code")
    .optional()
    .default("SGD")
    .transform((value) => value.toUpperCase()),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, username, password, baseCurrency } = registerSchema.parse(body);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 400 },
      );
    }

    // Hash password
    const hashedPassword = await hash(password, 12);

    // Create user with default settings and categories
    const user = await prisma.user.create({
      data: {
        name,
        username,
        password: hashedPassword,
        settings: {
          create: {
            theme: "light",
            currency: baseCurrency,
            autoLabelEnabled: false,
            autoLabelThreshold: 0.5,
            dateFormat: "MM/dd/yyyy",
            defaultTimeframe: "month",
          },
        },
        categories: {
          create: [
            {
              name: "Groceries",
              color: "#4caf50",
              icon: "shopping-cart",
              isDefault: true,
            },
            {
              name: "Dining",
              color: "#ff9800",
              icon: "utensils",
              isDefault: true,
            },
            {
              name: "Transportation",
              color: "#2196f3",
              icon: "bus",
              isDefault: true,
            },
            {
              name: "Utilities",
              color: "#9c27b0",
              icon: "zap",
              isDefault: true,
            },
            {
              name: "Entertainment",
              color: "#e91e63",
              icon: "film",
              isDefault: true,
            },
            {
              name: "Shopping",
              color: "#f44336",
              icon: "shopping-bag",
              isDefault: true,
            },
            {
              name: "Health",
              color: "#00bcd4",
              icon: "heart-pulse",
              isDefault: true,
            },
            {
              name: "Income",
              color: "#8bc34a",
              icon: "banknote",
              isDefault: true,
            },
            {
              name: "Transfers",
              color: "#607d8b",
              icon: "arrow-right-left",
              isDefault: true,
            },
            {
              name: "Other",
              color: "#9e9e9e",
              icon: "shapes",
              isDefault: true,
            },
            {
              name: "Uncategorized",
              color: "#9ca3af",
              icon: "tag",
              isDefault: true,
            },
            {
              name: "Internal",
              color: "#9ca3af",
              icon: "arrow-right-left",
              isDefault: false,
            },
            {
              name: "Reimbursement",
              color: "#22c55e",
              icon: "receipt",
              isDefault: false,
            },
          ],
        },
      },
    });

    // Seed default import rules in data-service (idempotent)
    try {
      await fetch(`${DATA_SERVICE_URL}/api/transactions/import-rules/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: user.id }),
        cache: "no-store",
      });
    } catch (seedError) {
      console.error("Failed to bootstrap import rules:", seedError);
    }

    return NextResponse.json(
      { message: "User created successfully", userId: user.id },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 },
      );
    }

    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
