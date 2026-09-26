import { PrismaClient } from "@prisma/client";

import { demoCase } from "../lib/demo-case";
import { importPublicCase } from "../lib/import/public-case";

const database = new PrismaClient();

async function main() {
  const result = await importPublicCase(database, demoCase);

  console.log(
    `Public case imported: ${result.slug} (${result.entriesImported} entries, head ${result.headSha?.slice(0, 7)})`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await database.$disconnect();
  });
