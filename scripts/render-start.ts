import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

type RuntimeEnvironment = NodeJS.ProcessEnv & {
  DATABASE_URL: string;
  GIT_REPOSITORIES_PATH: string;
};

function databaseFilePath(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith("file:")) {
    return null;
  }

  const rawPath = databaseUrl.slice("file:".length).split("?")[0];
  if (rawPath.length === 0) {
    throw new Error("DATABASE_URL must include a SQLite database path.");
  }

  const decodedPath = decodeURIComponent(rawPath);
  return path.isAbsolute(decodedPath)
    ? decodedPath
    : path.resolve(process.cwd(), decodedPath);
}

function runtimeEnvironment(): RuntimeEnvironment {
  const isProduction = process.env.NODE_ENV === "production";
  const databaseUrl =
    process.env.DATABASE_URL ?? (isProduction ? "" : "file:./dev.db");
  const repositoriesPath =
    process.env.GIT_REPOSITORIES_PATH ??
    (isProduction ? "" : path.join(process.cwd(), ".data", "repositories"));

  if (databaseUrl.length === 0 || repositoriesPath.length === 0) {
    throw new Error(
      "Render startup requires DATABASE_URL and GIT_REPOSITORIES_PATH in production.",
    );
  }

  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    GIT_REPOSITORIES_PATH: repositoriesPath,
  };
}

function run(command: string, args: string[], env: RuntimeEnvironment) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${path.basename(command)} exited with ${
            signal === null ? `code ${code ?? "unknown"}` : `signal ${signal}`
          }.`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const env = runtimeEnvironment();
  const sqlitePath = databaseFilePath(env.DATABASE_URL);

  if (sqlitePath !== null) {
    await mkdir(path.dirname(sqlitePath), { recursive: true });
  }
  await mkdir(path.resolve(env.GIT_REPOSITORIES_PATH), { recursive: true });

  const localBinary = (name: string) =>
    path.resolve(process.cwd(), "node_modules", ".bin", name);

  await run(localBinary("prisma"), ["migrate", "deploy"], env);
  await run(localBinary("tsx"), ["prisma/seed.ts"], env);
  await run(localBinary("next"), ["start"], env);
}

main().catch((error: unknown) => {
  console.error(
    "Render startup failed before the Next.js server became ready.",
    error,
  );
  process.exitCode = 1;
});
