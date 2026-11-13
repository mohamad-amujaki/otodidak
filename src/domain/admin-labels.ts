export const ledgerReasonLabels: Record<string, string> = {
  signup_grant: 'Kredit awal',
  purchase: 'Pembelian',
  roadmap: 'Jalur',
  lesson: 'Pelajaran',
  quiz: 'Kuis',
  refund: 'Pengembalian',
  admin_adjust: 'Penyesuaian admin',
  outline: 'Kerangka pelajaran',
};

export const configFieldLabels: Record<string, string> = {
  maxChapters: 'Maksimal bab per jalur',
  maxLessonsPerChapter: 'Maksimal pelajaran per bab',
  quizQuestionCount: 'Jumlah soal kuis',
  quizPassPercent: 'Nilai lulus kuis (%)',
  costRoadmap: 'Biaya buat jalur (kredit)',
  costLesson: 'Biaya buka pelajaran (kredit)',
  costQuiz: 'Biaya buat kuis (kredit)',
  signupCredits: 'Kredit daftar baru',
  lessonMinuteLabel: 'Label menit per pelajaran',
};

export const configFieldHints: Partial<Record<string, string>> = {
  quizPassPercent: 'Persentase jawaban benar minimal untuk lulus.',
  lessonMinuteLabel: 'Angka perkiraan yang ditampilkan di UI pelajaran.',
};

export const orderStatusLabels: Record<string, string> = {
  pending: 'Menunggu',
  paid: 'Lunas',
  failed: 'Gagal',
  expired: 'Kadaluarsa',
};

export const jobStatusLabels: Record<string, string> = {
  queued: 'Mengantri',
  running: 'Berjalan',
  succeeded: 'Berhasil',
  failed: 'Gagal',
};

export const jobKindLabels: Record<string, string> = {
  roadmap: 'Jalur',
  lesson: 'Pelajaran',
  quiz: 'Kuis',
};

export const aiTaskLabels: Record<string, string> = {
  roadmap: 'Peta jalur',
  lesson: 'Pelajaran',
  quiz: 'Kuis',
};

export const aiTaskCostHints: Record<string, string> = {
  roadmap: 'Biaya buat jalur (kredit)',
  lesson: 'Biaya buka pelajaran (kredit)',
  quiz: 'Biaya buat kuis (kredit)',
};

export const aiTasks = ['roadmap', 'lesson', 'quiz'] as const;

export const configFieldGroups = {
  batas: [
    'maxChapters',
    'maxLessonsPerChapter',
    'quizQuestionCount',
    'quizPassPercent',
  ] as const,
  biaya: ['costRoadmap', 'costLesson', 'costQuiz'] as const,
  onboarding: ['signupCredits', 'lessonMinuteLabel'] as const,
};

export const configGroupTitles: Record<keyof typeof configFieldGroups, string> =
  {
    batas: 'Batas konten',
    biaya: 'Biaya kredit',
    onboarding: 'Onboarding',
  };
