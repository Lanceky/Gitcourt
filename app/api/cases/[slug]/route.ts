import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api-errors";
import { db } from "@/lib/db";
import { demoCase } from "@/lib/demo-case";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { importPublicCase } from "@/lib/import/public-case";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CaseRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, { params }: CaseRouteProps) {
  try {
    const { slug } = await params;
    if (slug !== demoCase.slug) {
      return NextResponse.json(
        {
          code: "REPOSITORY_NOT_FOUND",
          error: "The public case was not found.",
        },
        { status: 404 },
      );
    }

    const imported = await importPublicCase(db, demoCase);
    const history = await new CaseRepositoryService(db).getHistory(
      imported.repositoryId,
      "main",
    );

    return NextResponse.json({ history });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
