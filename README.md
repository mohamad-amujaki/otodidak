# Otodidak

Satu Worker untuk jalur belajar berbahasa Indonesia. Antarmuka Astro, API Hono, data D1 lewat Drizzle, antrian penyusunan, dan Tailwind.

## Perintah

```bash
npm ci
npm run dev
npm run check
npm run typecheck
npm run test
npm run build
```

`npm run dev` menerapkan migrasi D1 lokal, lalu menjalankan server. Salin `.dev.vars.example` menjadi `.dev.vars`. Nilai `mock` tidak memanggil Clerk, Sumopod, Brave, YouTube, atau model sungguhan.

Email `admin@example.com` menjadi admin saat kunci Clerk masih `mock`.

## Yang masih percobaan

Rahasia sungguhan tidak ada di mesin ini.

- Clerk: verifikasi sesi sungguhan jalan hanya jika `CLERK_SECRET_KEY` bukan `mock`. Lokal memakai cookie bertanda `otodidak_dev`.
- Sumopod: `POST /payments` jalan jika `SUMOPOD_API_KEY` bukan `mock`. Lokal punya tombol yang menandatangani webhook yang sama.
- Pencarian: klien Brave dan YouTube ada. Tanpa kunci, mode `mock` mengembalikan tautan contoh.
- Model: pemanggilan OpenAI-compatible ada. Kunci `mock` mengembalikan JSON tetap. Adapter `workers_ai_binding` belum diisi; pekerjaan itu gagal lalu kreditnya dikembalikan.

Angka 24 di beranda adalah kredit awal bawaan, karena halaman itu statis. Saldo sungguhan dibaca dari D1 di halaman yang masuk.

`database_id` D1 dan id KV di `wrangler.toml` adalah penampung. Ganti sebelum deploy, bersama `APP_ORIGIN` dan `CLERK_PUBLISHABLE_KEY`.

Status jalur `draft` dipakai hanya selagi antrian menyusun kerangka. Jalur yang gagal dihapus. Pustaka hanya menampilkan yang `ready`.
