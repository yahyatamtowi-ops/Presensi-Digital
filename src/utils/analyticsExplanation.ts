import type { AnalyticsPeriodType } from '../types';
import type {
  ClassAnalyticsRow,
  PeriodAnalyticsOverview,
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

function classifyAttendanceLevel(pct: number): string {
  if (pct >= 90) return 'Sangat Baik';
  if (pct >= 75) return 'Baik';
  if (pct >= 50) return 'Perlu Pantauan';
  return 'Perlu Tindakan Segera';
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
    'Belum ada catatan presensi pada rentang periode yang dipilih. Setelah siswa melakukan presensi, grafik akan membandingkan persentase kehadiran secara otomatis.';

  if (populated.length > 0) {
    const highest = populated.reduce((best, cur) =>
      cur.kehadiranPct > best.kehadiranPct ? cur : best
    );
    const lowest = populated.reduce((worst, cur) =>
      cur.kehadiranPct < worst.kehadiranPct ? cur : worst
    );

    const activePart =
      selected.totalTercatat > 0
        ? `Periode ${selected.shortLabel} saat ini mencatat kehadiran ${selected.kehadiranPct}% (${classifyAttendanceLevel(
            selected.kehadiranPct
          )}) dari ${selected.totalTercatat} catatan (${selected.hadir} hadir tepat waktu, ${
            selected.terlambat
          } terlambat).`
        : `Periode ${selected.shortLabel} belum memiliki catatan presensi.`;

    if (populated.length === 1) {
      dynamicSummary = activePart;
    } else if (highest.kehadiranPct === lowest.kehadiranPct) {
      dynamicSummary = `${activePart} Seluruh periode yang memiliki data saat ini stabil di angka ${highest.kehadiranPct}%.`;
    } else {
      const gap = highest.kehadiranPct - lowest.kehadiranPct;
      dynamicSummary = `${activePart} Persentase tertinggi tercatat pada periode ${highest.shortLabel} (${highest.kehadiranPct}%) dan terendah pada periode ${lowest.shortLabel} (${lowest.kehadiranPct}%, selisih ${gap} poin).`;
    }
  }

  return {
    headline: 'Cara Membaca Perbandingan Persentase Kehadiran',
    formulaNote:
      'Persentase kehadiran dihitung dari jumlah siswa Hadir tepat waktu ditambah Terlambat, lalu dibagi total catatan presensi pada periode tersebut.',
    colorLegend:
      'Hijau ≥ 90% (Sangat Baik) · Indigo 75–89% (Baik) · Kuning 50–74% (Perlu Pantauan) · Merah < 50% (Perlu Tindakan). Batang berwarna Indigo gelap menandakan periode yang sedang dipilih.',
    dynamicSummary,
    interactionHint:
      'Klik salah satu batang periode (Harian, Mingguan, Bulanan, Semester, atau Tahunan) untuk melihat rincian distribusi status dan daftar siswa pada periode tersebut.',
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
      (a, b) => b.kehadiranPct - a.kehadiranPct || b.totalTercatat - a.totalTercatat
    );
    const topClass = sorted[0];
    const bottomClass = sorted[sorted.length - 1];
    const avgPct = Math.round(
      activeClasses.reduce((sum, item) => sum + item.kehadiranPct, 0) / activeClasses.length
    );
    const attentionClasses = activeClasses.filter((c) => c.kehadiranPct < 75);

    if (activeClasses.length === 1) {
      dynamicSummary = `Pada periode ${periodName}, kelas ${topClass.kelas} mencatat kehadiran ${topClass.kehadiranPct}% (${classifyAttendanceLevel(
        topClass.kehadiranPct
      )}) dengan rincian H:${topClass.hadir}, T:${topClass.terlambat}, S:${topClass.sakit}, I:${topClass.izin}, A:${topClass.alpa}.`;
    } else {
      dynamicSummary = `Rata-rata kehadiran dari ${activeClasses.length} kelas aktif pada periode ${periodName} adalah ${avgPct}%. Kelas tertinggi adalah ${topClass.kelas} (${topClass.kehadiranPct}%), sedangkan kelas terendah adalah ${bottomClass.kelas} (${bottomClass.kehadiranPct}%).`;
    }

    if (attentionClasses.length > 0) {
      const names = attentionClasses
        .slice(0, 3)
        .map((c) => `${c.kelas} (${c.kehadiranPct}%)`)
        .join(', ');
      actionNote = `Terdapat ${attentionClasses.length} kelas dengan kehadiran di bawah 75%: ${names}. Disarankan koordinasi dengan wali kelas untuk menindaklanjuti siswa yang sering alpa atau terlambat.`;
    } else {
      actionNote = `Seluruh ${activeClasses.length} kelas aktif berada pada kategori Baik hingga Sangat Baik (≥ 75%). Pertahankan kedisiplinan harian di setiap kelas.`;
    }
  }

  return {
    headline: `Cara Membaca Persentase per Kelas (${periodName})`,
    legendNote:
      'Setiap batang menampilkan persentase kehadiran kelas pada periode aktif. Keterangan angka di bawah batang: H = Hadir tepat waktu, T = Terlambat, S = Sakit, I = Izin, A = Alpa (tanpa keterangan).',
    dynamicSummary,
    actionNote,
  };
}
