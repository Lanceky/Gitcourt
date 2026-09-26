export const actorRoles = ["student", "reviewer", "admin"] as const;

export type ActorRole = (typeof actorRoles)[number];

export type Actor = {
  id: string;
  displayName: string;
  role: ActorRole;
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
};
