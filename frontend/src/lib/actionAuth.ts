import { auth as webAuth } from "@/lib/auth";
import { mobileSessionContext } from "@/lib/mobile/context";

export async function auth() {
  return mobileSessionContext.getStore() ?? (await webAuth());
}
