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
