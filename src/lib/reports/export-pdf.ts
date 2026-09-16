import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatSequentialNumber } from "@/lib/reports/sequential-number";
import type { ReportsReceiptPayload } from "@/lib/reports/export-data";
import {
  PDF_PAGE_MARGIN,
  PDF_PRIMARY,
  PDF_SUCCESS,
  PDF_MUTED,
  drawPdfCompanyHeader,
  drawPdfPageFooters,
  ensurePdfSpace,
  getPdfAutoTableFinalY,
  loadPdfLogoImage,
  pdfFileSlug,
  pdfMoney,
} from "@/lib/pdf/brand";

export async function exportReceiptToPdf(payload: ReportsReceiptPayload) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const logo = payload.meta.workshop.logoUrl
    ? await loadPdfLogoImage(payload.meta.workshop.logoUrl)
    : null;
  let y = drawPdfCompanyHeader(doc, {
    workshop: payload.meta.workshop,
    logo,
    documentTitle: "Comprovante de Prestação de Serviço",
    rightLines: [
      `Período: ${payload.meta.periodLabel}`,
      `Referente a: ${payload.meta.clientLabel}`,
    ],
  });

  if (payload.groups.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...PDF_MUTED);
    doc.text("Nenhum lançamento selecionado para este comprovante.", PDF_PAGE_MARGIN, y + 6);
  }

  payload.groups.forEach((group) => {
    y = ensurePdfSpace(doc, y, 40);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_PRIMARY);
    doc.text(group.clientName, PDF_PAGE_MARGIN, y);
    y += 5;

    const contactParts = [
      group.clientDocument ? `Documento: ${group.clientDocument}` : null,
      group.clientPhone ?? null,
      group.clientAddress ?? null,
    ].filter(Boolean);

    if (contactParts.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...PDF_MUTED);
      const contactLines = doc.splitTextToSize(
        contactParts.join(" · "),
        doc.internal.pageSize.getWidth() - PDF_PAGE_MARGIN * 2
      );
      doc.text(contactLines, PDF_PAGE_MARGIN, y);
      y += contactLines.length * 4 + 2;
    }

    y += 2;
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_PAGE_MARGIN, right: PDF_PAGE_MARGIN },
      head: [["Nº", "Data", "Serviço", "Valor"]],
      body: group.rows.map((row) => [
        formatSequentialNumber(row.type, row.sequentialNumber),
        row.date,
        row.description,
        pdfMoney(row.amount),
      ]),
      headStyles: { fillColor: PDF_PRIMARY, textColor: 255 },
      styles: { fontSize: 8.5 },
      columnStyles: {
        0: { cellWidth: 22 },
        3: { halign: "right" },
      },
    });
    y = getPdfAutoTableFinalY(doc) + 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_SUCCESS);
    doc.text(
      `Subtotal: ${pdfMoney(group.subtotal)}`,
      doc.internal.pageSize.getWidth() - PDF_PAGE_MARGIN,
      y,
      { align: "right" }
    );
    y += 10;
  });

  y = ensurePdfSpace(doc, y, 20);
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_PRIMARY);
  doc.roundedRect(PDF_PAGE_MARGIN, y, pageWidth - PDF_PAGE_MARGIN * 2, 14, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL GERAL", PDF_PAGE_MARGIN + 5, y + 9);
  doc.text(pdfMoney(payload.grandTotal), pageWidth - PDF_PAGE_MARGIN - 5, y + 9, {
    align: "right",
  });

  drawPdfPageFooters(
    doc,
    `Comprovante emitido em ${payload.meta.generatedAtLabel} · ${payload.meta.workshop.name}`
  );

  doc.save(`comprovante-${pdfFileSlug(payload.meta.clientLabel)}.pdf`);
}
