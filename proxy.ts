import { NextRequest, NextResponse } from "next/server";

const localOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
]);

function allowedOrigins(): Set<string> {
  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return new Set(
    configuredOrigins.length > 0 ? configuredOrigins : localOrigins,
  );
}

function withCorsHeaders(
  response: NextResponse,
  origin: string | null,
): NextResponse {
  if (origin !== null) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Max-Age", "600");
  response.headers.append("Vary", "Origin");
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const requestOrigin = request.headers.get("origin");
  const isAllowed =
    requestOrigin === null || allowedOrigins().has(requestOrigin);

  if (request.method === "OPTIONS") {
    if (!isAllowed) {
      return new NextResponse(null, { status: 403 });
    }

    return withCorsHeaders(
      new NextResponse(null, { status: 204 }),
      requestOrigin,
    );
  }

  const response = NextResponse.next();
  return isAllowed ? withCorsHeaders(response, requestOrigin) : response;
}

export const config = {
  matcher: ["/api/:path*"],
};
