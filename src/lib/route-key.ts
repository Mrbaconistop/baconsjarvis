// Compute a stable "route key" from a pathname so customizations survive
// dynamic segments (e.g. /chat/abc-123 → "chat", /tabs/foo → "tabs/foo").
export function routeKeyFromPath(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "").replace(/^\/+/, "");
  if (!clean) return "index";
  const parts = clean.split("/");
  // Preserve custom tab slug so each custom tab can have its own overlay.
  if (parts[0] === "tabs" && parts[1]) return `tabs/${parts[1]}`;
  // Preserve top-level route only; drop dynamic ids.
  return parts[0];
}
