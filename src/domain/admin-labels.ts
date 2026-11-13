export const ledgerReasonLabels: Record<string, string> = {
  signup_grant: 'Kredit awal',
  purchase: 'Pembelian',
  roadmap: 'Jalur',
  lesson: 'Pelajaran',
  quiz: 'Kuis',
  refund: 'Pengembalian',
  admin_adjust: 'Penyesuaian admin',
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
