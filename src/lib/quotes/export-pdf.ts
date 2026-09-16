import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PDF_FOREGROUND,
  PDF_MUTED,
  PDF_PAGE_MARGIN,
  PDF_PRIMARY,
  drawPdfCompanyHeader,
  drawPdfPageFooters,
  ensurePdfSpace,
  getPdfAutoTableFinalY,
  loadPdfLogoImage,
  pdfFileSlug,
  pdfMoney,
} from "@/lib/pdf/brand";
import { QUOTE_KIND_LABEL, quoteClientLabel, type Quote } from "@/lib/quotes/types";
import { DEFAULT_TIME_ZONE, formatGeneratedAt, isMissingTimezoneError, resolveTimeZone } from "@/lib/timezone";
import type { WorkshopInfo } from "@/lib/reports/types";

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function formatDateKey(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function quoteContact(quote: Quote) {
  if (quote.client_id) {
    const client = firstRelation(quote.clients);
    return [client?.phone, client?.email].filter(Boolean).join(" · ") || null;
  }
  return quote.guest_contact?.trim() || null;
}

function itemsSubtotal(quote: Quote) {
  return (quote.quote_items ?? []).reduce(
    (sum, item) => sum + (Number(item.unit_price) || 0) * (item.quantity || 1),
    0
  );
}

async function loadWorkshop(
  supabase: SupabaseClient,
  workshopId: string
): Promise<WorkshopInfo> {
  const withTimezone = await supabase
    .from("workshops")
    .select("name, document, phone, address, logo_url, timezone")
    .eq("id", workshopId)
    .maybeSingle();

  const workshop = !withTimezone.error
    ? withTimezone.data
    : isMissingTimezoneError(withTimezone.error)
      ? (
          await supabase
            .from("workshops")
            .select("name, document, phone, address, logo_url")
            .eq("id", workshopId)
            .maybeSingle()
        ).data
      : null;

  return {
    name: workshop?.name ?? "Jozep's Garage",
    document: workshop?.document ?? null,
    phone: workshop?.phone ?? null,
    address: workshop?.address ?? null,
    logoUrl: workshop?.logo_url ?? null,
    timezone: resolveTimeZone(
      workshop && "timezone" in workshop
        ? (workshop.timezone as string | null | undefined)
        : null
    ) || DEFAULT_TIME_ZONE,
  };
}

export async function exportQuoteToPdf(
  supabase: SupabaseClient,
  workshopId: string,
  quote: Quote
) {
  const workshop = await loadWorkshop(supabase, workshopId);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const logo = workshop.logoUrl ? await loadPdfLogoImage(workshop.logoUrl) : null;
  const clientLabel = quoteClientLabel(quote);
  const generatedAtLabel = formatGeneratedAt(new Date(), workshop.timezone);
  const items = quote.quote_items ?? [];
  const subtotal = itemsSubtotal(quote);
  const adjustment = Number(quote.adjustment_amount) || 0;
  const finalTotal = Number(quote.total_amount) || subtotal + adjustment;

  let y = drawPdfCompanyHeader(doc, {
    workshop,
    logo,
    documentTitle: "Orçamento",
    rightLines: [
      `Criado em: ${formatDateKey(quote.created_at)}`,
      `Validade: ${formatDateKey(quote.valid_until)}`,
    ],
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PDF_PRIMARY);
  doc.text(clientLabel, PDF_PAGE_MARGIN, y);
  y += 5;

  const contact = quoteContact(quote);
  if (contact) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_MUTED);
    const contactLines = doc.splitTextToSize(
      contact,
      doc.internal.pageSize.getWidth() - PDF_PAGE_MARGIN * 2
    );
    doc.text(contactLines, PDF_PAGE_MARGIN, y);
    y += contactLines.length * 4 + 2;
  }

  y += 2;
  autoTable(doc, {
    startY: y,
    margin: { left: PDF_PAGE_MARGIN, right: PDF_PAGE_MARGIN },
    head: [["Serviço", "Tipo", "Valor"]],
    body:
      items.length > 0
        ? items.map((item) => [
            item.name,
            QUOTE_KIND_LABEL[item.kind],
            pdfMoney(Number(item.unit_price) || 0),
          ])
        : [["Nenhum item", "—", pdfMoney(0)]],
    headStyles: { fillColor: PDF_PRIMARY, textColor: 255 },
    styles: { fontSize: 8.5 },
    columnStyles: {
      1: { cellWidth: 32 },
      2: { halign: "right", cellWidth: 32 },
    },
  });
  y = getPdfAutoTableFinalY(doc) + 8;

  const pageWidth = doc.internal.pageSize.getWidth();
  const totalsX = pageWidth - PDF_PAGE_MARGIN;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_FOREGROUND);
  doc.text(`Subtotal: ${pdfMoney(subtotal)}`, totalsX, y, { align: "right" });
  y += 5;

  if (adjustment !== 0) {
    const adjustmentLabel =
      adjustment < 0 ? "Desconto (ajuste)" : "Acréscimo (ajuste)";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_MUTED);
    doc.text(`${adjustmentLabel}: ${pdfMoney(adjustment)}`, totalsX, y, {
      align: "right",
    });
    y += 6;
  }

  y = ensurePdfSpace(doc, y, 20);
  doc.setFillColor(...PDF_PRIMARY);
  doc.roundedRect(PDF_PAGE_MARGIN, y, pageWidth - PDF_PAGE_MARGIN * 2, 14, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL FINAL", PDF_PAGE_MARGIN + 5, y + 9);
  doc.text(pdfMoney(finalTotal), pageWidth - PDF_PAGE_MARGIN - 5, y + 9, {
    align: "right",
  });
  y += 20;

  const notes = quote.notes?.trim();
  if (notes) {
    y = ensurePdfSpace(doc, y, 28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_PRIMARY);
    doc.text("Observações", PDF_PAGE_MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_FOREGROUND);
    const noteLines = doc.splitTextToSize(
      notes,
      pageWidth - PDF_PAGE_MARGIN * 2
    );
    doc.text(noteLines, PDF_PAGE_MARGIN, y);
  }

  drawPdfPageFooters(
    doc,
    `Orçamento emitido em ${generatedAtLabel} · ${workshop.name}`
  );

  doc.save(`orcamento-${pdfFileSlug(clientLabel)}.pdf`);
}
