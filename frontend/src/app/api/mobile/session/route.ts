import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  authenticateMobile,
  createMobileSession,
  mobileJson,
} from "@/lib/mobile/session";
export const runtime = "nodejs";
const attempts = new Map<string, { count: number; until: number }>();
const credentials = z.object({
  username: z.string().trim().min(3).max(100),
  password: z.string().min(6).max(200),
});
export async function POST(request: Request) {
  try {
    const input = credentials.parse(await request.json());
    const key = input.username.toLowerCase();
    const now = Date.now();
    for (const [id, item] of attempts)
      if (item.until < now) attempts.delete(id);
    const record = attempts.get(key) ?? { count: 0, until: now + 15 * 60000 };
    if (record.count >= 10)
      return mobileJson(
        { error: "Too many sign-in attempts. Try again in 15 minutes." },
        429,
      );
    record.count++;
    attempts.set(key, record);
    const user = await prisma.user.findUnique({
      where: { username: input.username },
    });
    if (!user?.password || !(await compare(input.password, user.password)))
      return mobileJson({ error: "Incorrect username or password" }, 401);
    attempts.delete(key);
    return mobileJson({
      ...(await createMobileSession(user.id)),
      user: { id: user.id, name: user.name },
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return mobileJson({ error: "Enter a valid username and password" }, 400);
    console.error("Mobile sign-in failed", error);
    return mobileJson(
      { error: "Sign-in is unavailable. Please try again." },
      503,
    );
  }
}
export async function DELETE(request: Request) {
  const identity = await authenticateMobile(request);
  if (!identity) return mobileJson({ error: "Session expired" }, 401);
  await prisma.apiToken.update({
    where: { id: identity.tokenId },
    data: { revokedAt: new Date() },
  });
  return mobileJson({ success: true });
}
