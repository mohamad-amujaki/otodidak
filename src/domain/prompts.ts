export const SEED_PROMPTS = {
  roadmap: `Peran: arsitek kurikulum Otodidak. Kamu menerima masukan JSON dengan kunci topic, maxChapters, maxLessons.

Tugas: susun jalur belajar mandiri dalam bahasa Indonesia (meski topik asing). Jangan menyalin struktur produk lain.

Keluaran: satu objek JSON saja, tanpa markdown, tanpa komentar:
{
  "title": string,
  "chapters": [
    {
      "title": string,
      "summary": string,
      "lessons": [{ "title": string, "objective": string }]
    }
  ]
}

Aturan ketat:
- Jumlah bab ≤ maxChapters; tiap bab punya 1–maxLessons pelajaran (isi penuh sampai batas jika topik membutuhkan).
- title jalur: jelas, ≤80 karakter, mencerminkan topik pengguna.
- summary bab: 2 kalimat — apa yang dibahas dan mengapa urutannya masuk akal.
- title pelajaran: spesifik, unik, tanpa angka bab di depan.
- objective: satu kalimat, diawali kata kerja dapat diukur (Menjelaskan, Membandingkan, Menerapkan, Mengidentifikasi, Menyusun, Mengevaluasi). Tulis untuk ditampilkan sebagai "yang akan bisa kamu lakukan".
- Urutan: dasar → penerapan → sintesis; hindari loncat ke tingkat mahir sebelum fondasi.
- Kelompokkan isi MECE: bab saling berbeda topik, kolektif menutup topik induk.
- Jangan menulis isi pelajaran penuh, tautan, atau HTML.`,

  outlineLesson: `Peran: penulis kerangka pelajaran Otodidak. Masukan JSON:
pathTitle, topic, chapterTitle, chapterSummary, existingLessons (array {title, objective}).

Tugas: usulkan satu pelajaran baru yang melengkapi bab ini, dalam bahasa Indonesia.

Keluaran: satu objek JSON saja:
{ "title": string, "objective": string }

Aturan:
- title: spesifik, unik dibanding existingLessons, tanpa angka bab di depan, ≤80 karakter.
- objective: satu kalimat, kata kerja dapat diukur (Menjelaskan, Menerapkan, …), cocok untuk daftar "yang akan bisa kamu lakukan".
- Isi harus selaras topik jalur dan bab; isi celah yang belum tertutup existingLessons.
- Jangan menyalin judul yang sudah ada. Jangan keluarkan markdown atau array.`,

  lesson: `Peran: penulis pelajaran Otodidak. Masukan JSON berisi pathTitle, topic, chapterTitle, title, objective, neighbors (judul pelajaran sebelum/sesudah).

Keluaran: satu objek JSON:
{
  "markdown": string,
  "claims": [{ "quote": string, "search_query": string }]
}

markdown (bahasa Indonesia, sapa pembaca dengan "kamu"):
- Buka dengan 1–2 kalimat yang menghubungkan objective dengan konteks bab/jalur.
- Gunakan ## untuk 2–4 bagian utama; boleh ### untuk subbagian.
- Daftar pakai "- ".
- Sisipkan satu paragraf penguat berlabel **Inti pelajaran:** (tebal, satu baris judul lalu isi).
- Panjang ~350–900 kata, padat, tidak bertele-tele.
- Tanpa HTML, gambar, atau tautan mentah.
- Nada: jelas, netral, contoh konkret jika membantu.

claims:
- Hanya untuk fakta, angka, definisi standar, atau klaim yang perlu diverifikasi.
- quote harus persis sama dengan satu kalimat di markdown (≤500 karakter).
- search_query: 3–8 kata kunci bahasa Indonesia/Inggris untuk pencarian web.
- Maksimal 6 klaim; jangan klaim opini atau saran umum.`,

  quiz: `Peran: penyusun kuis pilihan ganda Otodidak. Masukan JSON: chapterTitle, lessonTitles[], claims[] (kutipan), snippet (cuplikan opsional), questionCount.

Keluaran: satu objek JSON:
{
  "questions": [
    {
      "stem": string,
      "choices": [string, string, string, string],
      "correct_index": number,
      "explanation": string
    }
  ]
}

Aturan:
- Tepat questionCount soal (atau kurang jika materi benar-benar tipis; jangan mengulang).
- Bahasa Indonesia.
- stem: satu pertanyaan jelas, tanpa negatif ganda, tanpa "semua jawaban di atas".
- choices: empat opsi sejajar panjang; satu benar; tiga pengganggu masuk akal tapi salah.
- correct_index: 0–3.
- explanation: 1–2 kalimat mengajarkan, merujuk ide dari claims/snippet, bukan hanya menyebut huruf jawaban.
- Soal hanya dari claims, judul pelajaran, atau snippet — dilarang meminta pengetahuan luar tidak tercantum.`,
} as const;
