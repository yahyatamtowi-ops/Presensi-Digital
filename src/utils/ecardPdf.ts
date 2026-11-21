import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { AppThemeId, SchoolSettings, Student } from '../types';
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
  // Compact 86x56mm E-Card without bottom footer strip; QR Code stays full-size (29mm)
  // on the right while Principal TTD/Cap/Name/NIP sits on the bottom-left.
  return {
    cardW: 86,
    cardH: 56,
    qrSize: 29,
    rightColWidth: 32,
    principalBlockPosition: 'bottom-left',
  };
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
  const marginX = 14;
  const marginY = 10;
  const colGap = 10;
  const rowGap = 6;
  const layout = getECardLayoutMetrics();
  const cardW = (pageWidth - marginX * 2 - colGap) / 2; // 86mm
  const effectiveCardH = layout.cardH; // 56mm -> compact 8 cards per A4 page
  const [r, g, b] = getThemeAccentRgb(settings.tema);

  const [logoImg, ttdImg, capImg] = await Promise.all([
    settings.logo_sekolah ? loadImageAsDataUrlAndDims(settings.logo_sekolah, 160) : null,
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

    // Outer card border
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardW, effectiveCardH, 3, 3, 'FD');

    // Top themed header banner
    const headerH = 12.5;
    doc.setFillColor(r, g, b);
    doc.roundedRect(x, y, cardW, headerH, 3, 3, 'F');
    doc.rect(x, y + headerH - 3, cardW, 3, 'F');

    let textStartX = x + 4;
    if (logoImg) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x + 3.5, y + 1.8, 8.8, 8.8, 1.5, 1.5, 'F');
      const logoFit = fitWithinBox(logoImg.width, logoImg.height, 7.4, 7.4);
      doc.addImage(
        logoImg.dataUrl,
        logoImg.format,
        x + 3.5 + (8.8 - logoFit.w) / 2,
        y + 1.8 + (8.8 - logoFit.h) / 2,
        logoFit.w,
        logoFit.h
      );
      textStartX = x + 14.2;
    }

    doc.setTextColor(241, 245, 249);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text('KARTU TANDA SISWA ELEKTRONIK', textStartX, y + 4.7);

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const schoolTitle =
      doc.splitTextToSize(settings.nama_sekolah, cardW - (textStartX - x) - 3)[0] ||
      settings.nama_sekolah;
    doc.text(schoolTitle, textStartX, y + 9.6);

    // Full-size QR Code on the right side of card body (never shrunk!)
    const qrDataUrl = await QRCode.toDataURL(student.nis, {
      width: 280,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    qrMap[student.nis] = qrDataUrl;

    const qrSize = layout.qrSize; // 29mm constant full size
    const rightColWidth = layout.rightColWidth; // 32mm
    const rightColCenterX = x + cardW - rightColWidth / 2 - 2.5;
    const qrX = rightColCenterX - qrSize / 2;
    const qrY = y + headerH + 4.8;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(qrX - 1.2, qrY - 1.2, qrSize + 2.4, qrSize + 2.4, 1.8, 1.8, 'S');
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    doc.setFont('courier', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(71, 85, 105);
    doc.text(`NIS: ${student.nis}`, rightColCenterX, qrY + qrSize + 4.2, { align: 'center' });

    // Student details on the left side of card body
    const infoX = x + 4.2;
    const infoMaxW = cardW - rightColWidth - 9.2; // ~44.6mm
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(hasPrincipalSection ? 8.4 : 9.4);
    const nameLines = doc.splitTextToSize(student.nama, infoMaxW).slice(0, 2);
    const nameStartY = hasPrincipalSection ? y + headerH + 4.2 : y + headerH + 8.0;
    const nameLineH = hasPrincipalSection ? 3.4 : 4.2;
    doc.text(nameLines, infoX, nameStartY);

    const afterNameY = nameStartY + nameLines.length * nameLineH + (hasPrincipalSection ? 0.9 : 2.2);
    const detailStep = hasPrincipalSection ? 3.4 : 5.0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(hasPrincipalSection ? 6.8 : 7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('NIS', infoX, afterNameY);
    doc.setFont('courier', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(student.nis, infoX + 8.8, afterNameY);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Kelas', infoX, afterNameY + detailStep);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(student.kelas, infoX + 8.8, afterNameY + detailStep);

    const genderY = afterNameY + detailStep * 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(hasPrincipalSection ? 6.5 : 7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(student.gender === 'L' ? 'Siswa Putra' : 'Siswa Putri', infoX, genderY);

    // Principal Authorization Block on the LEFT directly beneath Siswa Putra / Siswa Putri
    if (hasPrincipalSection) {
      const cardBottomLimitY = y + effectiveCardH - 2.6;
      const authTopY = Math.min(Math.max(genderY + 1.8, y + headerH + 18.6), cardBottomLimitY - 19.6);
      const authMaxW = infoMaxW;
      const authCenterX = infoX + authMaxW / 2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.2);
      doc.setTextColor(100, 116, 139);
      doc.text('Kepala Sekolah', infoX, authTopY + 1.8);

      const mediaTopY = authTopY + 2.2;
      const mediaH = 9.0;

      // Transparent School Stamp (layered slightly left)
      if (capImg) {
        const capFit = fitWithinBox(capImg.width, capImg.height, 11.2, 11.2);
        const capX = ttdImg ? infoX + 2.2 : infoX + 6;
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
        const ttdFit = fitWithinBox(ttdImg.width, ttdImg.height, 26, 9.4);
        const ttdX = capImg ? infoX + 7.5 : infoX + 2;
        doc.addImage(
          ttdImg.dataUrl,
          ttdImg.format,
          Math.min(ttdX, authCenterX + authMaxW / 2 - ttdFit.w),
          mediaTopY + (mediaH - ttdFit.h) / 2,
          ttdFit.w,
          ttdFit.h
        );
      }

      let labelY = mediaTopY + mediaH + 2.4;
      if (principalName) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.setTextColor(15, 23, 42);
        const fittedName = doc.splitTextToSize(principalName, authMaxW)[0] || principalName;
        doc.text(fittedName, infoX, labelY);
        const nameW = Math.min(authMaxW, doc.getTextWidth(fittedName));
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.18);
        doc.line(infoX, labelY + 0.8, infoX + nameW, labelY + 0.8);
        labelY += 3.0;
      }

      if (principalNip) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(4.9);
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
