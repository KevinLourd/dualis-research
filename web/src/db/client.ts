import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { cache } from "react";
import type { Db } from "./types";
import { requestDatabaseUrl } from "./url";

/** Database for the web app, one per request (Workers forbid sharing a socket across requests). */
export const getDb = cache((): Db => drizzle(postgres(requestDatabaseUrl(), { max: 1, fetch_types: false })));
