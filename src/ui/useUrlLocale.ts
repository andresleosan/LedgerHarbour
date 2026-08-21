"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { resolveLocale, withLocale } from "@/i18n/locale";
import type { SupportedLocale } from "@/i18n/config";

export function useUrlLocale(fallback: SupportedLocale = "en") {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = resolveLocale(searchParams.get("locale") ?? fallback);

  const hrefFor = (targetPath: string, candidate = locale) => {
    return withLocale(targetPath, searchParams, candidate);
  };

  const setLocale = (candidate: SupportedLocale) => {
    router.replace(hrefFor(pathname, candidate));
  };

  return { locale, setLocale, hrefFor };
}
