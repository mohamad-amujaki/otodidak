import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    clerkUserId: text('clerk_user_id').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['learner', 'admin'] }).notNull(),
    status: text('status', { enum: ['active', 'suspended'] }).notNull(),
    streakEnabled: integer('streak_enabled').notNull().default(1),
    streakCount: integer('streak_count').notNull().default(0),
    streakLastDate: text('streak_last_date'),
    streakFreezeWeek: text('streak_freeze_week'),
    deletionRequestedAt: text('deletion_requested_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('user_clerk_user_id').on(table.clerkUserId),
    uniqueIndex('user_email_lower').on(sql`lower(${table.email})`),
  ],
);

export const shareLinks = sqliteTable(
  'share_link',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    scope: text('scope', { enum: ['lesson', 'path'] }).notNull(),
    targetId: text('target_id').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
    views: integer('views').notNull().default(0),
    lastViewedAt: text('last_viewed_at'),
  },
  (table) => [
    uniqueIndex('share_link_token').on(table.token),
    index('share_link_owner').on(table.ownerId, table.scope, table.targetId),
  ],
);

export const creditLedger = sqliteTable(
  'credit_ledger',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(),
    reason: text('reason', {
      enum: [
        'signup_grant',
        'purchase',
        'roadmap',
        'lesson',
        'quiz',
        'outline',
        'refund',
        'admin_adjust',
        'redeem',
      ],
    }).notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    note: text('note'),
    category: text('category'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('credit_ledger_user_created').on(table.userId, table.createdAt),
    uniqueIndex('credit_ledger_idempotency').on(table.idempotencyKey),
  ],
);

export const creditRedeemCodes = sqliteTable(
  'credit_redeem_code',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    credits: integer('credits').notNull(),
    maxRedemptions: integer('max_redemptions').notNull().default(1),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    active: integer('active').notNull().default(1),
    expiresAt: text('expires_at'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by'),
  },
  (table) => [uniqueIndex('credit_redeem_code_code').on(table.code)],
);

export const creditRedeemRedemptions = sqliteTable(
  'credit_redeem_redemption',
  {
    id: text('id').primaryKey(),
    codeId: text('code_id')
      .notNull()
      .references(() => creditRedeemCodes.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    credits: integer('credits').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('credit_redeem_redemption_code_user').on(
      table.codeId,
      table.userId,
    ),
  ],
);

export const creditPacks = sqliteTable('credit_pack', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  credits: integer('credits').notNull(),
  priceIdr: integer('price_idr').notNull(),
  active: integer('active').notNull(),
  sort: integer('sort').notNull(),
});

export const creditOrders = sqliteTable(
  'credit_order',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    packId: text('pack_id').notNull(),
    orderId: text('order_id').notNull(),
    amountIdr: integer('amount_idr').notNull(),
    credits: integer('credits').notNull(),
    status: text('status', {
      enum: ['pending', 'paid', 'failed', 'expired'],
    }).notNull(),
    sumopodPaymentId: text('sumopod_payment_id'),
    paymentLinkUrl: text('payment_link_url'),
    paymentCode: text('payment_code'),
    createdAt: text('created_at').notNull(),
    paidAt: text('paid_at'),
  },
  (table) => [
    uniqueIndex('credit_order_order_id').on(table.orderId),
    uniqueIndex('credit_order_one_pending')
      .on(table.userId)
      .where(sql`status = 'pending'`),
  ],
);

export const paymentEvents = sqliteTable('payment_event', {
  svixId: text('svix_id').primaryKey(),
  orderId: text('order_id'),
  eventType: text('event_type').notNull(),
  paymentId: text('payment_id'),
  createdAt: text('created_at').notNull(),
});

export const paths = sqliteTable(
  'path',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    topic: text('topic').notNull(),
    status: text('status', { enum: ['draft', 'ready', 'archived'] }).notNull(),
    isActive: integer('is_active').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('path_user_active').on(table.userId, table.isActive),
    uniqueIndex('path_one_active').on(table.userId).where(sql`is_active = 1`),
  ],
);

export const chapters = sqliteTable(
  'chapter',
  {
    id: text('id').primaryKey(),
    pathId: text('path_id')
      .notNull()
      .references(() => paths.id),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    quizStatus: text('quiz_status', {
      enum: ['unchecked', 'retry', 'understood'],
    }).notNull(),
    caseJson: text('case_json'),
  },
  (table) => [index('chapter_path_position').on(table.pathId, table.position)],
);

export const lessons = sqliteTable(
  'lesson',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    objective: text('objective').notNull(),
    body: text('body'),
    status: text('status', {
      enum: ['outline', 'queued', 'ready', 'failed'],
    }).notNull(),
    completedAt: text('completed_at'),
    adds: text('adds'),
    conceptsJson: text('concepts_json'),
    diagramsJson: text('diagrams_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('lesson_chapter_position').on(table.chapterId, table.position),
  ],
);

export const lessonSources = sqliteTable('lesson_source', {
  id: text('id').primaryKey(),
  lessonId: text('lesson_id')
    .notNull()
    .references(() => lessons.id),
  kind: text('kind', { enum: ['web', 'youtube'] }).notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
});

export const lessonClaims = sqliteTable('lesson_claim', {
  id: text('id').primaryKey(),
  lessonId: text('lesson_id')
    .notNull()
    .references(() => lessons.id),
  quote: text('quote').notNull(),
  unsourced: integer('unsourced').notNull(),
  sourceId: text('source_id'),
});

export const quizzes = sqliteTable('quiz', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id')
    .notNull()
    .references(() => chapters.id),
  createdAt: text('created_at').notNull(),
});

export const quizQuestions = sqliteTable('quiz_question', {
  id: text('id').primaryKey(),
  quizId: text('quiz_id')
    .notNull()
    .references(() => quizzes.id),
  position: integer('position').notNull(),
  stem: text('stem').notNull(),
  choicesJson: text('choices_json').notNull(),
  correctIndex: integer('correct_index').notNull(),
  explanation: text('explanation').notNull(),
});

export const quizAttempts = sqliteTable('quiz_attempt', {
  id: text('id').primaryKey(),
  quizId: text('quiz_id')
    .notNull()
    .references(() => quizzes.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  scorePercent: integer('score_percent').notNull(),
  answersJson: text('answers_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const generationJobs = sqliteTable(
  'generation_job',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ['roadmap', 'lesson', 'quiz'] }).notNull(),
    refId: text('ref_id').notNull(),
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'failed'],
    }).notNull(),
    errorCode: text('error_code'),
    attempts: integer('attempts').notNull().default(0),
    promptVersion: integer('prompt_version'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('generation_job_user_status').on(table.userId, table.status),
    index('generation_job_ref_kind').on(table.refId, table.kind),
    uniqueIndex('generation_job_one_active')
      .on(table.userId)
      .where(sql`status in ('queued', 'running')`),
  ],
);

export const aiProviders = sqliteTable('ai_provider', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  authKind: text('auth_kind', {
    enum: ['bearer', 'workers_ai_binding'],
  }).notNull(),
  secretName: text('secret_name'),
  active: integer('active').notNull(),
});

export const aiModels = sqliteTable('ai_model', {
  id: text('id').primaryKey(),
  providerId: text('provider_id')
    .notNull()
    .references(() => aiProviders.id),
  modelName: text('model_name').notNull(),
  task: text('task', { enum: ['roadmap', 'lesson', 'quiz'] }).notNull(),
  active: integer('active').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  timeoutMs: integer('timeout_ms').notNull(),
});

export const promptTemplates = sqliteTable('prompt_template', {
  task: text('task', { enum: ['roadmap', 'lesson', 'quiz'] }).primaryKey(),
  body: text('body').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by'),
});

export const promptVersions = sqliteTable(
  'prompt_version',
  {
    id: text('id').primaryKey(),
    task: text('task', { enum: ['roadmap', 'lesson', 'quiz'] }).notNull(),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by'),
  },
  (table) => [index('prompt_version_task').on(table.task, table.version)],
);

export const appConfig = sqliteTable('app_config', {
  id: text('id').primaryKey(),
  maxChapters: integer('max_chapters').notNull(),
  maxLessonsPerChapter: integer('max_lessons_per_chapter').notNull(),
  quizQuestionCount: integer('quiz_question_count').notNull(),
  quizPassPercent: integer('quiz_pass_percent').notNull(),
  costRoadmap: integer('cost_roadmap').notNull(),
  costLesson: integer('cost_lesson').notNull(),
  costQuiz: integer('cost_quiz').notNull(),
  signupCredits: integer('signup_credits').notNull(),
  lessonMinuteLabel: integer('lesson_minute_label').notNull(),
  adminDailyCreditCap: integer('admin_daily_credit_cap')
    .notNull()
    .default(1000),
});

export const sourceProviders = sqliteTable('source_provider', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['web', 'youtube'] }).notNull(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  secretName: text('secret_name').notNull(),
  active: integer('active').notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type AppConfigRow = typeof appConfig.$inferSelect;
export type GenerationKind = 'roadmap' | 'lesson' | 'quiz';
export type LessonStatus = 'outline' | 'queued' | 'ready' | 'failed';
export type QuizStatus = 'unchecked' | 'retry' | 'understood';
