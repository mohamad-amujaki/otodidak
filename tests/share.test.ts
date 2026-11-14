import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { database } from '../src/server/account';
import {
  countShareCtaClick,
  createLessonShareLink,
  createPathShareLink,
  newShareToken,
  ownerShareLink,
  publicPathPayload,
  resolveShareLink,
  revokeShareLink,
  shareMessage,
  shareTopic,
  whatsappHref,
} from '../src/server/share';
import { signIn } from './helpers';

async function userIdOf(email: string): Promise<string> {
  const row = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (!row) throw new Error('pengguna tidak ada');
  return row.id;
}

async function seedLesson(userId: string, suffix: string) {
  const now = new Date().toISOString();
  const pathId = `path-${suffix}`;
  const chapterId = `chapter-${suffix}`;
  const lessonId = `lesson-${suffix}`;
  await env.DB.prepare(
    "insert into path (id, user_id, title, topic, status, is_active, created_at, updated_at) values (?, ?, 'Jalur', 'Topik', 'ready', 0, ?, ?)",
  )
    .bind(pathId, userId, now, now)
    .run();
  await env.DB.prepare(
    "insert into chapter (id, path_id, position, title, summary, quiz_status) values (?, ?, 0, 'Bab', 'Ringkas', 'unchecked')",
  )
    .bind(chapterId, pathId)
    .run();
  await env.DB.prepare(
    "insert into lesson (id, chapter_id, position, title, objective, body, status, created_at) values (?, ?, 0, 'Pelajaran', 'Objective', 'Isi pelajaran.', 'ready', ?)",
  )
    .bind(lessonId, chapterId, now)
    .run();
  return { pathId, chapterId, lessonId };
}

describe('link bagikan materi', () => {
  it('membuat token pendek, membuka link, dan menghitung kunjungan', async () => {
    await database(env);
    const cookie = await signIn('share-owner@example.com', 'Owner');
    expect(cookie).toBeTruthy();
    const userId = await userIdOf('share-owner@example.com');
    const { lessonId } = await seedLesson(userId, 'a');

    const db = await database(env);
    const link = await createLessonShareLink(db, userId, lessonId);
    expect(link.token).toHaveLength(10);
    expect(link.token).toMatch(/^[a-z0-9]{10}$/);
    expect(link.scope).toBe('lesson');
    expect(link.expiresAt).toBeTruthy();

    const opened = await resolveShareLink(db, link.token);
    expect(opened?.id).toBe(link.id);
    const again = await resolveShareLink(db, link.token);
    expect(again?.views).toBe(1);
    const third = await ownerShareLink(db, userId, link.token);
    expect(third?.views).toBe(2);
  });

  it('menolak link kedaluwarsa dan link yang dicabut', async () => {
    const db = await database(env);
    await signIn('share-expire@example.com', 'Expire');
    const userId = await userIdOf('share-expire@example.com');
    const { lessonId } = await seedLesson(userId, 'b');

    const link = await createLessonShareLink(db, userId, lessonId, 7);
    await env.DB.prepare(
      "update share_link set expires_at = '2020-01-01T00:00:00.000Z' where id = ?",
    )
      .bind(link.id)
      .run();
    expect(await resolveShareLink(db, link.token)).toBeNull();

    const fresh = await createLessonShareLink(db, userId, lessonId, 0);
    expect(await resolveShareLink(db, fresh.token)).not.toBeNull();
    await revokeShareLink(db, userId, fresh.token);
    expect(await resolveShareLink(db, fresh.token)).toBeNull();
    expect(await ownerShareLink(db, userId, fresh.token)).not.toBeNull();
  });

  it('menolak materi milik pengguna lain', async () => {
    const db = await database(env);
    await signIn('share-owner2@example.com', 'Owner Dua');
    await signIn('share-other@example.com', 'Orang Lain');
    const ownerId = await userIdOf('share-owner2@example.com');
    const otherId = await userIdOf('share-other@example.com');
    const { lessonId } = await seedLesson(ownerId, 'c');
    await expect(
      createLessonShareLink(db, otherId, lessonId),
    ).rejects.toThrow();
  });

  it('menyusun pesan WhatsApp yang ringkas', () => {
    const text = shareMessage(
      'Piramida Minto',
      'Cara menyusun argumen supaya pembaca bisa berhenti kapan saja.',
      'https://otodidak.web.id/s/abc123',
    );
    expect(text).toContain('Piramida Minto');
    expect(text).toContain('https://otodidak.web.id/s/abc123');
    expect(text).toContain('Otodidak');
    const href = whatsappHref(text);
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(newShareToken()).toHaveLength(10);
  });
});

describe('bagikan jalur', () => {
  it('membuat link jalur, merangkum bab, dan menghitung klik CTA', async () => {
    const db = await database(env);
    await signIn('share-path@example.com', 'Pemilik Jalur');
    const userId = await userIdOf('share-path@example.com');
    const { pathId } = await seedLesson(userId, 'd');

    const link = await createPathShareLink(db, userId, pathId);
    expect(link.scope).toBe('path');

    const payload = await publicPathPayload(db, pathId);
    expect(payload?.chapters).toHaveLength(1);
    expect(payload?.chapters[0]?.lessons).toHaveLength(1);
    expect(payload?.chapters[0]?.lessons[0]?.title).toBe('Pelajaran');

    expect(await shareTopic(db, link)).toBe('Topik');

    await countShareCtaClick(db, link.token);
    await countShareCtaClick(db, link.token);
    const row = await ownerShareLink(db, userId, link.token);
    expect(row?.ctaClicks).toBe(2);
    expect(row?.views).toBe(0);
  });
});
