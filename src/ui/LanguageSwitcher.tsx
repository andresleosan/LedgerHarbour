"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface LanguageSwitcherProps {
  locale: "en" | "es";
}

export default function LanguageSwitcher({ locale }: LanguageSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefFor = (candidate: "en" | "es") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("locale", candidate);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <nav className="language-switcher" aria-label={locale === "es" ? "Idioma" : "Language"}>
      <span>{locale === "es" ? "Idioma" : "Language"}</span>
      <Link href={hrefFor("en")} aria-current={locale === "en" ? "page" : undefined}>
        English
      </Link>
      <Link href={hrefFor("es")} aria-current={locale === "es" ? "page" : undefined}>
        Español
      </Link>
    </nav>
  );
}
