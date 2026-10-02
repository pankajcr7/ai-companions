-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('planning', 'awaiting_approval', 'running', 'reviewing', 'done', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'running', 'done', 'failed', 'skipped', 'interrupted');

-- CreateEnum
CREATE TYPE "EditStatus" AS ENUM ('pending', 'applied', 'rejected', 'stale');

-- CreateEnum
CREATE TYPE "TaskVerdict" AS ENUM ('meets', 'needs_eyes');

-- CreateEnum
CREATE TYPE "StepPhase" AS ENUM ('plan', 'select', 'execute', 'summary', 'project_summary');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "summarizedAt" TIMESTAMP(3),
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryRevisionKey" TEXT;

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "text" TEXT NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'planning',
    "summary" TEXT,
    "error" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalTask" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "deliverable" TEXT NOT NULL,
    "criteria" TEXT[],
    "dependsOn" INTEGER[],
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "filesRead" JSONB NOT NULL DEFAULT '[]',
    "contextRevisions" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "errorCode" TEXT,
    "verdict" "TaskVerdict",
    "verdictNote" TEXT,
    "rating" INTEGER,
    "ratingReason" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposedEdit" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "EditStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposedEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalStep" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT,
    "taskId" TEXT,
    "phase" "StepPhase" NOT NULL,
    "agentId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "ms" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_workspaceId_createdAt_idx" ON "Goal"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoalTask_goalId_position_key" ON "GoalTask"("goalId", "position");

-- CreateIndex
CREATE INDEX "ProposedEdit_goalId_idx" ON "ProposedEdit"("goalId");

-- CreateIndex
CREATE INDEX "GoalStep_goalId_idx" ON "GoalStep"("goalId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalTask" ADD CONSTRAINT "GoalTask_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalTask" ADD CONSTRAINT "GoalTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedEdit" ADD CONSTRAINT "ProposedEdit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "GoalTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedEdit" ADD CONSTRAINT "ProposedEdit_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
