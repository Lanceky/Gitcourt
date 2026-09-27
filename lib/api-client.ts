const configuredApiBaseUrl = (() => {
  const rawValue = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

  if (rawValue === "") {
    return "";
  }

  const parsedUrl = new URL(rawValue);
  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== ""
  ) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL must be an HTTP(S) origin without a path.",
    );
  }

  return parsedUrl.origin;
})();

export function apiUrl(pathname: string): string {
  if (!pathname.startsWith("/")) {
    throw new Error("API paths must start with '/'.");
  }

  return configuredApiBaseUrl === ""
    ? pathname
    : `${configuredApiBaseUrl}${pathname}`;
}

export function usesExternalApi(): boolean {
  return configuredApiBaseUrl !== "";
}
