import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse } from "@/lib/api-errors";
import {
  repositoryFilePathSchema,
  repositoryIdParamsSchema,
  repositoryRefSchema,
} from "@/lib/api-validation";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const blameQuerySchema = z.object({
  ref: repositoryRefSchema,
  filepath: repositoryFilePathSchema,
});

type BlameRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function GET(request: Request, { params }: BlameRouteProps) {
  try {
    const { repositoryId } = repositoryIdParamsSchema.parse(await params);
    const url = new URL(request.url);
    const input = blameQuerySchema.parse({
      ref: url.searchParams.get("ref"),
      filepath: url.searchParams.get("filepath"),
    });
    const service = new CaseRepositoryService(db);
    const lines = await service.getBlameDetails(
      repositoryId,
      input.ref,
      input.filepath,
    );
    return NextResponse.json({ lines });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
