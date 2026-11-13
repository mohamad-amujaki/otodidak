import { z } from 'zod';
import { MAX_PROMPT_CHARS } from './defaults';

const topic = z.string().trim().min(1).max(280);
const title = z.string().trim().min(1).max(160);
const summary = z.string().trim().min(1).max(600);
const objective = z.string().trim().min(1).max(400);

export const topicSchema = z.strictObject({ topic });

export const lessonOutlineSchema = z.strictObject({
  id: z.uuid().optional(),
  title,
  objective,
});

export const chapterOutlineSchema = z.strictObject({
  id: z.uuid().optional(),
  title,
  summary,
  lessons: z.array(lessonOutlineSchema).min(1).max(12),
});

export const pathOutlineSchema = z.strictObject({
  title,
  chapters: z.array(chapterOutlineSchema).min(1).max(20),
});

export const attemptSchema = z.strictObject({
  answers: z.array(z.number().int().min(0).max(3)).min(1).max(10),
});

export const packOrderSchema = z.strictObject({
  packId: z.string().trim().min(1).max(64),
});

export const streakSchema = z.strictObject({ enabled: z.boolean() });

export const devSessionSchema = z.strictObject({
  email: z.email(),
  name: z.string().trim().min(1).max(120),
});

export const pageSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  email: z.email().optional(),
  userId: z.uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

const ledgerReason = z.enum([
  'signup_grant',
  'purchase',
  'roadmap',
  'lesson',
  'quiz',
  'outline',
  'refund',
  'admin_adjust',
  'usage',
]);

const orderStatus = z.enum(['pending', 'paid', 'failed', 'expired']);

const emptyToUndefined = (value: unknown) =>
  value === '' || value === undefined ? undefined : value;

const adminUserRole = z.enum(['learner', 'admin']);
const adminUserStatus = z.enum(['active', 'suspended']);
const adminJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed']);
const adminJobKind = z.enum(['roadmap', 'lesson', 'quiz']);

export const adminPageSchema = pageSchema.extend({
  role: z.preprocess(emptyToUndefined, adminUserRole.optional()),
  status: z.preprocess(emptyToUndefined, adminUserStatus.optional()),
  orderStatus: z.preprocess(emptyToUndefined, orderStatus.optional()),
  jobStatus: z.preprocess(emptyToUndefined, adminJobStatus.optional()),
  jobKind: z.preprocess(emptyToUndefined, adminJobKind.optional()),
  deletion: z
    .union([z.literal('1'), z.literal('true'), z.literal('')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const creditsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(0).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  ordersLimit: z.coerce.number().int().min(0).max(50).default(20),
  ordersOffset: z.coerce.number().int().min(0).max(10_000).default(0),
  reason: z.preprocess(emptyToUndefined, ledgerReason.optional()),
  status: z.preprocess(emptyToUndefined, orderStatus.optional()),
  includePending: z
    .union([z.literal('1'), z.literal('true'), z.literal('')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const adminUserSchema = z
  .strictObject({
    role: z.enum(['learner', 'admin']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: 'Pilih peran atau status.',
  });

export const adminAdjustCategoryValues = [
  'bonus',
  'kompensasi',
  'dukungan',
  'uji',
  'koreksi',
] as const;

export type AdminAdjustCategory = (typeof adminAdjustCategoryValues)[number];

export const adminAdjustSchema = z.strictObject({
  amount: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, 'Jumlah tidak boleh nol.'),
  note: z.string().trim().min(3).max(500),
  category: z.enum(adminAdjustCategoryValues).optional(),
  nonce: z.string().trim().min(8).max(64).optional(),
});

export const adminBulkAdjustSchema = z.strictObject({
  userIds: z.array(z.string().trim().min(1)).min(1).max(50),
  amount: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, 'Jumlah tidak boleh nol.'),
  note: z.string().trim().min(3).max(500),
  category: z.enum(adminAdjustCategoryValues).optional(),
  nonce: z.string().trim().min(8).max(64).optional(),
});

export const configSchema = z.strictObject({
  maxChapters: z.number().int().min(1).max(20),
  maxLessonsPerChapter: z.number().int().min(1).max(12),
  quizQuestionCount: z.number().int().min(1).max(10),
  quizPassPercent: z.number().int().min(1).max(100),
  costRoadmap: z.number().int().min(0).max(100),
  costLesson: z.number().int().min(0).max(100),
  costQuiz: z.number().int().min(0).max(100),
  signupCredits: z.number().int().min(0).max(1000),
  lessonMinuteLabel: z.number().int().min(1).max(60),
  adminDailyCreditCap: z.number().int().min(0).max(100000),
});

export const promptSchema = z.strictObject({
  body: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
});

export const modelSchema = z.strictObject({
  modelName: z.string().trim().min(1).max(120),
  maxOutputTokens: z.number().int().min(100).max(8000),
  timeoutMs: z.number().int().min(1000).max(120_000),
  baseUrl: z.url().optional(),
  secretName: z
    .string()
    .regex(/^[A-Z0-9_]+$/)
    .nullable()
    .optional(),
  authKind: z.enum(['bearer', 'workers_ai_binding']).optional(),
});

export const packInputSchema = z.strictObject({
  id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(40),
  credits: z.number().int().min(1).max(100_000),
  priceIdr: z.number().int().min(1).max(100_000_000),
  active: z.boolean(),
  sort: z.number().int().min(0).max(100),
});

export const packsSchema = z.strictObject({
  packs: z.array(packInputSchema).min(1).max(12),
});

export const roadmapOutputSchema = z.strictObject({
  title,
  chapters: z
    .array(
      z.strictObject({
        title,
        summary,
        lessons: z.array(z.strictObject({ title, objective })).min(1),
      }),
    )
    .min(1),
});

export const outlineLessonOutputSchema = z.strictObject({
  title,
  objective,
});

const lessonSourceKind = z.enum([
  'article',
  'video',
  'documentation',
  'course',
  'paper',
  'book',
  'other',
]);

export const lessonOutputSchema = z.strictObject({
  markdown: z.string().trim().min(1).max(100_000),
  sources: z
    .array(
      z.strictObject({
        id: z.string().trim().min(1).max(64),
        url: z.url().max(2048),
        title: z.string().trim().min(1).max(180),
        publisher: z.string().trim().max(120).optional(),
        kind: lessonSourceKind,
      }),
    )
    .max(6)
    .default([]),
});

export const quizOutputSchema = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        stem: z.string().trim().min(1).max(400),
        choices: z.tuple([
          z.string().trim().min(1).max(200),
          z.string().trim().min(1).max(200),
          z.string().trim().min(1).max(200),
          z.string().trim().min(1).max(200),
        ]),
        correct_index: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(1).max(300),
      }),
    )
    .min(1),
});

export const sumopodPaymentSchema = z
  .object({
    payment_id: z.string().min(1),
    payment_link_url: z.url(),
    payment_code: z.string().min(1).optional(),
    order_id: z.string().optional(),
    amount: z.number().optional(),
    status: z.string().optional(),
  })
  .strip();

export const webhookSchema = z.strictObject({
  event_type: z.enum([
    'payment.completed',
    'payment.failed',
    'payment.expired',
  ]),
  data: z.strictObject({
    payment_id: z.string().min(1),
    order_id: z.string().min(1),
    amount: z.number().int().nonnegative(),
    fee: z.number().int().nonnegative().optional(),
    net_amount: z.number().int().nonnegative().optional(),
    status: z.string().min(1).optional(),
    paid_at: z.string().nullable().optional(),
    settled_at: z.string().nullable().optional(),
    payment_method: z.string().optional(),
    completed_at: z.string().nullable().optional(),
  }),
});

export const taskSchema = z.enum(['roadmap', 'lesson', 'quiz']);

export type RoadmapOutput = z.infer<typeof roadmapOutputSchema>;
export type OutlineLessonOutput = z.infer<typeof outlineLessonOutputSchema>;
export type LessonOutput = z.infer<typeof lessonOutputSchema>;
export type QuizOutput = z.infer<typeof quizOutputSchema>;
export type WebhookEvent = z.infer<typeof webhookSchema>;
export type TaskName = z.infer<typeof taskSchema>;
