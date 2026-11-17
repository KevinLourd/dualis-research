/**
 * The console's connection string: DATABASE_URL. In production the console runs as a Node server next to the
 * database on the Dualis server (web/deploy/README.md), so it is a local connection.
 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see web/README.md)");
  return url;
}
