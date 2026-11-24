"use client";

import { RouteError } from "@/ui/RouteStates";

export default function RouteErrorPage({ reset }: { reset: () => void }) {
  return <RouteError reset={reset} />;
}
