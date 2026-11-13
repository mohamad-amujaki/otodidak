import { describe, expect, it } from 'vitest';
import {
  auditLessonQuality,
  lessonMaxWords,
  lessonMinWords,
} from '../src/domain/lesson-quality';

const naratif = `Bayangkan kamu menulis memo. Kamu mulai dari latar belakang. Lalu data minggu lalu. Lalu kesimpulan di ujung. Banyak orang mengira masalahnya adalah gaya bahasa. Itu gejala. Masalahnya ada di urutan.

Pembaca memo biasanya eksekutif. Ia membuka dokumen di sela dua rapat. Kalau dalam tiga puluh detik ia belum tahu apa yang diminta, dokumen itu ditutup. Ongkosnya satu jam rapat yang salah arah.

Kesimpulan datang lebih dulu. Argumen disusun di bawahnya. Pengantar menyiapkan pertanyaan pembaca. Tiga hal ini bekerja bersama, bukan terpisah.

## Tiga hal yang ditawarkan struktur piramida

Tingkat pertama: kesimpulan di depan. Tingkat kedua: argumen dikelompokkan. Tingkat ketiga: pengantar SCQA. Setiap tingkat menutup celah yang berbeda.

## Satu contoh yang akan kita pakai terus

Kamu analis di perusahaan distribusi. Biaya pengiriman timur naik 18 persen dalam enam bulan. Penyebabnya bukan bahan bakar. Penyebabnya rute yang diubah sistem penjadwalan baru. Kamu menulis memo satu halaman untuk direktur operasional.

Versi bawah-ke-atas membuka dengan latar belakang ekspansi, lalu data biaya, lalu analisis, lalu usulan di paragraf terakhir. Versi piramida langsung menyebut penyebab dan tiga tindakan yang bisa dijalankan bulan ini. Bedanya bukan panjang, tapi di versi kedua pembaca bisa berhenti di kalimat pertama dan tetap tahu keputusannya.

## Batas pendekatan ini

Struktur ini mengasumsikan kamu sudah punya jawaban. Untuk memo eksplorasi, ia tidak cocok. Ia juga bisa terasa dingin kalau pembaca belum punya konteks. Struktur rapi tidak menyelamatkan analisis yang salah.

## Mulai dari mana

Ambil satu tulisan kerja yang sudah kamu kirim minggu ini. Cari kalimat kesimpulannya. Pindahkan ke paling atas. Latihan ini biasanya menunjukkan dua hal sekaligus. Pelajaran berikutnya membedah cara menyusun argumen yang sejajar.

## **Inti pelajaran:**

Struktur yang rapi memaksa kamu memutuskan pesan di awal. Batasnya: metode ini kurang cocok saat masalahnya belum kamu pahami.`;

const datar = `# Pendahuluan

Pada era digital ini, komunikasi yang efektif sangat penting untuk keberhasilan organisasi. Ada beberapa faktor yang mempengaruhi efektivitas komunikasi, dan perlu diketahui bahwa struktur memainkan peran penting dalam penyampaian pesan kepada audiens yang beragam di era yang serba cepat ini.

## Manfaat

Dengan demikian dapat disimpulkan bahwa struktur yang baik akan membantu pembaca memahami pesan yang disampaikan oleh penulis dalam berbagai konteks pekerjaan sehari-hari. Mari kita bahas beberapa hal terkait hal tersebut di atas.

## Kesimpulan

Pada akhirnya, pemahaman yang baik tentang struktur akan meningkatkan kualitas komunikasi kerja secara keseluruhan.`;

describe('audit kualitas pelajaran', () => {
  it('menerima tulisan bernarasi', () => {
    const report = auditLessonQuality(naratif, {
      minWords: 100,
      maxWords: 900,
    });
    expect(report.issues).toEqual([]);
    expect(report.hasContrast).toBe(true);
    expect(report.hasLimits).toBe(true);
    expect(report.hasSummary).toBe(true);
    expect(report.specifics).toBeGreaterThanOrEqual(5);
    expect(report.shortSentences).toBeGreaterThanOrEqual(6);
    expect(report.bullets).toBe(0);
  });

  it('menandai tulisan datar', () => {
    const report = auditLessonQuality(datar, { minWords: 200, maxWords: 400 });
    const issues = report.issues.join(' | ');
    expect(issues).toContain('heading generik');
    expect(issues).toContain('heading bukan level 2');
    expect(issues).toContain('kalimat pendek kurang');
    expect(issues).toContain('detail konkret kurang');
    expect(issues).toContain('tanpa kontras');
    expect(issues).toContain('tanpa bagian batas');
    expect(issues).toContain('tanpa penutup');
    expect(issues).toContain('klise');
    expect(report.hasSummary).toBe(false);
  });

  it('memakai ambang bawaan 800-1.200 kata', () => {
    expect(lessonMinWords).toBe(800);
    expect(lessonMaxWords).toBe(1200);
    const report = auditLessonQuality(naratif);
    expect(report.words).toBeGreaterThan(0);
    expect(report.words).toBeLessThan(lessonMinWords);
    expect(report.issues.join(' | ')).toContain('pendek');
  });
});
