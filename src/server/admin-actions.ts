import type { Env } from 'cloudflare:workers';
import { errorOf, callApi } from './call';

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
    const result = await callApi(request, bindings, '/api/admin/packs', {
      method: 'PUT',
      json: {
        packs: [
          {
            id: String(form.get('id') ?? ''),
            name: String(form.get('name') ?? ''),
            credits: Number(form.get('credits')),
            priceIdr: Number(form.get('priceIdr')),
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
