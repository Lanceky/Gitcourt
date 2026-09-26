import { z } from "zod";

const publicHttpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Public case sources must use HTTPS URLs.",
  });

const publicDocketEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO calendar date."),
  type: z.string().trim().min(1),
  title: z.string().trim().min(1),
  sourceText: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  author: z.string().trim().min(1),
  sourceUrl: publicHttpsUrl,
  citation: z.string().trim().min(1),
  attribution: z.string().trim().min(1),
  isPublicRecord: z.literal(true),
});

const privateContactPatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/,
  /\b\d{1,6}\s+[A-Za-z0-9.-]+\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln)\b/i,
];

export const publicCaseFixtureSchema = z.object({
  id: z.string().trim().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  court: z.string().trim().min(1),
  docketNumber: z.string().trim().min(1),
  jurisdiction: z.string().trim().min(1),
  status: z.literal("public"),
  summary: z.string().trim().min(1),
  sourceUrl: publicHttpsUrl,
  sourceAttribution: z.string().trim().min(1),
  entries: z
    .array(publicDocketEntrySchema)
    .min(6)
    .max(12)
    .superRefine((entries, context) => {
      const seenEntries = new Set<string>();
      let previousDate = "";

      entries.forEach((entry, index) => {
        const identity = `${entry.date}\u0000${entry.type}\u0000${entry.title}\u0000${entry.sourceUrl}`;

        if (seenEntries.has(identity)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Docket entries must not be duplicated.",
            path: [index],
          });
        }
        seenEntries.add(identity);

        if (entry.date < previousDate) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Docket entries must be ordered by publication date.",
            path: [index, "date"],
          });
        }
        previousDate = entry.date;

        if (
          privateContactPatterns.some((pattern) =>
            pattern.test(entry.sourceText),
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Do not import personal contact details or street addresses into the public fixture.",
            path: [index, "sourceText"],
          });
        }
      });
    }),
});

export type PublicCaseFixture = z.infer<typeof publicCaseFixtureSchema>;
export type PublicDocketEntry = PublicCaseFixture["entries"][number];
