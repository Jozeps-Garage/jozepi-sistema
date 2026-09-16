import { jsPDF } from "jspdf";
import { formatCurrency } from "@/lib/utils/format";
import type { WorkshopInfo } from "@/lib/reports/types";

export const PDF_PRIMARY: [number, number, number] = [26, 39, 68];
export const PDF_PREMIUM: [number, number, number] = [201, 168, 76];
export const PDF_MUTED: [number, number, number] = [107, 101, 96];
export const PDF_FOREGROUND: [number, number, number] = [26, 26, 26];
export const PDF_BORDER: [number, number, number] = [216, 212, 204];
export const PDF_SUCCESS: [number, number, number] = [5, 150, 105];
export const PDF_PAGE_MARGIN = 14;

export interface PdfLogoImage {
  dataUrl: string;
  width: number;
  height: number;
}

const LOGO_LOAD_TIMEOUT_MS = 6000;

export function pdfMoney(value: number) {
  return formatCurrency(value).replace(/[\u00a0\u202f]/g, " ");
}

export function getPdfAutoTableFinalY(doc: jsPDF): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable?.finalY ?? 40;
}

export function loadPdfLogoImage(url: string): Promise<PdfLogoImage | null> {
  const load = new Promise<PdfLogoImage | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context || width === 0 || height === 0) {
        resolve(null);
        return;
      }

      try {
        context.drawImage(image, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width, height });
      } catch {
        resolve(null);
      }
    };

    image.onerror = () => resolve(null);
    image.src = url;
  });

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), LOGO_LOAD_TIMEOUT_MS)
  );

  return Promise.race([load, timeout]);
}

export function ensurePdfSpace(doc: jsPDF, y: number, needed = 30) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - PDF_PAGE_MARGIN) {
    doc.addPage();
    return 20;
  }
  return y;
}

export function drawPdfCompanyHeader(
  doc: jsPDF,
  options: {
    workshop: WorkshopInfo;
    logo: PdfLogoImage | null;
    documentTitle: string;
    rightLines?: string[];
  }
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const { workshop, logo, documentTitle, rightLines = [] } = options;

  const LOGO_SIZE = 20;
  const LOGO_X = PDF_PAGE_MARGIN;
  const NAME_BASELINE = 16.5;
  const NAME_CAP_HEIGHT = 4.4;
  const textTop = NAME_BASELINE - NAME_CAP_HEIGHT;
  let textBottom = NAME_BASELINE + 3.8 + 4 + 3.8;
  if (workshop.phone) textBottom += 3.8;
  const LOGO_Y = Math.max(10, (textTop + textBottom) / 2 - LOGO_SIZE / 2);
  const DIVIDER_X = LOGO_X + LOGO_SIZE + 6;
  const TEXT_X = DIVIDER_X + 6;

  if (logo) {
    const aspect = logo.width / logo.height;
    const drawWidth = aspect > 1 ? LOGO_SIZE : LOGO_SIZE * aspect;
    const drawHeight = aspect > 1 ? LOGO_SIZE / aspect : LOGO_SIZE;
    const offsetX = LOGO_X + (LOGO_SIZE - drawWidth) / 2;
    const offsetY = LOGO_Y + (LOGO_SIZE - drawHeight) / 2;
    doc.addImage(logo.dataUrl, "PNG", offsetX, offsetY, drawWidth, drawHeight);
  } else {
    doc.setFillColor(...PDF_PRIMARY);
    doc.roundedRect(LOGO_X, LOGO_Y, LOGO_SIZE, LOGO_SIZE, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    const initials = workshop.name.slice(0, 2).toUpperCase();
    doc.text(initials, LOGO_X + LOGO_SIZE / 2, LOGO_Y + LOGO_SIZE / 2 + 4.6, {
      align: "center",
    });
  }

  let textY = NAME_BASELINE;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...PDF_PRIMARY);
  doc.text(workshop.name.toUpperCase(), TEXT_X, textY);

  textY += 3.8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_PREMIUM);
  doc.text(documentTitle, TEXT_X, textY);

  textY += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_FOREGROUND);
  doc.text(
    workshop.document ? `CNPJ: ${workshop.document}` : "CNPJ não configurado",
    TEXT_X,
    textY
  );

  if (workshop.phone) {
    textY += 3.8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_MUTED);
    doc.text(workshop.phone, TEXT_X, textY);
  }

  textY += 3.8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_MUTED);
  doc.text(workshop.address ?? "Endereço não configurado", TEXT_X, textY);

  doc.setDrawColor(...PDF_BORDER);
  doc.setLineWidth(0.2);
  doc.line(
    DIVIDER_X,
    Math.min(LOGO_Y, textTop),
    DIVIDER_X,
    Math.max(textY - 2, LOGO_Y + LOGO_SIZE)
  );

  const rightX = pageWidth - PDF_PAGE_MARGIN;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_MUTED);
  rightLines.forEach((line, index) => {
    doc.text(line, rightX, 17 + index * 4.5, { align: "right" });
  });

  const dividerY = Math.max(textY, LOGO_Y + LOGO_SIZE) + 5;
  doc.setDrawColor(...PDF_PREMIUM);
  doc.setLineWidth(0.3);
  doc.line(PDF_PAGE_MARGIN, dividerY, pageWidth - PDF_PAGE_MARGIN, dividerY);

  const missingCompanyInfo = !workshop.document || !workshop.phone || !workshop.address;
  let y = dividerY + 6;
  if (missingCompanyInfo) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_MUTED);
    doc.text(
      "* Complete o CNPJ, telefone e endereço da empresa em Configurações para exibi-los aqui.",
      PDF_PAGE_MARGIN,
      y
    );
    y += 5;
  }

  return y;
}

export function drawPdfPageFooters(
  doc: jsPDF,
  leftText: string
) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_MUTED);
    doc.text(leftText, PDF_PAGE_MARGIN, pageHeight - 8);
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - PDF_PAGE_MARGIN, pageHeight - 8, {
      align: "right",
    });
  }
}

export function pdfFileSlug(label: string) {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "documento";
}
