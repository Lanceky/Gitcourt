import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError } from "@/lib/domain/errors";

const domainErrorStatuses: Partial<Record<DomainError["code"], number>> = {
  BRANCH_EXISTS: 409,
  CANONICAL_REPOSITORY_READ_ONLY: 409,
  COMMIT_NOT_FOUND: 404,
  GIT_REPOSITORY_NOT_FOUND: 404,
  INVALID_BRANCH_NAME: 400,
  INVALID_COMMIT_CONTENT: 400,
  INVALID_DOCUMENT_PATH: 400,
  INVALID_REVIEW_DECISION: 400,
  INVALID_REPOSITORY_SLUG: 400,
  MERGE_CONFLICT: 409,
  MERGE_FORBIDDEN: 403,
  PULL_REQUEST_EXISTS: 409,
  PULL_REQUEST_NOT_FOUND: 404,
  PULL_REQUEST_NOT_OPEN: 409,
  PULL_REQUEST_STALE: 409,
  PROVENANCE_NOT_PUBLIC: 422,
  PROVENANCE_REQUIRED: 422,
  PROVENANCE_URL_INVALID: 422,
  REPOSITORY_EXISTS: 409,
  REPOSITORY_NOT_FOUND: 404,
  REPOSITORY_NOT_PUBLIC: 403,
  REVIEW_FORBIDDEN: 403,
  REVIEW_REQUIRED: 409,
  STALE_BRANCH: 409,
};

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        code: "INVALID_REQUEST",
        error: "Please check the highlighted request fields.",
        fields: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  if (error instanceof DomainError) {
    return NextResponse.json(
      { code: error.code, error: error.message },
      { status: domainErrorStatuses[error.code] ?? 422 },
    );
  }

  console.error("Git Court API request failed.", error);
  return NextResponse.json(
    {
      code: "INTERNAL_ERROR",
      error: "The request could not be completed. Please try again.",
    },
    { status: 500 },
  );
}

export function invalidJsonResponse(): NextResponse {
  return NextResponse.json(
    {
      code: "INVALID_REQUEST",
      error: "Request body must be valid JSON.",
    },
    { status: 400 },
  );
}
