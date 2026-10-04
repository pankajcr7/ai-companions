-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "toolUses" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "GoalTask" ADD COLUMN     "toolUses" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ChatEdit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "EditStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'tavily',
    "secret" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatEdit_messageId_idx" ON "ChatEdit"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchKey_workspaceId_key" ON "SearchKey"("workspaceId");

-- AddForeignKey
ALTER TABLE "ChatEdit" ADD CONSTRAINT "ChatEdit_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatEdit" ADD CONSTRAINT "ChatEdit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchKey" ADD CONSTRAINT "SearchKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
