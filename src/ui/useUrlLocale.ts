"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { SupportedLocale } from "@/i18n/config";

export function useUrlLocale(fallback: SupportedLocale = "en") {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale: SupportedLocale = searchParams.get("locale") === "es" ? "es" : fallback;

  const hrefFor = (targetPath: string, candidate = locale) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("locale", candidate);
    return `${targetPath}?${params.toString()}`;
  };

  const setLocale = (candidate: SupportedLocale) => {
    router.replace(hrefFor(pathname, candidate));
  };

  return { locale, setLocale, hrefFor };
}
