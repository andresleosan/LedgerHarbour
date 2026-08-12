"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type { BusinessSummary } from "@/modules/tenancy/portfolio-service";
import StatusBadge from "@/ui/StatusBadge";

interface BusinessSwitcherProps {
  businesses: readonly BusinessSummary[];
  locale: "en" | "es";
}

export default function BusinessSwitcher({ businesses, locale }: BusinessSwitcherProps) {
  const searchParams = useSearchParams();

  const hrefFor = (businessId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("locale", locale);
    return `/business/${businessId}?${params.toString()}`;
  };

  return (
    <section className="business-switcher" aria-labelledby="business-switcher-title">
      <p id="business-switcher-title" className="shell-label">
        {locale === "es" ? "Negocios autorizados" : "Authorized businesses"}
      </p>
      <div className="business-list">
        {businesses.map((business) => (
          <div className="business-option" key={business.id}>
            {business.isActive ? (
              <Link href={hrefFor(business.id)} aria-label={business.name}>
                <span className="business-option-name">{business.name}</span>
                <span className="business-option-meta">
                  {business.role.replace("_", " ")}
                  <StatusBadge label={locale === "es" ? "Activo" : "Active"} tone="active" />
                </span>
              </Link>
            ) : (
              <span className="business-option-disabled" aria-disabled="true">
                <span className="business-option-name">{business.name}</span>
                <span className="business-option-meta">
                  {business.role.replace("_", " ")}
                  <StatusBadge label={locale === "es" ? "Inactivo" : "Inactive"} tone="inactive" />
                </span>
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
