import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Row } from "exceljs";
import type { Product } from "./stock-types";
import { formatDateTime, formatNum } from "./format";

type LoadedImage = {
  dataUrl: string;
  base64: string;
  width: number;
  height: number;
};

type AutoTableDoc = jsPDF & {
  lastAutoTable?: {
    finalY?: number;
  };
};

type ExcelJsRuntime = typeof import("exceljs") & {
  default?: typeof import("exceljs");
};

const BLACK: [number, number, number] = [17, 17, 17];
const BORDER: [number, number, number] = [210, 210, 210];
const LIGHT_FILL: [number, number, number] = [248, 249, 250];
const imageCache = new Map<string, Promise<LoadedImage | null>>();

function sortSizeLabels(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

function availableSizes(product: Product): string[] {
  const sizes = new Set<string>();
  for (const color of product.colors) {
    for (const [size, quantity] of Object.entries(color.sizes)) {
      if (size.trim() && quantity > 0) sizes.add(size);
    }
  }
  return [...sizes].sort(sortSizeLabels);
}

function allExportSizes(products: Product[]): string[] {
  const sizes = new Set<string>();
  for (const product of products) {
    for (const size of availableSizes(product)) {
      sizes.add(size);
    }
  }
  return [...sizes].sort(sortSizeLabels);
}

function groupBySubgroup(products: Product[]): Map<string, Product[]> {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.subgroup || "SEM SUBGRUPO";
    const list = groups.get(key) ?? [];
    list.push(product);
    groups.set(key, list);
  }
  return groups;
}

function fitInside(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
) {
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: sourceWidth * ratio,
    height: sourceHeight * ratio,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function readImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem."));
    image.src = dataUrl;
  });
}

function proxiedImageUrl(url: string): string {
  if (typeof window === "undefined") return url;

  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin) return parsed.toString();
    return `/api/image?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return url;
  }
}

async function normalizeToJpeg(dataUrl: string): Promise<LoadedImage | null> {
  const image = await readImage(dataUrl);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  if (!originalWidth || !originalHeight) return null;

  const maxSize = 1200;
  const ratio = Math.min(1, maxSize / originalWidth, maxSize / originalHeight);
  const width = Math.max(1, Math.round(originalWidth * ratio));
  const height = Math.max(1, Math.round(originalHeight * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.88);
  return {
    dataUrl: jpegDataUrl,
    base64: jpegDataUrl.split(",")[1] ?? "",
    width,
    height,
  };
}

async function loadImage(url?: string): Promise<LoadedImage | null> {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (!imageCache.has(trimmed)) {
    imageCache.set(
      trimmed,
      (async () => {
        try {
          const response = await fetch(proxiedImageUrl(trimmed));
          if (!response.ok) return null;
          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) return null;
          return await normalizeToJpeg(await blobToDataUrl(blob));
        } catch {
          return null;
        }
      })(),
    );
  }

  return imageCache.get(trimmed) ?? null;
}

function drawPdfHeader(doc: jsPDF, products: Product[], title: string) {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, 14, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`Gerado em ${formatDateTime(new Date())}`, 14, 24);
  doc.setFont("helvetica", "bold");
  doc.text(`${products.length} referencias`, pageWidth - 14, 24, { align: "right" });
}

function ensurePdfSpace(doc: jsPDF, y: number, needed: number) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed <= pageHeight - 14) return y;
  doc.addPage();
  return 18;
}

function drawPdfBadge(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  filled = false,
) {
  const width = doc.getTextWidth(text) + 4;
  if (filled) {
    doc.setFillColor(...BLACK);
    doc.setDrawColor(...BLACK);
    doc.roundedRect(x, y - 4, width, 5.5, 1, 1, "FD");
    doc.setTextColor(255, 255, 255);
  } else {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(x, y - 4, width, 5.5, 1, 1, "FD");
    doc.setTextColor(0, 0, 0);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text(text, x + 2, y);
  doc.setTextColor(0, 0, 0);
  return x + width + 2;
}

async function drawPdfProduct(
  doc: AutoTableDoc,
  product: Product,
  y: number,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const tableWidth = pageWidth - 28;
  const image = await loadImage(product.imageUrl);
  const imageSize = image ? 30 : 0;
  const imageGap = image ? 7 : 0;
  const textX = 14 + imageSize + imageGap;
  const contentWidth = tableWidth - imageSize - imageGap;
  const allSizes = availableSizes(product);
  const tableFontSize = allSizes.length > 9 ? 6.2 : 7;

  y = ensurePdfSpace(doc, y, image ? 54 : 34);

  if (image) {
    doc.setDrawColor(...BORDER);
    doc.setFillColor(...LIGHT_FILL);
    doc.roundedRect(14, y, imageSize, imageSize, 1.5, 1.5, "FD");
    const fitted = fitInside(image.width, image.height, imageSize - 2, imageSize - 2);
    doc.addImage(
      image.dataUrl,
      "JPEG",
      14 + (imageSize - fitted.width) / 2,
      y + (imageSize - fitted.height) / 2,
      fitted.width,
      fitted.height,
    );
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(`${product.reference} - ${product.description}`, textX, y + 5, {
    maxWidth: contentWidth - 28,
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  let badgeX = textX;
  badgeX = drawPdfBadge(doc, product.brand, badgeX, y + 12, true);
  badgeX = drawPdfBadge(doc, `Col. ${product.collection}`, badgeX, y + 12);
  drawPdfBadge(doc, product.subgroup, badgeX, y + 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(80, 80, 80);
  doc.text(`Total: ${formatNum(product.totalQuantity)} pcs`, textX, y + 19);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text("TOTAL", pageWidth - 14, y + 3, { align: "right" });
  doc.setFontSize(14);
  doc.text(formatNum(product.totalQuantity), pageWidth - 14, y + 10, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("pecas", pageWidth - 14, y + 15, { align: "right" });

  const tableStartY = y + Math.max(imageSize, 22) + 4;
  const head = [["Cor", ...allSizes, "Total"]];
  const body = product.colors.map((color) => [
    color.name,
    ...allSizes.map((size) => {
      const quantity = color.sizes[size] ?? 0;
      return quantity > 0 ? String(quantity) : "";
    }),
    String(color.total),
  ]);

  autoTable(doc, {
    startY: tableStartY,
    head,
    body,
    margin: { left: 14, right: 14 },
    theme: "grid",
    tableWidth,
    styles: {
      font: "helvetica",
      fontSize: tableFontSize,
      cellPadding: { top: 1.1, right: 1.2, bottom: 1.1, left: 1.2 },
      lineColor: BORDER,
      lineWidth: 0.1,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: BLACK,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "right",
    },
    bodyStyles: {
      textColor: [20, 20, 20],
    },
    alternateRowStyles: {
      fillColor: [249, 249, 249],
    },
    columnStyles: {
      0: { halign: "left", cellWidth: 52 },
      [allSizes.length + 1]: { fontStyle: "bold", halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index === 0) {
        data.cell.styles.halign = "left";
      }
      if (data.section === "body" && data.column.index > 0) {
        data.cell.styles.halign = "right";
      }
    },
  });

  return (doc.lastAutoTable?.finalY ?? tableStartY + 18) + 8;
}

export async function exportToPdf(
  products: Product[],
  title = "Portal-Saldo-Estoque",
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as AutoTableDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 34;

  drawPdfHeader(doc, products, title);

  for (const [subgroup, list] of groupBySubgroup(products)) {
    y = ensurePdfSpace(doc, y, 18);
    doc.setFillColor(...BLACK);
    doc.rect(14, y, pageWidth - 28, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(subgroup.toUpperCase(), 16, y + 5.5);
    doc.setTextColor(0, 0, 0);
    y += 13;

    for (const product of list) {
      y = await drawPdfProduct(doc, product, y);
    }
  }

  doc.save(`portal-saldo-estoque-${Date.now()}.pdf`);
}

function styleExcelHeader(row: Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } };
    cell.alignment = { vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "FF111111" } },
      left: { style: "thin", color: { argb: "FF111111" } },
      bottom: { style: "thin", color: { argb: "FF111111" } },
      right: { style: "thin", color: { argb: "FF111111" } },
    };
  });
}

function styleExcelDataRow(row: Row, striped: boolean) {
  row.eachCell((cell) => {
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD9D9D9" } },
      left: { style: "thin", color: { argb: "FFD9D9D9" } },
      bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
      right: { style: "thin", color: { argb: "FFD9D9D9" } },
    };
    if (striped) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
    }
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportToExcel(products: Product[]) {
  const ExcelJS = (await import("exceljs")) as ExcelJsRuntime;
  const Workbook = ExcelJS.Workbook ?? ExcelJS.default?.Workbook;
  if (!Workbook) throw new Error("Nao foi possivel carregar o gerador de Excel.");

  const workbook = new Workbook();
  workbook.creator = "Portal-Saldo-Estoque";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Resumo", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  summary.columns = [
    { header: "Imagem", key: "image", width: 17 },
    { header: "Referência", key: "reference", width: 18 },
    { header: "Descrição", key: "description", width: 42 },
    { header: "Griffe", key: "brand", width: 16 },
    { header: "Coleção", key: "collection", width: 12 },
    { header: "Subgrupo", key: "subgroup", width: 18 },
    { header: "Total", key: "total", width: 12 },
    { header: "URL da imagem", key: "imageUrl", width: 42 },
  ];

  summary.mergeCells("A1:H1");
  summary.getCell("A1").value = "Portal-Saldo-Estoque";
  summary.getCell("A1").font = { bold: true, size: 18 };
  summary.getCell("A2").value = `Gerado em ${formatDateTime(new Date())}`;
  summary.getCell("A2").font = { size: 10, color: { argb: "FF555555" } };
  summary.getCell("H2").value = `${products.length} referencias`;
  summary.getCell("H2").alignment = { horizontal: "right" };
  summary.getCell("H2").font = { bold: true };

  styleExcelHeader(summary.getRow(4));

  let rowNumber = 5;
  for (const product of products) {
    const row = summary.getRow(rowNumber);
    row.height = 62;
    row.values = [
      "",
      product.reference,
      product.description,
      product.brand,
      product.collection,
      product.subgroup,
      product.totalQuantity,
      product.imageUrl ?? "",
    ];
    styleExcelDataRow(row, rowNumber % 2 === 0);
    row.getCell(2).font = { bold: true };
    row.getCell(7).font = { bold: true };
    row.getCell(7).alignment = { horizontal: "right", vertical: "middle" };

    const image = await loadImage(product.imageUrl);
    if (image) {
      const imageId = workbook.addImage({ base64: image.base64, extension: "jpeg" });
      summary.addImage(imageId, {
        tl: { col: 0.2, row: rowNumber - 0.85 },
        ext: { width: 82, height: 58 },
        editAs: "oneCell",
      });
    } else {
      row.getCell(1).value = "Sem imagem";
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { color: { argb: "FF777777" }, italic: true };
    }

    row.commit();
    rowNumber += 1;
  }

  summary.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: 8 },
  };

  const detail = workbook.addWorksheet("Estoque detalhado", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const sizes = allExportSizes(products);
  detail.columns = [
    { header: "Referência", key: "reference", width: 16 },
    { header: "Descrição", key: "description", width: 36 },
    { header: "Griffe", key: "brand", width: 16 },
    { header: "Coleção", key: "collection", width: 10 },
    { header: "Subgrupo", key: "subgroup", width: 18 },
    { header: "Cor", key: "color", width: 28 },
    ...sizes.map((size) => ({ header: size, key: `size-${size}`, width: 10 })),
    { header: "Total Cor", key: "colorTotal", width: 12 },
    { header: "Total Ref.", key: "productTotal", width: 12 },
  ];
  styleExcelHeader(detail.getRow(1));

  let detailRowNumber = 2;
  for (const product of products) {
    for (const color of product.colors) {
      const rowValues: Record<string, string | number> = {
        reference: product.reference,
        description: product.description,
        brand: product.brand,
        collection: product.collection,
        subgroup: product.subgroup,
        color: color.name,
        colorTotal: color.total,
        productTotal: product.totalQuantity,
      };
      for (const size of sizes) {
        const quantity = color.sizes[size] ?? 0;
        rowValues[`size-${size}`] = quantity > 0 ? quantity : "";
      }
      const row = detail.addRow(rowValues);
      styleExcelDataRow(row, detailRowNumber % 2 === 0);
      row.getCell(1).font = { bold: true };
      row.getCell(detail.columnCount - 1).font = { bold: true };
      row.getCell(detail.columnCount).font = { bold: true };
      detailRowNumber += 1;
    }
  }
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detail.columnCount },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `portal-saldo-estoque-${Date.now()}.xlsx`,
  );
}
