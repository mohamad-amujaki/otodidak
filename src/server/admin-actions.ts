import { SEED_PROMPTS } from '../domain/prompts';
import {
  adminAdjustLedger,
  adminEraseUserLearning,
  appErrorToMessage,
  patchAdminUser,
  updateAppConfig,
  updateCreditPacks,
  updateModelForTask,
  updatePromptTemplate,
} from './admin-mutations';
import { pageSession } from './ssr';

const seededPromptTasks = ['roadmap', 'lesson', 'quiz'] as const;

export async function runAdminAction(
  request: Request,
  bindings: Env,
  _csrf: string,
  form: FormData,
): Promise<string> {
  const session = await pageSession(request, bindings);
  if (!session || session.user.role !== 'admin')
    return 'Akses ditolak. Masuk sebagai admin.';
  const { db, user } = session;
  const action = String(form.get('aksi') ?? '');
  try {
    if (action === 'pengguna') {
      await patchAdminUser(db, bindings, user, String(form.get('userId') ?? ''), {
        role: String(form.get('role') ?? ''),
        status: String(form.get('status') ?? ''),
      });
      return 'Pengguna diperbarui.';
    }
    if (action === 'hapus') {
      await adminEraseUserLearning(db, String(form.get('userId') ?? ''));
      return 'Materi belajar dihapus. Buku kredit tetap ada.';
    }
    if (action === 'sesuaikan') {
      await adminAdjustLedger(db, bindings, user, String(form.get('userId') ?? ''), {
        amount: Number(form.get('amount')),
        note: String(form.get('note') ?? ''),
      });
      return 'Buku kredit diperbarui.';
    }
    if (action === 'konfigurasi') {
      await updateAppConfig(db, bindings, user, {
        maxChapters: Number(form.get('maxChapters')),
        maxLessonsPerChapter: Number(form.get('maxLessonsPerChapter')),
        quizQuestionCount: Number(form.get('quizQuestionCount')),
        quizPassPercent: Number(form.get('quizPassPercent')),
        costRoadmap: Number(form.get('costRoadmap')),
        costLesson: Number(form.get('costLesson')),
        costQuiz: Number(form.get('costQuiz')),
        signupCredits: Number(form.get('signupCredits')),
        lessonMinuteLabel: Number(form.get('lessonMinuteLabel')),
      });
      return 'Batas diperbarui.';
    }
    if (action === 'ai-task') {
      const task = String(form.get('task') ?? '');
      await updatePromptTemplate(db, bindings, user, task, {
        body: String(form.get('body') ?? ''),
      });
      await updateModelForTask(db, bindings, user, task, {
        modelName: String(form.get('modelName') ?? ''),
        maxOutputTokens: Number(form.get('maxOutputTokens')),
        timeoutMs: Number(form.get('timeoutMs')),
        baseUrl: String(form.get('baseUrl') ?? ''),
        secretName: String(form.get('secretName') ?? ''),
        authKind: String(form.get('authKind') ?? 'bearer'),
      });
      return 'Pengaturan AI untuk tugas ini diperbarui.';
    }
    if (action === 'reset-prompt') {
      const task = String(form.get('task') ?? '');
      if (!seededPromptTasks.includes(task as (typeof seededPromptTasks)[number]))
        return 'Tugas tidak dikenal.';
      const body = SEED_PROMPTS[task as (typeof seededPromptTasks)[number]];
      await updatePromptTemplate(db, bindings, user, task, { body });
      return 'Prompt dikembalikan ke bawaan.';
    }
    if (action === 'prompt') {
      await updatePromptTemplate(db, bindings, user, String(form.get('task') ?? ''), {
        body: String(form.get('body') ?? ''),
      });
      return 'Prompt diperbarui.';
    }
    if (action === 'model') {
      await updateModelForTask(db, bindings, user, String(form.get('task') ?? ''), {
        modelName: String(form.get('modelName') ?? ''),
        maxOutputTokens: Number(form.get('maxOutputTokens')),
        timeoutMs: Number(form.get('timeoutMs')),
        baseUrl: String(form.get('baseUrl') ?? ''),
        secretName: String(form.get('secretName') ?? ''),
        authKind: String(form.get('authKind') ?? 'bearer'),
      });
      return 'Model diperbarui.';
    }
    if (action === 'paket') {
      const credits = Number(form.get('credits'));
      const priceIdr = Number(form.get('priceIdr'));
      if (!Number.isFinite(credits) || credits < 1) return 'Kredit minimal 1.';
      if (!Number.isFinite(priceIdr) || priceIdr < 1)
        return 'Harga minimal Rp 1.';
      await updateCreditPacks(db, bindings, user, {
        packs: [
          {
            id: String(form.get('id') ?? ''),
            name: String(form.get('name') ?? ''),
            credits,
            priceIdr,
            active: form.get('active') === '1',
            sort: Number(form.get('sort')),
          },
        ],
      });
      return 'Paket diperbarui.';
    }
  } catch (error) {
    return appErrorToMessage(error);
  }
  return 'Aksi tidak dikenal.';
}

export function roleLabel(role: unknown): string {
  return role === 'admin' ? 'Admin' : 'Pelajar';
}

export function statusLabel(status: unknown): string {
  return status === 'suspended' ? 'Ditahan' : 'Aktif';
}
