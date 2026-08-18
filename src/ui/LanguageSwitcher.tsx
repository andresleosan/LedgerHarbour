"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface LanguageSwitcherProps {
  locale: "en" | "es";
  labels?: {
    ariaLabel: string;
    english: string;
    spanish: string;
  };
}

export default function LanguageSwitcher({ locale, labels }: LanguageSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefFor = (candidate: "en" | "es") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("locale", candidate);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <nav className="language-switcher" aria-label={labels?.ariaLabel ?? (locale === "es" ? "Idioma" : "Language")}>
      <Link href={hrefFor("en")} aria-current={locale === "en" ? "page" : undefined}>
        {labels?.english ?? "English"}
      </Link>
      <Link href={hrefFor("es")} aria-current={locale === "es" ? "page" : undefined}>
        {labels?.spanish ?? "Español"}
      </Link>
    </nav>
  );
}
