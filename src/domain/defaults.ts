export const SEED_CONFIG = {
  id: 'app',
  maxChapters: 8,
  maxLessonsPerChapter: 4,
  quizQuestionCount: 5,
  quizPassPercent: 80,
  costRoadmap: 6,
  costLesson: 3,
  costQuiz: 1,
  signupCredits: 24,
  lessonMinuteLabel: 15,
} as const;

export const SEED_PACKS = [
  {
    id: 'pack_singkat',
    name: 'Singkat',
    credits: 30,
    priceIdr: 25000,
    active: 1,
    sort: 1,
  },
  {
    id: 'pack_rutin',
    name: 'Rutin',
    credits: 90,
    priceIdr: 65000,
    active: 1,
    sort: 2,
  },
  {
    id: 'pack_dalam',
    name: 'Dalam',
    credits: 240,
    priceIdr: 150000,
    active: 1,
    sort: 3,
  },
] as const;

export const SEED_PROVIDER_ID = 'provider_openai';

export const SEED_MODELS = [
  {
    id: 'model_roadmap',
    task: 'roadmap',
    maxOutputTokens: 2000,
    timeoutMs: 60000,
  },
  {
    id: 'model_lesson',
    task: 'lesson',
    maxOutputTokens: 2500,
    timeoutMs: 90000,
  },
  { id: 'model_quiz', task: 'quiz', maxOutputTokens: 1500, timeoutMs: 45000 },
] as const;

export const DEFAULT_MODEL_NAME = 'gpt-4.1-mini';

export const MAX_LESSON_CHARS = 100_000;
export const MAX_PROMPT_CHARS = 8_000;
export const QUIZ_SNIPPET_CHARS = 4_000;
export const MAX_WEB_SOURCES = 4;
export const MAX_YOUTUBE_SOURCES = 2;
export const JOB_LOCK_TTL_SECONDS = 15 * 60;
export const JOB_RATE_WINDOW_MS = 10 * 60 * 1000;
export const JOB_RATE_LIMIT = 5;
export const IP_GENERATE_LIMIT = 10;
export const IP_WEBHOOK_LIMIT = 60;
export const PAGE_LIMIT = 20;
export const PAGE_LIMIT_MAX = 50;
export const QUEUE_MAX_ATTEMPTS = 3;
