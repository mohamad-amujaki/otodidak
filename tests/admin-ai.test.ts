import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRow } from '../src/db/schema';
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_MODEL_NAME,
} from '../src/domain/defaults';
import { database } from '../src/server/account';
import { runAdminAction } from '../src/server/admin-actions';
import {
  getActiveModelForTask,
  listModelOptions,
  testModelConnection,
} from '../src/server/admin-data';
import { updateProviderConnection } from '../src/server/admin-mutations';
import { api, jsonBody, signIn } from './helpers';

type ProviderRow = {
  base_url: string;
  secret_name: string | null;
  auth_kind: string;
};

const csrf = 'csrf-test-token';

async function providerRow(): Promise<ProviderRow> {
  const row = await env.DB.prepare(
    `select p.base_url, p.secret_name, p.auth_kind
       from ai_provider p
       join ai_model m on m.provider_id = p.id
      where m.active = 1
      limit 1`,
  ).first<ProviderRow>();
  if (!row) throw new Error('provider tidak ada');
  return row;
}

/** Menjalankan action form persis seperti halaman admin memanggilnya. */
async function submit(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return runAdminAction(
    new Request('https://otodidak.test/admin/ai', {
      method: 'POST',
      headers: { cookie: `otodidak_csrf=${csrf}; ${cookie}` },
    }),
    env,
    csrf,
    form,
  );
}

/** Env tiruan dengan secret nyata, untuk menguji jalur jaringan tanpa binding asli. */
function envWithSecret(secret: string): Env {
  return {
    APP_KV: env.APP_KV,
    OPENAI_API_KEY: secret,
    YOUTUBE_API_KEY: 'mock',
  } as unknown as Env;
}

beforeEach(async () => {
  await env.DB.prepare(
    `update ai_provider
        set base_url = ?, secret_name = 'OPENAI_API_KEY', auth_kind = 'bearer'`,
  )
    .bind(DEFAULT_AI_BASE_URL)
    .run();
  await env.DB.prepare(
    `update ai_model
        set model_name = ?, max_output_tokens = 4096, timeout_ms = 120000`,
  )
    .bind(DEFAULT_MODEL_NAME)
    .run();
});

describe('admin AI — koneksi penyedia', () => {
  it('menyimpan koneksi untuk semua tugas dan menormalkan URL', async () => {
    const cookie = await signIn('admin@example.com');
    const message = await submit(cookie, {
      aksi: 'ai-provider',
      baseUrl: 'https://ai.sumopod.com/v1/',
      secretName: 'OPENAI_API_KEY',
    });
    expect(message).toContain('Koneksi penyedia diperbarui untuk semua tugas');
    const row = await providerRow();
    expect(row.base_url).toBe('https://ai.sumopod.com/v1');
    expect(row.secret_name).toBe('OPENAI_API_KEY');
    expect(row.auth_kind).toBe('bearer');

    const db = await database(env);
    for (const task of ['roadmap', 'lesson', 'quiz'] as const) {
      const model = await getActiveModelForTask(db, task);
      expect(model.baseUrl).toBe('https://ai.sumopod.com/v1');
      expect(model.secretName).toBe('OPENAI_API_KEY');
    }
  });

  it('menolak host di luar allowlist tanpa mengubah data', async () => {
    const cookie = await signIn('admin@example.com');
    const before = await providerRow();
    const message = await submit(cookie, {
      aksi: 'ai-provider',
      baseUrl: 'https://evil.example.com/v1',
      secretName: 'OPENAI_API_KEY',
    });
    expect(message).toContain('daftar yang diizinkan');
    expect(await providerRow()).toEqual(before);
  });

  it('menolak HTTP dan secret yang tidak terpasang', async () => {
    const cookie = await signIn('admin@example.com');
    expect(
      await submit(cookie, {
        aksi: 'ai-provider',
        baseUrl: 'http://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
      }),
    ).toMatch(/HTTPS/);
    expect(
      await submit(cookie, {
        aksi: 'ai-provider',
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'SECRET_YANG_TIDAK_ADA',
      }),
    ).toContain('Nama secret tidak ada di lingkungan Worker');
  });

  it('menyimpan lewat endpoint API admin', async () => {
    const cookie = await signIn('admin@example.com');
    const response = await api('/api/admin/provider', {
      method: 'PUT',
      cookie,
      json: {
        baseUrl: 'https://api.deepseek.com/v1',
        secretName: 'OPENAI_API_KEY',
      },
    });
    expect(response.status).toBe(200);
    expect((await providerRow()).base_url).toBe('https://api.deepseek.com/v1');
  });
});

describe('admin AI — model per tugas', () => {
  it('menyimpan model tanpa menyentuh koneksi penyedia', async () => {
    const cookie = await signIn('admin@example.com');
    const before = await providerRow();
    const message = await submit(cookie, {
      aksi: 'ai-task',
      task: 'quiz',
      body: 'Prompt kuis untuk pengujian.',
      modelName: 'deepseek-v4-flash',
      maxOutputTokens: '2048',
      timeoutMs: '90000',
    });
    expect(message).toContain('Pengaturan AI untuk tugas ini');
    const model = await env.DB.prepare(
      `select model_name, max_output_tokens, timeout_ms
         from ai_model where task = 'quiz' and active = 1`,
    ).first<{
      model_name: string;
      max_output_tokens: number;
      timeout_ms: number;
    }>();
    expect(model?.model_name).toBe('deepseek-v4-flash');
    expect(model?.max_output_tokens).toBe(2048);
    expect(model?.timeout_ms).toBe(90000);
    expect(await providerRow()).toEqual(before);
  });

  it('menolak token di luar rentang lewat API', async () => {
    const cookie = await signIn('admin@example.com');
    const response = await api('/api/admin/models/quiz', {
      method: 'PUT',
      cookie,
      json: {
        modelName: 'deepseek-flash',
        maxOutputTokens: 99,
        timeoutMs: 5000,
      },
    });
    expect(response.status).toBe(400);
  });
});

describe('admin AI — daftar model', () => {
  it('memakai daftar cadangan saat secret mock', async () => {
    const cookie = await signIn('admin@example.com');
    const response = await api('/api/admin/models/available', { cookie });
    expect(response.status).toBe(200);
    const body = await jsonBody<{
      models: { id: string }[];
      source: string;
      error: string | null;
    }>(response);
    expect(body.source).toBe('fallback');
    expect(body.error).toBeNull();
    expect(body.models.map((model) => model.id)).toContain(
      'deepseek-v4.1-flash-1017',
    );
  });

  it('mengambil dari provider, menyimpan ke KV, lalu memakai cache', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ id: 'probe-model', max_output_tokens: 1234 }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const testEnv = envWithSecret('sk-uji');
    const key = 'ai:models:https://ai.sumopod.com/v1:OPENAI_API_KEY';
    try {
      const live = await listModelOptions(testEnv, {
        baseUrl: 'https://ai.sumopod.com/v1/',
        secretName: 'OPENAI_API_KEY',
      });
      expect(live.source).toBe('live');
      expect(live.error).toBeNull();
      expect(live.models).toContainEqual({
        id: 'deepseek-v4.1-flash-1017',
        maxOutputTokens: null,
      });
      expect(live.models).toContainEqual({
        id: 'probe-model',
        maxOutputTokens: 1234,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await env.APP_KV.get(key)).toBeTruthy();

      const cached = await listModelOptions(testEnv, {
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
      });
      expect(cached.source).toBe('cache');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const refreshed = await listModelOptions(testEnv, {
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
        refresh: true,
      });
      expect(refreshed.source).toBe('live');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      await env.APP_KV.delete(key);
    }
  });

  it('kembali ke daftar cadangan saat provider gagal', async () => {
    vi.stubGlobal('fetch', async () => new Response('gagal', { status: 502 }));
    try {
      const result = await listModelOptions(envWithSecret('sk-uji'), {
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
      });
      expect(result.source).toBe('fallback');
      expect(result.error).toBe('HTTP 502 · gagal');
      expect(result.models.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tidak memanggil jaringan untuk host di luar allowlist', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await listModelOptions(envWithSecret('sk-uji'), {
        baseUrl: 'https://10.0.0.1/v1',
        secretName: 'OPENAI_API_KEY',
      });
      expect(result.source).toBe('fallback');
      expect(result.error).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('admin AI — uji koneksi', () => {
  it('melaporkan mode mock tanpa memanggil jaringan', async () => {
    const cookie = await signIn('admin@example.com');
    const message = await submit(cookie, {
      aksi: 'tes-koneksi',
      baseUrl: 'https://ai.sumopod.com/v1',
      secretName: 'OPENAI_API_KEY',
    });
    expect(message).toContain('secret masih bernilai mock');

    const response = await api('/api/admin/models/test', {
      method: 'POST',
      cookie,
      json: {
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
      },
    });
    expect(response.status).toBe(200);
    const body = await jsonBody<{ ok: boolean; message: string }>(response);
    expect(body.ok).toBe(false);
    expect(body.message).toContain('mock');
  });

  it('melaporkan sukses beserta jumlah model saat provider merespons', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/chat/completions'))
        return Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
        });
      return Response.json({ data: [{ id: 'probe-model' }] });
    });
    try {
      const result = await testModelConnection(envWithSecret('sk-uji'), {
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
        refresh: true,
      });
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/Koneksi OK · chat .* · 5 model/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gagal walau daftar model sukses jika chat menolak kunci', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      // Router bisa membalas /models tanpa auth, tetapi chat tetap 401.
      if (url.endsWith('/chat/completions'))
        return Response.json(
          { error: { message: 'invalid API key' } },
          { status: 401 },
        );
      return Response.json({ data: [{ id: 'probe-model' }] });
    });
    try {
      const result = await testModelConnection(envWithSecret('sk-uji'), {
        baseUrl: 'https://router.ariaseta.com/v1',
        secretName: 'OPENAI_API_KEY',
        refresh: true,
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('HTTP 401');
      expect(result.message).toContain('Kunci API ditolak');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('melaporkan gagal saat provider menolak', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    try {
      const result = await testModelConnection(envWithSecret('sk-uji'), {
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
        refresh: true,
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('HTTP 401');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('menolak aktor yang bukan superadmin', async () => {
    const cookie = await signIn('bukan-admin@example.com', 'Pengguna');
    const response = await api('/api/admin/models/test', {
      method: 'POST',
      cookie,
      json: {
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
      },
    });
    expect(response.status).toBe(403);
  });
});

describe('admin AI — guard mutasi', () => {
  it('updateProviderConnection menolak non-superadmin', async () => {
    const actor = { email: 'rekan-ai@example.com' } as UserRow;
    const before = await providerRow();
    await expect(
      updateProviderConnection(await database(env), env, actor, {
        baseUrl: 'https://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
      }),
    ).rejects.toThrowError(/akses|forbidden/i);
    expect(await providerRow()).toEqual(before);
  });
});
