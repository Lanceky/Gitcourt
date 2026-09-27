export {};

async function verifyDeployment(): Promise<void> {
  const rawFrontendUrl = process.argv[2] ?? process.env.DEPLOYMENT_URL;
  const rawBackendUrl =
    process.argv[3] ?? process.env.BACKEND_URL ?? rawFrontendUrl;

  if (
    rawFrontendUrl === undefined ||
    rawFrontendUrl.trim() === "" ||
    rawBackendUrl === undefined ||
    rawBackendUrl.trim() === ""
  ) {
    throw new Error(
      "Provide frontend and backend URLs: npm run verify:deployment -- https://your-project.vercel.app https://gitcourt-backend.onrender.com",
    );
  }

  function normalizeBaseUrl(rawUrl: string): URL {
    const baseUrl = new URL(rawUrl);
    baseUrl.pathname = "/";
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl;
  }

  const frontendUrl = normalizeBaseUrl(rawFrontendUrl);
  const backendUrl = normalizeBaseUrl(rawBackendUrl);

  const checks = [
    { label: "frontend home page", baseUrl: frontendUrl, path: "/" },
    {
      label: "frontend case page",
      baseUrl: frontendUrl,
      path: "/cases/carpenter-v-united-states",
    },
    {
      label: "backend health endpoint",
      baseUrl: backendUrl,
      path: "/api/health",
    },
    {
      label: "backend case API",
      baseUrl: backendUrl,
      path: "/api/cases/carpenter-v-united-states",
    },
  ];

  for (const check of checks) {
    const url = new URL(check.path, check.baseUrl);
    const response = await fetch(url, {
      headers: { accept: "text/html,application/json" },
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error(`${check.label} returned HTTP ${response.status}.`);
    }

    if (check.path === "/api/health") {
      const payload: unknown = await response.json();
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("status" in payload) ||
        payload.status !== "ok"
      ) {
        throw new Error("Health endpoint did not return status=ok.");
      }
    }

    if (check.path.startsWith("/api/cases/")) {
      const payload: unknown = await response.json();
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("history" in payload) ||
        !Array.isArray(payload.history) ||
        payload.history.length === 0
      ) {
        throw new Error("Backend case API did not return public history.");
      }
    }

    console.log(`PASS ${check.label}: ${url}`);
  }
}

verifyDeployment().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `Deployment verification failed: ${error.message}`
      : "Deployment verification failed.",
  );
  process.exitCode = 1;
});
