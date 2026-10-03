-- AlterEnum
ALTER TYPE "StepPhase" ADD VALUE 'chat';

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "parentGoalId" TEXT;

-- CreateTable
CREATE TABLE "GoalMessage" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'complete',
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoalMessage_goalId_userId_createdAt_idx" ON "GoalMessage"("goalId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalMessage" ADD CONSTRAINT "GoalMessage_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
