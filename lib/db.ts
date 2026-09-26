import { PrismaClient } from "@prisma/client";

const globalForDatabase = globalThis as unknown as {
  gitCourtDatabase?: PrismaClient;
};

export const db =
  globalForDatabase.gitCourtDatabase ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.gitCourtDatabase = db;
}
