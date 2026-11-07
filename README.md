# 🎓 Portal Tugas & Materi Perkuliahan

Website manajemen akademik dan penyimpanan tugas kuliah modern untuk mahasiswa. Didesain secara spesifik untuk mengorganisir **semua mata kuliah**, di mana setiap mata kuliah memiliki **tugas (tugas mandiri & tugas kelompok)** serta **materi perkuliahan (slide PPT, modul PDF, catatan, link)**.

---

## ✨ Fitur Utama

### 1. 📚 Manajemen Semua Mata Kuliah
- Daftar lengkap seluruh mata kuliah per semester dengan kode, SKS, dosen pengampu, email/WhatsApp dosen, serta jadwal tatap muka (hari, jam, dan ruang kelas/link Zoom).
- Indikator warna kustom (indigo, emerald, purple, amber, rose, cyan, blue) untuk setiap mata kuliah.
- Statistik tugas aktif dan progress penyelesaian tugas per mata kuliah.
- Tambah, edit, dan hapus mata kuliah dengan mudah.

### 2. 📝 Manajemen Tugas Per Mata Kuliah (Mandiri & Kelompok)
- **Tugas Mandiri (Individual)**:
  - Judul tugas, instruksi/panduan dosen, deadline tanggal & jam, tingkat prioritas (Tinggi, Sedang, Rendah).
  - Status pengerjaan real-time (*Belum Mulai*, *Sedang Dikerjakan*, *Sudah Selesai*).
  - Lampiran file dokumen/soal dan link pengumpulan (Google Classroom, Spada, Google Drive, GitHub).
- **Tugas Kelompok (Team Project)**:
  - Nama/Nomor kelompok (misal: *Kelompok 4 - Alpha Squad*).
  - **Daftar Anggota & Checklist Pembagian Tugas**: Catat peran masing-masing anggota (misal: *Budi - Backend API*, *Siti - Frontend UI*) dan centang status selesai per anggota secara interaktif.
  - Progres tim real-time (contoh: 3 dari 4 anggota selesai).
- Notifikasi deadline mendesak (*Urgent Alert*) dan deteksi otomatis tugas terlewat (*Overdue*).

### 3. 📂 Manajemen Materi Kuliah Per Mata Kuliah
- Pengelompokan materi per pertemuan (*Pertemuan 1 s/d 16*).
- Kategori materi: **Slide Presentasi (PPT/PDF)**, **Modul / E-Book**, **Catatan Kuliah / Resume**, **Rekaman Video**, dan **Link Referensi Web**.
- Upload berkas materi nyata yang tersimpan di disk lokal (`server/uploads/`) dengan tombol unduh langsung.
- Input link eksternal (Google Drive materi dosen, YouTube rekaman kuliah, LMS kampus).

### 4. 📊 Dashboard Ringkasan & Kalender
- Kartu statistik total matkul, tugas mandiri vs kelompok yang aktif, dan materi terkumpul.
- Daftar tenggat waktu terdekat dengan countdown waktu sisa (*"Sisa 5 jam lagi"*, *"Besok, 23:59"*).
- Kalender bulanan interaktif yang memetakan deadline tugas di setiap tanggal.

### 5. 💾 Backup & Keamanan Data
- Ekspor seluruh data ke file JSON (*Download Backup*).
- Impor data kembali dari file JSON tanpa takut kehilangan riwayat tugas.
- Tampilan responsif (Laptop, Tablet, HP) dan dukungan **Mode Gelap / Terang (Dark Mode)**.

### 6. 🔐 Login (Username & Password)
- Saat pertama kali dibuka, website meminta kamu **membuat akun pertama** (username + password minimal 6 karakter).
- Setelah akun dibuat, pendaftaran ditutup dan website hanya bisa dibuka dengan login. Semua data tugas, materi, dan file upload ikut terlindungi.
- Password disimpan dalam bentuk hash (bukan teks asli) di `server/data/users.json`. Sesi login bertahan 30 hari, dan ada tombol **Logout** di pojok kanan atas.
- Percobaan login salah dibatasi: 5 kali gagal akan dikunci selama 15 menit.
- **Lupa password?** Hapus file `server/data/users.json` lalu buka website lagi untuk membuat akun baru. Data tugas tidak ikut terhapus.

### 7. 🔔 Pengingat Tugas Belum Selesai
- **Lonceng notifikasi** di bar atas dengan angka jumlah tugas yang perlu perhatian, berisi daftar: terlewat, kurang dari 24 jam, dan 3 hari ke depan. Klik tugas untuk langsung membukanya.
- **Popup pengingat** muncul di pojok layar saat kamu membuka website jika ada tugas terlewat atau deadline kurang dari 24 jam. Popup juga muncul sendiri saat sebuah tugas baru masuk ke kondisi mendesak ketika halaman sedang terbuka.
- **Banner di Dashboard** untuk tugas terlewat (merah) dan tugas dengan deadline kurang dari 24 jam (oranye).
- **Tanda warna** pada kartu tugas yang belum selesai (di Dashboard, Semua Tugas, detail Mata Kuliah, dan Kalender):
  - 🔴 Merah: sudah melewati deadline
  - 🟠 Oranye: kurang dari 24 jam
  - 🟡 Kuning: 3 hari ke depan
  - 🔵 Biru: belum selesai, deadline masih lama
  - 🟢 Hijau: sudah selesai
- Warna dan sisa waktu diperbarui otomatis setiap 1 menit tanpa perlu refresh.

---

## 🚀 Cara Menjalankan Website

### Cara Cepat (Windows):
Cukup **klik ganda (double click)** file:
👉 **`Jalankan_Website.bat`**

Browser akan otomatis terbuka di `http://localhost:5000`.

---

### Cara Melalui Terminal:

1. **Jalankan Aplikasi:**
   ```bash
   node server/index.js
   ```
   Buka browser di: `http://localhost:5000`

2. **Mode Pengembang (Development Hot-Reload):**
   - Terminal 1 (Backend):
     ```bash
     node server/index.js
     ```
   - Terminal 2 (Frontend):
     ```bash
     cd client
     npm run dev
     ```
     Buka browser di: `http://localhost:5173`

---

## 📁 Struktur Direktori

```
WEB TUGAS PERKULIAHAN/
├── client/                     # Frontend (React 18 + Vite + Tailwind CSS + Lucide Icons)
│   ├── src/
│   │   ├── components/         # Komponen UI (Navbar, Sidebar, Modals, Views)
│   │   │   ├── CourseDetailView.jsx   # Detail Matkul (Tugas Mandiri/Kelompok & Materi)
│   │   │   ├── DashboardView.jsx      # Beranda & Statistik
│   │   │   ├── CoursesView.jsx        # Daftar Semua Mata Kuliah
│   │   │   ├── TasksView.jsx          # Filter Semua Tugas
│   │   │   ├── MaterialsView.jsx      # Arsip Materi
│   │   │   ├── CalendarView.jsx       # Kalender Deadline
│   │   │   ├── TaskModal.jsx          # Form Tambah/Edit Tugas
│   │   │   ├── MaterialModal.jsx      # Form Tambah/Edit Materi
│   │   │   ├── CourseModal.jsx        # Form Tambah/Edit Matkul
│   │   │   ├── BackupModal.jsx        # Backup & Restore JSON
│   │   │   ├── LoginPage.jsx          # Halaman Login / Buat Akun
│   │   │   ├── NotificationBell.jsx   # Lonceng Pengingat Tugas
│   │   │   ├── ReminderToast.jsx      # Popup Pengingat
│   │   │   └── TaskAlertBadge.jsx     # Lencana Warna Deadline
│   │   ├── services/api.js     # API Client Fetch
│   │   └── utils/helpers.js    # Format Tanggal & Deadline Indonesia, Warna
│   └── dist/                   # Hasil build siap saji
├── server/                     # Backend API (Node.js + Express + Multer)
│   ├── index.js                # Server REST API & Static Serving
│   ├── data/
│   │   ├── db.json             # Penyimpanan Database JSON Lokal
│   │   └── users.json          # Akun login (dibuat otomatis, password ter-hash)
│   └── uploads/                # Berkas upload materi & lampiran tugas
├── Jalankan_Website.bat        # Skrip sekali klik untuk Windows
└── Jalankan_Mode_Dev.bat       # Skrip sekali klik untuk Dev
```
