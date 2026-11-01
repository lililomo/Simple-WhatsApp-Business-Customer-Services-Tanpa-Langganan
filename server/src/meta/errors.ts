// Kode error WhatsApp Cloud API → pesan untuk petugas. Diperiksa terhadap halaman "Error codes" Meta.
const messages: Record<number, string> = {
  0: 'Gagal autentikasi ke Meta. Periksa token.',
  3: 'Aplikasi Meta tidak punya izin untuk tindakan ini.',
  10: 'Izin token tidak mencukupi. Pastikan system user punya whatsapp_business_messaging dan whatsapp_business_management.',
  100: 'Parameter tidak valid atau ID tidak ditemukan. Periksa WABA ID / Phone Number ID.',
  190: 'Token Meta tidak valid atau kedaluwarsa. Admin perlu memperbarui token.',
  200: 'Token tidak punya akses ke akun WhatsApp ini.',
  368: 'Akun dibatasi sementara oleh Meta karena pelanggaran kebijakan.',
  130429: 'Batas kecepatan kirim tercapai. Coba lagi sebentar lagi.',
  131000: 'Terjadi kesalahan di Meta. Coba lagi.',
  131005: 'Akses ditolak Meta. Periksa izin token.',
  131008: 'Parameter wajib tidak lengkap.',
  131009: 'Nilai parameter tidak valid.',
  131016: 'Layanan WhatsApp sedang tidak tersedia. Coba lagi nanti.',
  131021: 'Pengirim dan penerima tidak boleh nomor yang sama.',
  131026: 'Pesan tidak bisa diterima nomor ini (bukan pengguna WhatsApp atau aplikasinya terlalu lama).',
  131031: 'Akun WhatsApp Business dikunci Meta. Hubungi admin.',
  131042: 'Masalah metode pembayaran akun WhatsApp Business. Hubungi admin.',
  131045: 'Nomor pengirim belum terdaftar di Cloud API.',
  131047: 'Lebih dari 24 jam sejak pesan terakhir pelanggan. Kirim template.',
  131049: 'Meta menahan pesan marketing ini untuk menjaga keterlibatan pengguna. Coba lagi nanti.',
  131051: 'Jenis pesan tidak didukung.',
  131052: 'Gagal mengunduh media dari pengirim.',
  131053: 'Gagal mengunggah media. Periksa format dan ukuran file.',
  131056: 'Terlalu banyak pesan ke nomor yang sama dalam waktu singkat.',
  132000: 'Jumlah variabel template tidak sesuai.',
  132001: 'Template tidak ditemukan untuk bahasa ini, atau belum disetujui.',
  132005: 'Teks template setelah diisi terlalu panjang.',
  132007: 'Isi template melanggar kebijakan format.',
  132012: 'Format parameter template tidak sesuai.',
  132015: 'Template sedang dijeda karena kualitas rendah.',
  132016: 'Template dinonaktifkan karena kualitas rendah.',
  133010: 'Nomor belum terdaftar di Cloud API. Daftarkan dengan PIN di Pengaturan → WhatsApp.',
  135000: 'Kesalahan umum Meta. Coba lagi.',
};

export function metaErrorMessage(code: number | undefined, fallback?: string): string {
  if (code !== undefined && messages[code]) return messages[code];
  return fallback || 'Permintaan ke Meta gagal.';
}

export const TOKEN_INVALID_CODES = new Set([190]);
