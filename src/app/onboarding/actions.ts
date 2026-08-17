"use server";

import { redirect } from "next/navigation";

import { clearCurrentIdentity } from "@/modules/auth/session";

export async function signOutAction(): Promise<never> {
  await clearCurrentIdentity();
  redirect("/login");
}
