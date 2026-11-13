import { SEED_PROMPTS } from '../domain/prompts';
import { callApi, errorOf } from './call';

const seededPromptTasks = ['roadmap', 'lesson', 'quiz'] as const;

export async function runAdminAction(
  request: Request,
  bindings: Env,
  csrf: string,
  form: FormData,
): Promise<string> {
  const action = String(form.get('aksi') ?? '');
  if (action === 'pengguna') {
    const result = await callApi(
      request,
      bindings,
      `/api/admin/users/${String(form.get('userId') ?? '')}`,
      {
        method: 'PATCH',
        json: {
          role: String(form.get('role') ?? ''),
          status: String(form.get('status') ?? ''),
        },
        csrf,
      },
    );
    return errorOf(result.data)?.message ?? 'Pengguna diperbarui.';
  }
  if (action === 'hapus') {
    const result = await callApi(
      request,
      bindings,
      `/api/admin/users/${String(form.get('userId') ?? '')}/deletion`,
      { method: 'POST', json: {}, csrf },
    );
    return (
      errorOf(result.data)?.message ??
      'Materi belajar dihapus. Buku kredit tetap ada.'
    );
  }
  if (action === 'sesuaikan') {
    const result = await callApi(
      request,
      bindings,
      `/api/admin/users/${String(form.get('userId') ?? '')}/ledger`,
      {
        method: 'POST',
        json: {
          amount: Number(form.get('amount')),
          note: String(form.get('note') ?? ''),
        },
        csrf,
      },
    );
    return errorOf(result.data)?.message ?? 'Buku kredit diperbarui.';
  }
  if (action === 'konfigurasi') {
    const result = await callApi(request, bindings, '/api/admin/config', {
      method: 'PUT',
      json: {
        maxChapters: Number(form.get('maxChapters')),
        maxLessonsPerChapter: Number(form.get('maxLessonsPerChapter')),
        quizQuestionCount: Number(form.get('quizQuestionCount')),
        quizPassPercent: Number(form.get('quizPassPercent')),
        costRoadmap: Number(form.get('costRoadmap')),
        costLesson: Number(form.get('costLesson')),
        costQuiz: Number(form.get('costQuiz')),
        signupCredits: Number(form.get('signupCredits')),
        lessonMinuteLabel: Number(form.get('lessonMinuteLabel')),
      },
      csrf,
    });
    return errorOf(result.data)?.message ?? 'Batas diperbarui.';
  }
  if (action === 'ai-task') {
    const task = String(form.get('task') ?? '');
    const promptResult = await callApi(
      request,
      bindings,
      `/api/admin/prompts/${task}`,
      {
        method: 'PUT',
        json: { body: String(form.get('body') ?? '') },
        csrf,
      },
    );
    const promptErr = errorOf(promptResult.data);
    if (promptErr) return promptErr.message;
    const modelResult = await callApi(
      request,
      bindings,
      `/api/admin/models/${task}`,
      {
        method: 'PUT',
        json: {
          modelName: String(form.get('modelName') ?? ''),
          maxOutputTokens: Number(form.get('maxOutputTokens')),
          timeoutMs: Number(form.get('timeoutMs')),
          baseUrl: String(form.get('baseUrl') ?? ''),
          secretName: String(form.get('secretName') ?? ''),
          authKind: String(form.get('authKind') ?? 'bearer'),
        },
        csrf,
      },
    );
    const modelErr = errorOf(modelResult.data);
    if (modelErr) return modelErr.message;
    return 'Pengaturan AI untuk tugas ini diperbarui.';
  }
  if (action === 'reset-prompt') {
    const task = String(form.get('task') ?? '');
    if (!seededPromptTasks.includes(task as (typeof seededPromptTasks)[number]))
      return 'Tugas tidak dikenal.';
    const body = SEED_PROMPTS[task as (typeof seededPromptTasks)[number]];
    const result = await callApi(
      request,
      bindings,
      `/api/admin/prompts/${task}`,
      {
        method: 'PUT',
        json: { body },
        csrf,
      },
    );
    return errorOf(result.data)?.message ?? 'Prompt dikembalikan ke bawaan.';
  }
  if (action === 'prompt') {
    const result = await callApi(
      request,
      bindings,
      `/api/admin/prompts/${String(form.get('task') ?? '')}`,
      {
        method: 'PUT',
        json: { body: String(form.get('body') ?? '') },
        csrf,
      },
    );
    return errorOf(result.data)?.message ?? 'Prompt diperbarui.';
  }
  if (action === 'model') {
    const result = await callApi(
      request,
      bindings,
      `/api/admin/models/${String(form.get('task') ?? '')}`,
      {
        method: 'PUT',
        json: {
          modelName: String(form.get('modelName') ?? ''),
          maxOutputTokens: Number(form.get('maxOutputTokens')),
          timeoutMs: Number(form.get('timeoutMs')),
          baseUrl: String(form.get('baseUrl') ?? ''),
          secretName: String(form.get('secretName') ?? ''),
          authKind: String(form.get('authKind') ?? 'bearer'),
        },
        csrf,
      },
    );
    return errorOf(result.data)?.message ?? 'Model diperbarui.';
  }
  if (action === 'paket') {
    const credits = Number(form.get('credits'));
    const priceIdr = Number(form.get('priceIdr'));
    if (!Number.isFinite(credits) || credits < 1) return 'Kredit minimal 1.';
    if (!Number.isFinite(priceIdr) || priceIdr < 1)
      return 'Harga minimal Rp 1.';
    const result = await callApi(request, bindings, '/api/admin/packs', {
      method: 'PUT',
      json: {
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
      },
      csrf,
    });
    return errorOf(result.data)?.message ?? 'Paket diperbarui.';
  }
  return 'Aksi tidak dikenal.';
}

export function roleLabel(role: unknown): string {
  return role === 'admin' ? 'Admin' : 'Pelajar';
}

export function statusLabel(status: unknown): string {
  return status === 'suspended' ? 'Ditahan' : 'Aktif';
}
