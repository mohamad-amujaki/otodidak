export type OutlineLesson = { id?: string; title: string; objective: string };
export type OutlineChapter = {
  id?: string;
  title: string;
  summary: string;
  lessons: OutlineLesson[];
};
export type Outline = { title: string; chapters: OutlineChapter[] };

export type OutlineAction =
  | { type: 'title'; title: string }
  | { type: 'chapter-title'; chapterId: string; title: string }
  | { type: 'chapter-summary'; chapterId: string; summary: string }
  | { type: 'lesson'; lessonId: string; title: string; objective: string }
  | { type: 'move-chapter'; chapterId: string; direction: 'up' | 'down' }
  | { type: 'move-lesson'; lessonId: string; direction: 'up' | 'down' }
  | { type: 'add-lesson'; chapterId: string }
  | { type: 'delete-lesson'; lessonId: string }
  | { type: 'delete-chapter'; chapterId: string };

export function applyOutlineAction(
  outline: Outline,
  action: OutlineAction,
  limits: { maxChapters: number; maxLessonsPerChapter: number },
): { ok: true; outline: Outline } | { ok: false; message: string } {
  const next: Outline = structuredClone(outline);
  switch (action.type) {
    case 'title':
      next.title = action.title.trim();
      break;
    case 'chapter-title':
    case 'chapter-summary': {
      const chapter = next.chapters.find(
        (item) => item.id === action.chapterId,
      );
      if (!chapter) return { ok: false, message: 'Bab tidak ditemukan.' };
      if (action.type === 'chapter-title') chapter.title = action.title.trim();
      else chapter.summary = action.summary.trim();
      break;
    }
    case 'lesson': {
      const lesson = findLesson(next, action.lessonId);
      if (!lesson) return { ok: false, message: 'Pelajaran tidak ditemukan.' };
      lesson.title = action.title.trim();
      lesson.objective = action.objective.trim();
      break;
    }
    case 'move-chapter': {
      const index = next.chapters.findIndex(
        (item) => item.id === action.chapterId,
      );
      const target = action.direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= next.chapters.length)
        return { ok: true, outline: next };
      const [item] = next.chapters.splice(index, 1);
      if (item) next.chapters.splice(target, 0, item);
      break;
    }
    case 'move-lesson': {
      const located = locateLesson(next, action.lessonId);
      if (!located) return { ok: false, message: 'Pelajaran tidak ditemukan.' };
      const target =
        action.direction === 'up' ? located.index - 1 : located.index + 1;
      if (target < 0 || target >= located.chapter.lessons.length)
        return { ok: true, outline: next };
      const [item] = located.chapter.lessons.splice(located.index, 1);
      if (item) located.chapter.lessons.splice(target, 0, item);
      break;
    }
    case 'add-lesson': {
      const chapter = next.chapters.find(
        (item) => item.id === action.chapterId,
      );
      if (!chapter) return { ok: false, message: 'Bab tidak ditemukan.' };
      if (chapter.lessons.length >= limits.maxLessonsPerChapter) {
        return {
          ok: false,
          message: 'Batas pelajaran pada bab ini sudah tercapai.',
        };
      }
      chapter.lessons.push({
        title: 'Pelajaran baru',
        objective: 'Tujuan singkat.',
      });
      break;
    }
    case 'delete-lesson': {
      const located = locateLesson(next, action.lessonId);
      if (!located) return { ok: false, message: 'Pelajaran tidak ditemukan.' };
      if (located.chapter.lessons.length <= 1)
        return {
          ok: false,
          message:
            'Bab perlu satu pelajaran. Hapus bab jika ingin menghapusnya.',
        };
      located.chapter.lessons.splice(located.index, 1);
      break;
    }
    case 'delete-chapter': {
      if (next.chapters.length <= 1)
        return { ok: false, message: 'Jalur perlu satu bab.' };
      next.chapters = next.chapters.filter(
        (item) => item.id !== action.chapterId,
      );
      break;
    }
    default: {
      const neverAction: never = action;
      return neverAction;
    }
  }
  if (next.chapters.length > limits.maxChapters)
    return { ok: false, message: 'Batas bab pada jalur ini sudah tercapai.' };
  if (!next.title) return { ok: false, message: 'Judul jalur perlu diisi.' };
  return { ok: true, outline: next };
}

function findLesson(outline: Outline, lessonId: string): OutlineLesson | null {
  for (const chapter of outline.chapters) {
    const lesson = chapter.lessons.find((item) => item.id === lessonId);
    if (lesson) return lesson;
  }
  return null;
}

function locateLesson(
  outline: Outline,
  lessonId: string,
): { chapter: OutlineChapter; index: number } | null {
  for (const chapter of outline.chapters) {
    const index = chapter.lessons.findIndex((item) => item.id === lessonId);
    if (index >= 0) return { chapter, index };
  }
  return null;
}
