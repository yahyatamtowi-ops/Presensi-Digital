import type { AnalyticsPeriodType } from '../types';
import {
  evaluateAttendanceCategory,
  type ClassAnalyticsRow,
  type PeriodAnalyticsOverview,
} from './attendanceLogic';

export interface AttendanceComparisonExplanation {
  headline: string;
  formulaNote: string;
  colorLegend: string;
  dynamicSummary: string;
  interactionHint: string;
}

export interface ClassAttendanceExplanation {
  headline: string;
  legendNote: string;
  dynamicSummary: string;
  actionNote: string;
}

const PERIOD_SEQUENCE: AnalyticsPeriodType[] = [
  'harian',
  'mingguan',
  'bulanan',
  'semester',
  'tahunan',
];

function getPeriodScore(ov: PeriodAnalyticsOverview): number {
  return ov.skorKehadiranPct ?? ov.kehadiranPct;
}

function getClassScore(cls: ClassAnalyticsRow): number {
  return cls.skorKehadiranPct ?? cls.kehadiranPct;
}

export function buildAttendanceComparisonExplanation(
  overviews: Record<AnalyticsPeriodType, PeriodAnalyticsOverview>,
  selectedPeriod: AnalyticsPeriodType
): AttendanceComparisonExplanation {
  const selected = overviews[selectedPeriod];
  const populated = PERIOD_SEQUENCE.map((key) => overviews[key]).filter(
    (row) => row.totalTercatat > 0
  );

  let dynamicSummary =
    'Belum ada catatan presensi pada rentang periode yang dipilih. Setelah siswa melakukan presensi, grafik akan membandingkan skor kehadiran secara adil berdasarkan ketepatan waktu.';

  if (populated.length > 0) {
    const highest = populated.reduce((best, cur) =>
      getPeriodScore(cur) > getPeriodScore(best) ? cur : best
    );
    const lowest = populated.reduce((worst, cur) =>
      getPeriodScore(cur) < getPeriodScore(worst) ? cur : worst
    );

    const selectedScore = getPeriodScore(selected);
    const selectedCategory = evaluateAttendanceCategory({
      hadir: selected.hadir,
      terlambat: selected.terlambat,
      sakit: selected.sakit,
      izin: selected.izin,
      alpa: selected.alpa,
      totalTercatat: selected.totalTercatat,
      denom:
        selected.period === 'harian' && selected.totalSiswa > 0
          ? selected.totalSiswa
          : selected.totalTercatat,
      skorKehadiranPct: selectedScore,
      tepatWaktuPct: selected.tepatWaktuPct,
      penalizedIzinDays: selected.penalizedIzinDays,
      penalizedSakitDays: selected.penalizedSakitDays,
    });

    const activePart =
      selected.totalTercatat > 0
        ? `Periode ${selected.shortLabel} mencatat skor kehadiran ${selectedScore}% (${selectedCategory.label}) dengan ketepatan waktu ${selected.tepatWaktuPct}% dari ${selected.totalTercatat} catatan (${selected.hadir} hadir tepat waktu, ${selected.terlambat} terlambat, ${selected.sakit} sakit, ${selected.izin} izin, ${selected.alpa} alpa).`
        : `Periode ${selected.shortLabel} belum memiliki catatan presensi.`;

    if (populated.length === 1) {
      dynamicSummary = activePart;
    } else if (getPeriodScore(highest) === getPeriodScore(lowest)) {
      dynamicSummary = `${activePart} Seluruh periode yang memiliki data saat ini stabil di skor ${getPeriodScore(
        highest
      )}%.`;
    } else {
      const gap = getPeriodScore(highest) - getPeriodScore(lowest);
      dynamicSummary = `${activePart} Skor tertinggi tercatat pada periode ${highest.shortLabel} (${getPeriodScore(
        highest
      )}%) dan terendah pada periode ${lowest.shortLabel} (${getPeriodScore(
        lowest
      )}%, selisih ${gap} poin).`;
    }
  }

  return {
    headline: 'Cara Membaca Perbandingan Skor Kehadiran',
    formulaNote:
      'Hadir Tepat Waktu bernilai penuh (100%). Nilai Kurang Baik berlaku untuk Terlambat (50%), Alpa (0%), Izin lebih dari 7 kali dalam sebulan, dan Sakit lebih dari 7 hari berturut-turut. Izin ≤ 7×/bulan dan Sakit ≤ 7 hari berturut-turut tidak menurunkan nilai.',
    colorLegend:
      'Hijau: Sangat Baik (tepat waktu ≥ 90%, tanpa Alpa, izin/sakit wajar) · Biru: Baik (skor & tepat waktu ≥ 75%, tanpa Alpa) · Kuning: Cukup (skor ≥ 60%, tepat waktu > terlambat) · Oranye: Kurang Baik (Terlambat dominan, Alpa > 10%, Izin > 7×/bulan, atau Sakit > 7 hari berturut-turut) · Merah: Perlu Perhatian (skor < 40% atau Alpa ≥ 30%).',
    dynamicSummary,
    interactionHint:
      'Klik salah satu batang periode (Harian, Mingguan, Bulanan, Semester, atau Tahunan) untuk melihat rincian distribusi status dan daftar kategori siswa pada periode tersebut.',
  };
}

export function buildClassAttendanceExplanation(
  classAnalytics: ClassAnalyticsRow[],
  selectedOverview: PeriodAnalyticsOverview
): ClassAttendanceExplanation {
  const periodName = selectedOverview.shortLabel;
  const activeClasses = classAnalytics.filter((c) => c.totalTercatat > 0);

  let dynamicSummary = `Belum ada catatan presensi kelas pada periode ${periodName} (${selectedOverview.subtitle}).`;
  let actionNote =
    'Data perbandingan antarkelas akan muncul otomatis setelah presensi masuk tercatat.';

  if (activeClasses.length > 0) {
    const sorted = [...activeClasses].sort(
      (a, b) =>
        getClassScore(b) - getClassScore(a) ||
        b.tepatWaktuPct - a.tepatWaktuPct ||
        b.totalTercatat - a.totalTercatat
    );
    const topClass = sorted[0];
    const bottomClass = sorted[sorted.length - 1];
    const avgPct = Math.round(
      activeClasses.reduce((sum, item) => sum + getClassScore(item), 0) / activeClasses.length
    );
    const lowTierClasses = activeClasses.filter((c) => {
      const cat = evaluateAttendanceCategory({
        hadir: c.hadir,
        terlambat: c.terlambat,
        sakit: c.sakit,
        izin: c.izin,
        alpa: c.alpa,
        totalTercatat: c.totalTercatat,
        denom:
          selectedOverview.period === 'harian' && c.totalSiswa > 0
            ? c.totalSiswa
            : c.totalTercatat,
        skorKehadiranPct: getClassScore(c),
        tepatWaktuPct: c.tepatWaktuPct,
        penalizedIzinDays: c.penalizedIzinDays,
        penalizedSakitDays: c.penalizedSakitDays,
      });
      return cat.tier === 'kurang_baik' || cat.tier === 'perlu_perhatian';
    });

    if (activeClasses.length === 1) {
      const cat = evaluateAttendanceCategory({
        hadir: topClass.hadir,
        terlambat: topClass.terlambat,
        sakit: topClass.sakit,
        izin: topClass.izin,
        alpa: topClass.alpa,
        totalTercatat: topClass.totalTercatat,
        denom:
          selectedOverview.period === 'harian' && topClass.totalSiswa > 0
            ? topClass.totalSiswa
            : topClass.totalTercatat,
        skorKehadiranPct: getClassScore(topClass),
        tepatWaktuPct: topClass.tepatWaktuPct,
        penalizedIzinDays: topClass.penalizedIzinDays,
        penalizedSakitDays: topClass.penalizedSakitDays,
      });
      dynamicSummary = `Pada periode ${periodName}, kelas ${topClass.kelas} mencatat skor kehadiran ${getClassScore(
        topClass
      )}% (${cat.label}, tepat waktu ${topClass.tepatWaktuPct}%) dengan rincian H:${topClass.hadir}, T:${topClass.terlambat}, S:${topClass.sakit}, I:${topClass.izin}, A:${topClass.alpa}.`;
    } else {
      dynamicSummary = `Rata-rata skor kehadiran dari ${activeClasses.length} kelas aktif pada periode ${periodName} adalah ${avgPct}%. Kelas tertinggi adalah ${topClass.kelas} (${getClassScore(
        topClass
      )}%, tepat waktu ${topClass.tepatWaktuPct}%), sedangkan kelas terendah adalah ${bottomClass.kelas} (${getClassScore(
        bottomClass
      )}%).`;
    }

    if (lowTierClasses.length > 0) {
      const names = lowTierClasses
        .slice(0, 3)
        .map((c) => `${c.kelas} (${getClassScore(c)}%)`)
        .join(', ');
      actionNote = `Terdapat ${lowTierClasses.length} kelas pada kategori Kurang Baik / Perlu Perhatian: ${names}. Disarankan koordinasi dengan wali kelas untuk menindaklanjuti siswa yang terlambat, alpa, izin > 7×/bulan, atau sakit > 7 hari berturut-turut.`;
    } else {
      actionNote = `Seluruh ${activeClasses.length} kelas aktif berada pada kategori Cukup hingga Sangat Baik. Terus dorong siswa hadir tepat waktu agar mencapai kategori Sangat Baik (≥ 90% tepat waktu).`;
    }
  }

  return {
    headline: `Cara Membaca Skor Kehadiran per Kelas (${periodName})`,
    legendNote:
      'Penilaian kurang baik berlaku untuk Terlambat, Alpa, Izin > 7×/bulan, dan Sakit > 7 hari berturut-turut. Keterangan: H = Hadir tepat waktu, T = Terlambat, S = Sakit, I = Izin, A = Alpa.',
    dynamicSummary,
    actionNote,
  };
}
