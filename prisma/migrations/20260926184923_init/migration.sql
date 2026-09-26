-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CaseRepository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "court" TEXT NOT NULL,
    "docketNumber" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'public',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isCanonicalSource" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "sourceAttribution" TEXT,
    "parentRepositoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CaseRepository_parentRepositoryId_fkey" FOREIGN KEY ("parentRepositoryId") REFERENCES "CaseRepository" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocketCommit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "parentSha" TEXT,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "documentPath" TEXT,
    "sourceReference" TEXT,
    "sourceUrl" TEXT,
    "attribution" TEXT NOT NULL DEFAULT 'Public source',
    "parentShas" TEXT,
    "aiSummary" TEXT,
    "aiKeyIssue" TEXT,
    "aiOutcome" TEXT,
    "aiSourceReferences" TEXT,
    "aiSourceCommitSha" TEXT,
    "aiModel" TEXT,
    "aiPromptVersion" TEXT,
    "aiStatus" TEXT NOT NULL DEFAULT 'manual-fallback',
    "aiCitationWarnings" TEXT,
    "aiError" TEXT,
    "aiGeneratedAt" DATETIME,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocketCommit_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CaseRepository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocketCommit_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "headCommitId" TEXT,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Branch_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CaseRepository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Branch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Branch_headCommitId_fkey" FOREIGN KEY ("headCommitId") REFERENCES "DocketCommit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryId" TEXT NOT NULL,
    "sourceBranchId" TEXT NOT NULL,
    "targetBranchId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "mergeCommitId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "sourceHeadSha" TEXT NOT NULL,
    "targetHeadSha" TEXT NOT NULL,
    "hasConflicts" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "sourceCitation" TEXT,
    "sourceDocumentHash" TEXT,
    "sourceAttribution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mergedAt" DATETIME,
    CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CaseRepository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PullRequest_sourceBranchId_fkey" FOREIGN KEY ("sourceBranchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PullRequest_targetBranchId_fkey" FOREIGN KEY ("targetBranchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PullRequest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PullRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PullRequest_mergeCommitId_fkey" FOREIGN KEY ("mergeCommitId") REFERENCES "DocketCommit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pullRequestId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryId" TEXT NOT NULL,
    "commitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "citation" TEXT,
    "documentHash" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceRecord_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CaseRepository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SourceRecord_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "DocketCommit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CaseRepository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CaseRepository_slug_key" ON "CaseRepository"("slug");

-- CreateIndex
CREATE INDEX "CaseRepository_parentRepositoryId_idx" ON "CaseRepository"("parentRepositoryId");

-- CreateIndex
CREATE INDEX "CaseRepository_status_idx" ON "CaseRepository"("status");

-- CreateIndex
CREATE INDEX "DocketCommit_repositoryId_createdAt_idx" ON "DocketCommit"("repositoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocketCommit_repositoryId_sha_key" ON "DocketCommit"("repositoryId", "sha");

-- CreateIndex
CREATE INDEX "Branch_ownerId_idx" ON "Branch"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_repositoryId_name_key" ON "Branch"("repositoryId", "name");

-- CreateIndex
CREATE INDEX "PullRequest_repositoryId_status_idx" ON "PullRequest"("repositoryId", "status");

-- CreateIndex
CREATE INDEX "PullRequest_reviewerId_idx" ON "PullRequest"("reviewerId");

-- CreateIndex
CREATE INDEX "Review_pullRequestId_createdAt_idx" ON "Review"("pullRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceRecord_repositoryId_idx" ON "SourceRecord"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRecord_commitId_url_key" ON "SourceRecord"("commitId", "url");

-- CreateIndex
CREATE INDEX "AuditEvent_repositoryId_createdAt_idx" ON "AuditEvent"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
