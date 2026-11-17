"use client";

import { UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";

/**
 * Clerk's avatar menu, drawn once the page has hydrated. The server renders nothing here; when clerk-js finished
 * loading before React hydrated (a race, about 1 load in 12 on the Node server), UserButton drew itself during
 * hydration and React logged #418. Mounting after hydration makes the first browser render match the server.
 */
export function UserMenu() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <UserButton /> : null;
}
