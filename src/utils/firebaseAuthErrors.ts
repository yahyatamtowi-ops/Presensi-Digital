export interface FirebaseAuthErrorDetail {
  code: string;
  title: string;
  description: string;
  isUserCancelled: boolean;
  isUnauthorizedDomain: boolean;
  hostname: string;
  consoleAuthorizedDomainsUrl: string;
}

export function buildFirebaseAuthorizedDomainsUrl(projectId: string): string {
  const cleanId = (projectId || '').trim();
  if (!cleanId) {
    return 'https://console.firebase.google.com/';
  }
  return `https://console.firebase.google.com/project/${encodeURIComponent(cleanId)}/authentication/settings`;
}

export function extractFirebaseErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const rawCode = (error as { code?: unknown }).code;
    if (typeof rawCode === 'string' && rawCode.trim()) {
      return rawCode.trim();
    }
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const match = message.match(/\((auth\/[a-z0-9-]+)\)/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  if (message.toLowerCase().includes('unauthorized-domain')) {
    return 'auth/unauthorized-domain';
  }
  return '';
}

export function parseFirebaseAuthError(
  error: unknown,
  currentHostname: string,
  projectId: string
): FirebaseAuthErrorDetail {
  const code = extractFirebaseErrorCode(error);
  const hostname = (currentHostname || 'localhost').trim();
  const consoleAuthorizedDomainsUrl = buildFirebaseAuthorizedDomainsUrl(projectId);

  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request'
  ) {
    return {
      code,
      title: 'Login Google Dibatalkan',
      description: 'Jendela login Google ditutup sebelum proses selesai.',
      isUserCancelled: true,
      isUnauthorizedDomain: false,
      hostname,
      consoleAuthorizedDomainsUrl,
    };
  }

  if (code === 'auth/unauthorized-domain') {
    return {
      code,
      title: 'Domain Belum Diizinkan di Firebase',
      description: `Domain "${hostname}" belum terdaftar pada daftar Authorized Domains di Firebase Authentication. Tambahkan domain ini pada Firebase Console lalu coba hubungkan kembali.`,
      isUserCancelled: false,
      isUnauthorizedDomain: true,
      hostname,
      consoleAuthorizedDomainsUrl,
    };
  }

  if (code === 'auth/popup-blocked') {
    return {
      code,
      title: 'Popup Login Google Diblokir Browser',
      description:
        'Browser memblokir jendela popup login Google. Izinkan popup untuk situs ini pada bilah alamat browser, lalu klik Hubungkan kembali.',
      isUserCancelled: false,
      isUnauthorizedDomain: false,
      hostname,
      consoleAuthorizedDomainsUrl,
    };
  }

  if (code === 'auth/network-request-failed') {
    return {
      code,
      title: 'Koneksi Internet Bermasalah',
      description:
        'Tidak dapat menghubungi server login Google Firebase. Periksa koneksi internet Anda; mode offline lokal tetap dapat digunakan.',
      isUserCancelled: false,
      isUnauthorizedDomain: false,
      hostname,
      consoleAuthorizedDomainsUrl,
    };
  }

  if (code === 'auth/operation-not-allowed') {
    return {
      code,
      title: 'Metode Login Google Belum Aktif',
      description:
        'Provider Google Sign-In belum diaktifkan di Firebase Console (Authentication → Sign-in method).',
      isUserCancelled: false,
      isUnauthorizedDomain: false,
      hostname,
      consoleAuthorizedDomainsUrl,
    };
  }

  const fallbackMessage =
    error instanceof Error && error.message.trim()
      ? error.message
      : 'Pastikan popup login Google diizinkan oleh browser dan koneksi internet stabil.';

  return {
    code: code || 'auth/unknown',
    title: 'Gagal Masuk dengan Google',
    description: fallbackMessage,
    isUserCancelled: false,
    isUnauthorizedDomain: false,
    hostname,
    consoleAuthorizedDomainsUrl,
  };
}
