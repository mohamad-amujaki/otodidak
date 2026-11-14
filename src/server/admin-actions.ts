import { configFieldGroups } from '../domain/admin-labels';
import { SEED_PROMPTS } from '../domain/prompts';
import { assertSuperadmin } from './admin-access';
import {
  adminAdjustLedger,
  adminAdjustLedgerBulk,
  adminEraseUserLearning,
  appErrorToMessage,
  patchAdminUser,
  updateAppConfig,
  updateCreditPacks,
  updateModelForTask,
  updatePromptTemplate,
} from './admin-mutations';
import { createCreditCode, setCreditCodeActive } from './credit-codes';
import { adminRequeueGenerationJob } from './generation';
import { pageSession } from './ssr';

const seededPromptTasks = ['roadmap', 'lesson', 'quiz'] as const;

export async function runAdminAction(
  request: Request,
  bindings: Env,
  _csrf: string,
  form: FormData,
): Promise<string> {
  const session = await pageSession(request, bindings);
  if (session?.user.role !== 'admin')
    return 'Akses ditolak. Masuk sebagai admin.';
  const { db, user } = session;
  const action = String(form.get('aksi') ?? '');
  try {
    if (action === 'pengguna') {
      await patchAdminUser(
        db,
        bindings,
        user,
        String(form.get('userId') ?? ''),
        {
          role: String(form.get('role') ?? ''),
          status: String(form.get('status') ?? ''),
        },
      );
      return 'Pengguna diperbarui.';
    }
    if (action === 'hapus') {
      await adminEraseUserLearning(
        db,
        bindings,
        user,
        String(form.get('userId') ?? ''),
      );
      return 'Materi belajar dihapus. Buku kredit tetap ada.';
    }
    if (action === 'sesuaikan') {
      const outcome = await adminAdjustLedger(
        db,
        bindings,
        user,
        String(form.get('userId') ?? ''),
        {
          amount: Number(form.get('amount')),
          note: String(form.get('note') ?? ''),
          category: String(form.get('category') ?? '') || undefined,
          nonce: String(form.get('nonce') ?? '') || undefined,
        },
      );
      if (outcome.status === 'capped')
        return `Batas harian terlampaui. Sisa jatah ${outcome.remaining} kredit dalam 24 jam.`;
      if (outcome.status === 'duplicate')
        return 'Aksi ini sudah diterapkan sebelumnya. Saldo tidak berubah.';
      if (outcome.status === 'insufficient')
        return 'Gagal: pengurangan itu akan membuat saldo negatif.';
      const verb = outcome.amount > 0 ? 'ditambah' : 'dikurangi';
      return `Kredit ${verb} ${Math.abs(outcome.amount)}. Saldo baru ${outcome.balance}.`;
    }
    if (action === 'sesuaikan-banyak') {
      const selected = form
        .getAll('userId')
        .map((value) => String(value))
        .filter(Boolean);
      if (selected.length === 0) return 'Pilih minimal satu pengguna di tabel.';
      const outcome = await adminAdjustLedgerBulk(db, bindings, user, {
        userIds: selected,
        amount: Number(form.get('amount')),
        note: String(form.get('note') ?? ''),
        category: String(form.get('category') ?? '') || undefined,
        nonce: String(form.get('nonce') ?? '') || undefined,
      });
      if (outcome.capped)
        return `Batas harian terlampaui. Sisa jatah ${outcome.remaining} kredit dalam 24 jam.`;
      const verb = outcome.amount > 0 ? 'ditambah' : 'dikurangi';
      const skipped: string[] = [];
      if (outcome.duplicate > 0)
        skipped.push(`${outcome.duplicate} sudah diterapkan`);
      if (outcome.insufficient > 0)
        skipped.push(`${outcome.insufficient} saldo tidak cukup`);
      if (outcome.missing > 0)
        skipped.push(`${outcome.missing} tidak ditemukan`);
      if (outcome.applied === 0)
        return skipped.length > 0
          ? `Tidak ada perubahan. Dilewati: ${skipped.join(' · ')}.`
          : 'Tidak ada pengguna yang dipilih.';
      const tail =
        skipped.length > 0 ? ` Dilewati: ${skipped.join(' · ')}.` : '';
      return `Kredit ${verb} ${Math.abs(outcome.amount)} untuk ${outcome.applied} pengguna.${tail}`;
    }
    if (action === 'kode-baru') {
      const created = await createCreditCode(db, bindings, user, {
        credits: Number(form.get('credits')),
        maxRedemptions: Number(form.get('maxRedemptions')),
        expiresInDays: Number(form.get('expiresInDays')),
      });
      return `Kode dibuat: ${created.formatted}. Bagikan ke pengguna yang dituju.`;
    }
    if (action === 'kode-nonaktif') {
      await setCreditCodeActive(
        db,
        bindings,
        user,
        String(form.get('codeId') ?? ''),
        false,
      );
      return 'Kode dinonaktifkan.';
    }
    if (action === 'konfigurasi') {
      // Diturunkan dari configFieldGroups supaya field baru di skema otomatis ikut.
      const fields = Object.values(configFieldGroups).flat();
      const payload: Record<string, number> = {};
      for (const field of fields) payload[field] = Number(form.get(field));
      await updateAppConfig(db, bindings, user, payload);
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
      if (
        !seededPromptTasks.includes(task as (typeof seededPromptTasks)[number])
      )
        return 'Tugas tidak dikenal.';
      const body = SEED_PROMPTS[task as (typeof seededPromptTasks)[number]];
      await updatePromptTemplate(db, bindings, user, task, { body });
      return 'Prompt dikembalikan ke bawaan.';
    }
    if (action === 'prompt') {
      await updatePromptTemplate(
        db,
        bindings,
        user,
        String(form.get('task') ?? ''),
        {
          body: String(form.get('body') ?? ''),
        },
      );
      return 'Prompt diperbarui.';
    }
    if (action === 'model') {
      await updateModelForTask(
        db,
        bindings,
        user,
        String(form.get('task') ?? ''),
        {
          modelName: String(form.get('modelName') ?? ''),
          maxOutputTokens: Number(form.get('maxOutputTokens')),
          timeoutMs: Number(form.get('timeoutMs')),
          baseUrl: String(form.get('baseUrl') ?? ''),
          secretName: String(form.get('secretName') ?? ''),
          authKind: String(form.get('authKind') ?? 'bearer'),
        },
      );
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
    if (action === 'job-ulang') {
      assertSuperadmin(bindings, user);
      await adminRequeueGenerationJob(
        bindings,
        db,
        String(form.get('jobId') ?? ''),
        user,
      );
      return 'Job dimasukkan lagi ke antrean.';
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
