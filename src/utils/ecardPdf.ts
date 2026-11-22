import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { AppThemeId, SchoolSettings, Student } from '../types';
import { DEFAULT_SCHOOL_LOGO } from './seedData';
import { getThemeAccentRgbFromCatalog } from './themes';

export function getThemeAccentRgb(tema?: AppThemeId): [number, number, number] {
  return getThemeAccentRgbFromCatalog(tema);
}

export interface LoadedPdfImage {
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

export function loadImageAsDataUrlAndDims(
  src: string,
  maxDim = 320
): Promise<LoadedPdfImage | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || img.width || 128;
        const naturalH = img.naturalHeight || img.height || 128;
        const ratio = Math.min(1, maxDim / Math.max(naturalW, naturalH));
        const w = Math.max(1, Math.round(naturalW * ratio));
        const h = Math.max(1, Math.round(naturalH * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        // Preserve full alpha transparency for PNG signatures & school stamps
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          format: 'PNG',
          width: w,
          height: h,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fitWithinBox(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number
): { w: number; h: number } {
  const safeW = Math.max(1, imgW);
  const safeH = Math.max(1, imgH);
  const scale = Math.min(maxW / safeW, maxH / safeH);
  return {
    w: safeW * scale,
    h: safeH * scale,
  };
}

export interface ECardLayoutMetrics {
  cardW: number;
  cardH: number;
  qrSize: number;
  rightColWidth: number;
  principalBlockPosition: 'bottom-left';
}

export function getECardLayoutMetrics(): ECardLayoutMetrics {
  // Standard KTP / ISO-IEC 7810 ID-1 size: 8.56 cm x 5.4 cm (85.6 mm x 54.0 mm)
  // Full-size scannable QR Code (27.5 mm) on the right while Principal TTD/Cap/Name/NIP
  // sits cleanly on the bottom-left beneath Siswa Putra/Putri.
  return {
    cardW: 85.6,
    cardH: 54,
    qrSize: 27.5,
    rightColWidth: 30.5,
    principalBlockPosition: 'bottom-left',
  };
}

/**
 * Fits any text onto strictly ONE line within maxWidthMm by shrinking font size down to
 * minFontSize first, and truncating with an ellipsis only if it still exceeds maxWidthMm.
 */
export function fitSingleLineText(
  text: string,
  maxWidthMm: number,
  initialFontSize: number,
  minFontSize: number,
  measureWidth: (str: string, fontSize: number) => number
): { text: string; fontSize: number } {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { text: '', fontSize: initialFontSize };
  }

  let fontSize = initialFontSize;
  while (fontSize > minFontSize && measureWidth(cleaned, fontSize) > maxWidthMm) {
    fontSize = Math.max(minFontSize, Math.round((fontSize - 0.2) * 10) / 10);
  }

  if (measureWidth(cleaned, fontSize) <= maxWidthMm) {
    return { text: cleaned, fontSize };
  }

  // Still slightly too wide at minimum font size -> trim cleanly with ellipsis on 1 line
  const ellipsis = '…';
  let end = cleaned.length;
  while (end > 1 && measureWidth(`${cleaned.slice(0, end).trimEnd()}${ellipsis}`, fontSize) > maxWidthMm) {
    end -= 1;
  }
  return {
    text: `${cleaned.slice(0, Math.max(1, end)).trimEnd()}${ellipsis}`,
    fontSize,
  };
}

/**
 * Adaptive Tailwind typography class ensuring student names fit cleanly on 1 line
 * inside KTP-proportioned E-Card previews without ever wrapping to 2 lines.
 */
export function getECardNameFontSizeClass(
  name: string,
  variant: 'batch' | 'single'
): string {
  const len = name.trim().length;
  if (variant === 'single') {
    if (len > 36) return 'text-[10.5px]';
    if (len > 30) return 'text-[11px]';
    if (len > 24) return 'text-xs';
    if (len > 19) return 'text-[13px]';
    return 'text-sm';
  }
  if (len > 35) return 'text-[8.5px] tracking-tight';
  if (len > 28) return 'text-[9.5px] tracking-tight';
  if (len > 22) return 'text-[11px]';
  if (len > 18) return 'text-xs';
  return 'text-[13px]';
}

export async function generateECardsPdf(
  students: Student[],
  settings: SchoolSettings
): Promise<{ blobUrl: string; blob: Blob; qrMap: Record<string, string> }> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const colGap = 10;
  const layout = getECardLayoutMetrics();
  const cardW = layout.cardW; // Exact 85.6 mm (8.56 cm)
  const effectiveCardH = layout.cardH; // Exact 54.0 mm (5.4 cm)
  const marginX = (pageWidth - cardW * 2 - colGap) / 2; // 14.4 mm centered on A4
  const marginY = 12;
  const rowGap = 8; // 12*2 + 54*4 + 8*3 = 264 mm <= 297 mm A4 portrait (8 cards/page)
  const [r, g, b] = getThemeAccentRgb(settings.tema);

  const [logoImg, ttdImg, capImg] = await Promise.all([
    loadImageAsDataUrlAndDims(settings.logo_sekolah || DEFAULT_SCHOOL_LOGO, 160),
    settings.ttd_kepala_sekolah
      ? loadImageAsDataUrlAndDims(settings.ttd_kepala_sekolah, 360)
      : null,
    settings.cap_sekolah ? loadImageAsDataUrlAndDims(settings.cap_sekolah, 320) : null,
  ]);

  const principalName = (settings.nama_kepala_sekolah || '').trim();
  const principalNip = (settings.nip_kepala_sekolah || '').trim();
  const hasPrincipalSection = Boolean(principalName || principalNip || ttdImg || capImg);

  const qrMap: Record<string, string> = {};

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const indexOnPage = i % 8;
    if (i > 0 && indexOnPage === 0) {
      doc.addPage();
    }

    const col = indexOnPage % 2;
    const row = Math.floor(indexOnPage / 2);
    const x = marginX + col * (cardW + colGap);
    const y = marginY + row * (effectiveCardH + rowGap);

    // Outer card border (exact ISO/ID-1 KTP radius ~3.18mm -> 3mm)
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardW, effectiveCardH, 3, 3, 'FD');

    // Top themed header banner
    const headerH = 11.8;
    doc.setFillColor(r, g, b);
    doc.roundedRect(x, y, cardW, headerH, 3, 3, 'F');
    doc.rect(x, y + headerH - 3, cardW, 3, 'F');

    let textStartX = x + 4;
    if (logoImg) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x + 3.4, y + 1.6, 8.4, 8.4, 1.4, 1.4, 'F');
      const logoFit = fitWithinBox(logoImg.width, logoImg.height, 7.0, 7.0);
      doc.addImage(
        logoImg.dataUrl,
        logoImg.format,
        x + 3.4 + (8.4 - logoFit.w) / 2,
        y + 1.6 + (8.4 - logoFit.h) / 2,
        logoFit.w,
        logoFit.h
      );
      textStartX = x + 13.6;
    }

    doc.setTextColor(241, 245, 249);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.text('KARTU TANDA SISWA ELEKTRONIK', textStartX, y + 4.4);

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    const fittedSchool = fitSingleLineText(
      settings.nama_sekolah,
      cardW - (textStartX - x) - 3,
      7.8,
      5.8,
      (str, size) => {
        doc.setFontSize(size);
        return doc.getTextWidth(str);
      }
    );
    doc.setFontSize(fittedSchool.fontSize);
    doc.text(fittedSchool.text, textStartX, y + 9.2);

    // Full-size QR Code on the right side of card body
    const qrDataUrl = await QRCode.toDataURL(student.nis, {
      width: 280,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    qrMap[student.nis] = qrDataUrl;

    const qrSize = layout.qrSize; // 27.5 mm
    const rightColWidth = layout.rightColWidth; // 30.5 mm
    const rightColCenterX = x + cardW - rightColWidth / 2 - 2.4;
    const qrX = rightColCenterX - qrSize / 2;
    const qrY = y + headerH + 4.2;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(qrX - 1.1, qrY - 1.1, qrSize + 2.2, qrSize + 2.2, 1.6, 1.6, 'S');
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    doc.setFont('courier', 'bold');
    doc.setFontSize(6.0);
    doc.setTextColor(71, 85, 105);
    doc.text(`NISN: ${student.nis}`, rightColCenterX, qrY + qrSize + 3.9, { align: 'center' });

    // Student details on the left side of card body — GUARANTEED 1-LINE NAME
    const infoX = x + 4.0;
    const infoMaxW = cardW - rightColWidth - 8.2; // ~46.9 mm
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    const fittedStudentName = fitSingleLineText(
      student.nama,
      infoMaxW,
      hasPrincipalSection ? 8.4 : 9.4,
      5.6,
      (str, size) => {
        doc.setFontSize(size);
        return doc.getTextWidth(str);
      }
    );
    doc.setFontSize(fittedStudentName.fontSize);
    const nameStartY = hasPrincipalSection ? y + headerH + 4.4 : y + headerH + 8.6;
    doc.text(fittedStudentName.text, infoX, nameStartY);

    const afterNameY = nameStartY + (hasPrincipalSection ? 3.9 : 5.4);
    const detailStep = hasPrincipalSection ? 3.3 : 4.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(hasPrincipalSection ? 6.6 : 7.4);
    doc.setTextColor(100, 116, 139);
    doc.text('NISN', infoX, afterNameY);
    doc.setFont('courier', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(student.nis, infoX + 9.2, afterNameY);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Kelas', infoX, afterNameY + detailStep);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(student.kelas, infoX + 9.2, afterNameY + detailStep);

    const genderY = afterNameY + detailStep * 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(hasPrincipalSection ? 6.3 : 7.0);
    doc.setTextColor(100, 116, 139);
    doc.text(student.gender === 'L' ? 'Siswa Putra' : 'Siswa Putri', infoX, genderY);

    // Principal Authorization Block on the LEFT directly beneath Siswa Putra / Siswa Putri
    if (hasPrincipalSection) {
      const cardBottomLimitY = y + effectiveCardH - 2.2;
      const authTopY = Math.min(Math.max(genderY + 1.7, y + headerH + 17.6), cardBottomLimitY - 18.8);
      const authMaxW = infoMaxW;
      const authCenterX = infoX + authMaxW / 2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.0);
      doc.setTextColor(100, 116, 139);
      doc.text('Kepala Sekolah', infoX, authTopY + 1.6);

      const mediaTopY = authTopY + 2.0;
      const mediaH = 8.4;

      // Transparent School Stamp (layered slightly left)
      if (capImg) {
        const capFit = fitWithinBox(capImg.width, capImg.height, 10.4, 10.4);
        const capX = ttdImg ? infoX + 2.0 : infoX + 5.5;
        doc.addImage(
          capImg.dataUrl,
          capImg.format,
          capX,
          mediaTopY + (mediaH - capFit.h) / 2,
          capFit.w,
          capFit.h
        );
      }

      // Transparent Principal Signature layered cleanly over/beside stamp
      if (ttdImg) {
        const ttdFit = fitWithinBox(ttdImg.width, ttdImg.height, 24.5, 8.8);
        const ttdX = capImg ? infoX + 7.0 : infoX + 2;
        doc.addImage(
          ttdImg.dataUrl,
          ttdImg.format,
          Math.min(ttdX, authCenterX + authMaxW / 2 - ttdFit.w),
          mediaTopY + (mediaH - ttdFit.h) / 2,
          ttdFit.w,
          ttdFit.h
        );
      }

      let labelY = mediaTopY + mediaH + 2.2;
      if (principalName) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.4);
        doc.setTextColor(15, 23, 42);
        const fittedName = doc.splitTextToSize(principalName, authMaxW)[0] || principalName;
        doc.text(fittedName, infoX, labelY);
        const nameW = Math.min(authMaxW, doc.getTextWidth(fittedName));
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.18);
        doc.line(infoX, labelY + 0.8, infoX + nameW, labelY + 0.8);
        labelY += 2.8;
      }

      if (principalNip) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(4.8);
        doc.setTextColor(71, 85, 105);
        const fittedNip =
          doc.splitTextToSize(`NIP. ${principalNip}`, authMaxW)[0] || `NIP. ${principalNip}`;
        doc.text(fittedNip, infoX, labelY);
      }
    }
  }

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, blob, qrMap };
}
