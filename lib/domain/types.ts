export const actorRoles = ["student", "reviewer", "admin"] as const;

export type ActorRole = (typeof actorRoles)[number];

export type Actor = {
  id: string;
  displayName: string;
  role: ActorRole;
  email?: string;
};

export type RepositoryPolicyRecord = {
  id: string;
  status: string;
  isPublic: boolean;
  isCanonicalSource: boolean;
  parentRepositoryId: string | null;
};

export type PullRequestPolicyRecord = {
  status: string;
  sourceBranchId: string;
  targetBranchId: string;
  reviewerId: string | null;
  hasConflicts: boolean;
};

export type CommitHashInput = {
  parentSha: string | null;
  authorName: string;
  entryType: string;
  title: string;
  content: string;
  sourceReference: string | null;
};

export type CommitProvenance = {
  kind: "filing" | "opinion" | "order" | "student-argument" | "other";
  url: string;
  citation: string;
  documentHash: string;
  attribution: string;
  isPublicRecord: boolean;
};

export type AppendCommitInput = {
  repositoryId: string;
  branchName: string;
  actor: Actor;
  parentSha: string | null;
  entryType: string;
  title: string;
  content: string;
  provenance: CommitProvenance | null;
  documentPath?: string;
  summary?: string;
  publishedAt?: Date;
};

export type CreateRepositoryInput = {
  slug: string;
  title: string;
  court: string;
  docketNumber: string;
  jurisdiction: string;
  actor: Actor;
  status?: string;
  isPublic?: boolean;
  isCanonicalSource?: boolean;
  sourceUrl?: string | null;
  sourceAttribution?: string | null;
};

export type CreateBranchInput = {
  repositoryId: string;
  name: string;
  actor: Actor;
  fromBranchName?: string;
  fromSha?: string | null;
  isProtected?: boolean;
};

export type ForkRepositoryInput = {
  sourceRepositoryId: string;
  slug: string;
  actor: Actor;
  title?: string;
  isPublic?: boolean;
  fromSha?: string | null;
};

export type AppendDocketEntryInput = {
  repositoryId: string;
  branchName: string;
  actor: Actor;
  entryType: string;
  title: string;
  sourceText: string;
  summary: string;
  publishedAt: Date;
  provenance: CommitProvenance;
  documentPath?: string;
};

export type MergeBranchInput = {
  repositoryId: string;
  targetBranchName: string;
  sourceBranchName: string;
  actor: Actor;
  expectedTargetHeadSha: string;
  message: string;
  provenance: CommitProvenance;
};

export type ReviewDecision = "approve" | "request_changes" | "comment";

export type CreatePullRequestInput = {
  repositoryId: string;
  sourceBranchName: string;
  targetBranchName: string;
  actor: Actor;
  reviewer?: Actor;
  title: string;
  description: string;
  provenance: CommitProvenance;
};

export type ReviewPullRequestInput = {
  pullRequestId: string;
  actor: Actor;
  decision: ReviewDecision;
  comment?: string;
};

export type MergePullRequestInput = {
  pullRequestId: string;
  actor: Actor;
};

export type CommitSummary = {
  id: string;
  sha: string;
  parentSha: string | null;
  parentShas: string[];
  authorName: string;
  entryType: string;
  title: string;
  content: string;
  documentPath: string | null;
  sourceReference: string | null;
  sourceUrl: string | null;
  sourceCitation: string | null;
  sourceDocumentHash: string | null;
  attribution: string;
  publishedAt: Date;
  createdAt: Date;
  docketLabel: string;
  aiSummary: string | null;
  aiKeyIssue: string | null;
  aiOutcome: string | null;
  aiSourceReferences: string[];
  aiSourceCommitSha: string | null;
  aiModel: string | null;
  aiPromptVersion: string | null;
  aiStatus: string | null;
  aiCitationWarnings: Array<{
    code: string;
    message: string;
  }>;
  aiError: string | null;
  aiGeneratedAt: Date | null;
};

export type PullRequestSummary = {
  id: string;
  repositoryId: string;
  sourceBranchName: string;
  targetBranchName: string;
  sourceHeadSha: string;
  targetHeadSha: string;
  title: string;
  description: string;
  status: string;
  hasConflicts: boolean;
  authorName: string;
  reviewerName: string | null;
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  sourceUrl: string | null;
  sourceCitation: string | null;
  sourceAttribution: string | null;
  citationCheck: {
    valid: boolean;
    issues: Array<{ code: string; message: string }>;
  };
  reviews: Array<{
    id: string;
    reviewerName: string;
    decision: string;
    comment: string | null;
    createdAt: Date;
  }>;
  diff: import("@/lib/git/diff").FileDiff[];
};

export type AuditEventSummary = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  actorName: string | null;
  createdAt: Date;
};

export type BlameSummaryLine = {
  lineNumber: number;
  text: string;
  commit: CommitSummary;
};
