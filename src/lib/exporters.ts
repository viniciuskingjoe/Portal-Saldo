import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { Product } from "./stock-types";
import { formatBRL, formatDateTime } from "./format";

export function exportToPdf(products: Product[], title = "Portal-Saldo-Estoque") {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Gerado em ${formatDateTime(new Date())}`, 14, 22);
  doc.text(`${products.length} referências`, pageWidth - 14, 22, { align: "right" });

  // Group by subgroup
  const groups = new Map<string, Product[]>();
  for (const p of products) {
    const arr = groups.get(p.subgroup) ?? [];
    arr.push(p);
    groups.set(p.subgroup, arr);
  }

  let y = 30;
  for (const [subgroup, list] of groups) {
    if (y > 260) {
      doc.addPage();
      y = 16;
    }
    doc.setFillColor(17, 17, 17);
    doc.rect(14, y, pageWidth - 28, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(subgroup.toUpperCase(), 16, y + 5);
    doc.setTextColor(0, 0, 0);
    y += 10;

    for (const p of list) {
      const allSizes = Array.from(
        new Set(p.colors.flatMap((c) => Object.keys(c.sizes))),
      );
      const head = [["Cor", ...allSizes, "Total"]];
      const body = p.colors.map((c) => [
        c.name,
        ...allSizes.map((s) => String(c.sizes[s] ?? 0)),
        String(c.total),
      ]);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(`${p.reference} — ${p.description}`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(
        `${p.brand} · Col. ${p.collection} · ${p.composition}`,
        14,
        y + 4,
      );
      doc.text(
        `Sell In ${formatBRL(p.sellIn)}  |  Sell Out ${formatBRL(p.sellOut)}  |  Total: ${p.totalQuantity} pçs`,
        14,
        y + 8,
      );

      autoTable(doc, {
        startY: y + 10,
        head,
        body,
        styles: { fontSize: 7, cellPadding: 1.2 },
        headStyles: { fillColor: [17, 17, 17] },
        margin: { left: 14, right: 14 },
        theme: "grid",
      });
      // @ts-expect-error lastAutoTable injected by plugin
      y = (doc.lastAutoTable.finalY ?? y + 20) + 6;
      if (y > 270) {
        doc.addPage();
        y = 16;
      }
    }
  }

  doc.save(`portal-saldo-estoque-${Date.now()}.pdf`);
}

export function exportToExcel(products: Product[]) {
  const summary = products.map((p) => ({
    Referência: p.reference,
    Descrição: p.description,
    Griffe: p.brand,
    Coleção: p.collection,
    Subgrupo: p.subgroup,
    Composição: p.composition,
    "Sell In": p.sellIn,
    "Sell Out": p.sellOut,
    "Qtd. Total": p.totalQuantity,
    Imagem: p.imageUrl,
  }));

  const detailed: Record<string, string | number>[] = [];
  for (const p of products) {
    for (const c of p.colors) {
      for (const [size, qty] of Object.entries(c.sizes)) {
        detailed.push({
          Referência: p.reference,
          Descrição: p.description,
          Griffe: p.brand,
          Coleção: p.collection,
          Subgrupo: p.subgroup,
          Cor: c.name,
          Tamanho: size,
          Quantidade: qty,
          "Total da Cor": c.total,
          "Total da Ref.": p.totalQuantity,
        });
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(summary);
  const ws2 = XLSX.utils.json_to_sheet(detailed);
  XLSX.utils.book_append_sheet(wb, ws1, "Resumo");
  XLSX.utils.book_append_sheet(wb, ws2, "Estoque detalhado");
  XLSX.writeFile(wb, `portal-saldo-estoque-${Date.now()}.xlsx`);
}
