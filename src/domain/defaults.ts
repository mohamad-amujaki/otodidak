/** Berapa percobaan kuis terakhir yang dikirim ke UI. */
export const MAX_QUIZ_ATTEMPT_HISTORY = 5;

export const SEED_CONFIG = {
  id: 'app',
  maxChapters: 5,
  maxLessonsPerChapter: 4,
  quizQuestionCount: 5,
  quizPassPercent: 80,
  costRoadmap: 6,
  costLesson: 3,
  costQuiz: 1,
  signupCredits: 24,
  lessonMinuteLabel: 15,
  adminDailyCreditCap: 1000,
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

/** OpenAI-compatible chat/completions; dipakai oleh `completeJson`. */
export const DEFAULT_AI_BASE_URL = 'https://ai.sumopod.com/v1';

export const SEED_MODELS = [
  {
    id: 'model_roadmap',
    task: 'roadmap',
    maxOutputTokens: 4096,
    timeoutMs: 120000,
  },
  {
    id: 'model_lesson',
    task: 'lesson',
    maxOutputTokens: 4096,
    timeoutMs: 120000,
  },
  { id: 'model_quiz', task: 'quiz', maxOutputTokens: 2048, timeoutMs: 90000 },
] as const;

export const DEFAULT_MODEL_NAME = 'deepseek-v4.1-flash-1017';

export const MAX_LESSON_CHARS = 100_000;
export const MAX_PROMPT_CHARS = 8_000;
export const QUIZ_SNIPPET_CHARS = 4_000;
export const MAX_LESSON_SOURCES = 5;
export const MAX_YOUTUBE_SOURCES = 2;
export const JOB_LOCK_TTL_SECONDS = 15 * 60;
export const JOB_RATE_WINDOW_MS = 10 * 60 * 1000;
export const JOB_RATE_LIMIT = 5;
export const IP_GENERATE_LIMIT = 10;
export const IP_WEBHOOK_LIMIT = 60;
export const PAGE_LIMIT = 20;
export const PAGE_LIMIT_MAX = 50;
export const QUEUE_MAX_ATTEMPTS = 3;
