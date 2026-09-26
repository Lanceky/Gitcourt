export {};

async function verifyDeployment(): Promise<void> {
  const rawBaseUrl = process.argv[2] ?? process.env.DEPLOYMENT_URL;

  if (rawBaseUrl === undefined || rawBaseUrl.trim() === "") {
    throw new Error(
      "Provide a deployment URL: npm run verify:deployment -- https://your-project.vercel.app",
    );
  }

  const baseUrl = new URL(rawBaseUrl);
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";

  const checks = [
    { label: "home page", path: "/" },
    { label: "case page", path: "/cases/carpenter-v-united-states" },
    { label: "health endpoint", path: "/api/health" },
  ];

  for (const check of checks) {
    const url = new URL(check.path, baseUrl);
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
