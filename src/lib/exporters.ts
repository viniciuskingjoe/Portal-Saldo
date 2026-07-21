import type { Row, Worksheet } from "exceljs";
import type { Product } from "./stock-types";
import { ACCESS_TYPES } from "./stock-types";
import { formatDateTime } from "./format";

type ExcelJsRuntime = typeof import("exceljs") & {
  default?: typeof import("exceljs");
};

const INK = "FF111111";
const GRID = "FFD9D9D9";
const STRIPE = "FFF7F8FA";
const MUTED = "FF8A8A8A";

function sortSizeLabels(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

/** Uniao dos tamanhos com saldo em todos os produtos exportados. */
function allExportSizes(products: Product[]): string[] {
  const sizes = new Set<string>();
  for (const product of products) {
    for (const color of product.colors) {
      for (const [size, quantity] of Object.entries(color.sizes)) {
        if (size.trim() && quantity > 0) sizes.add(size);
      }
    }
  }
  return [...sizes].sort(sortSizeLabels);
}

function thinBorder() {
  return {
    top: { style: "thin" as const, color: { argb: GRID } },
    left: { style: "thin" as const, color: { argb: GRID } },
    bottom: { style: "thin" as const, color: { argb: GRID } },
    right: { style: "thin" as const, color: { argb: GRID } },
  };
}

function styleHeaderRow(row: Row) {
  row.height = 26;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: INK } },
      left: { style: "thin", color: { argb: INK } },
      bottom: { style: "thin", color: { argb: INK } },
      right: { style: "thin", color: { argb: INK } },
    };
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
  workbook.creator = "Portal Saldo Estoque";
  workbook.created = new Date();

  const sizes = allExportSizes(products);

  // Mapa de colunas: Ref | Desc | Colecao | Cor | <tamanhos> | Total | <acessos>
  const COL_REFERENCE = 1;
  const COL_DESCRIPTION = 2;
  const COL_COLLECTION = 3;
  const COL_COLOR = 4;
  const COL_SIZE_FIRST = 5;
  const COL_TOTAL = COL_SIZE_FIRST + sizes.length;
  const COL_ACCESS_FIRST = COL_TOTAL + 1;
  const COL_LAST = COL_ACCESS_FIRST + ACCESS_TYPES.length - 1;

  const sheet: Worksheet = workbook.addWorksheet("Saldo de Estoque", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
  });

  // Larguras (sem `header` aqui: os rotulos sao escritos na linha 4 mais abaixo)
  sheet.columns = [
    { key: "reference", width: 16 },
    { key: "description", width: 42 },
    { key: "collection", width: 11 },
    { key: "color", width: 26 },
    ...sizes.map((size) => ({ key: `size-${size}`, width: 7 })),
    { key: "total", width: 10 },
    ...ACCESS_TYPES.map((type) => ({ key: type.key, width: 15 })),
  ];

  /* ---------- Titulo ---------- */
  sheet.mergeCells(1, 1, 1, COL_LAST);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = "Portal Saldo Estoque";
  titleCell.font = { bold: true, size: 16, color: { argb: INK } };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, 3);
  const dateCell = sheet.getCell(2, 1);
  dateCell.value = `Gerado em ${formatDateTime(new Date())}`;
  dateCell.font = { size: 9, color: { argb: MUTED } };

  sheet.mergeCells(2, COL_TOTAL, 2, COL_LAST);
  const countCell = sheet.getCell(2, COL_TOTAL);
  countCell.value = `${products.length} ${products.length === 1 ? "referência" : "referências"}`;
  countCell.font = { bold: true, size: 9 };
  countCell.alignment = { horizontal: "right" };

  /* ---------- Cabecalho (linha 4) ---------- */
  const headerRow = sheet.getRow(4);
  headerRow.getCell(COL_REFERENCE).value = "Referência";
  headerRow.getCell(COL_DESCRIPTION).value = "Descrição";
  headerRow.getCell(COL_COLLECTION).value = "Coleção";
  headerRow.getCell(COL_COLOR).value = "Cor";
  sizes.forEach((size, index) => {
    headerRow.getCell(COL_SIZE_FIRST + index).value = size;
  });
  headerRow.getCell(COL_TOTAL).value = "Total";
  ACCESS_TYPES.forEach((type, index) => {
    headerRow.getCell(COL_ACCESS_FIRST + index).value = type.label;
  });
  styleHeaderRow(headerRow);
  headerRow.getCell(COL_REFERENCE).alignment = { vertical: "middle", horizontal: "left" };
  headerRow.getCell(COL_DESCRIPTION).alignment = { vertical: "middle", horizontal: "left" };
  headerRow.getCell(COL_COLOR).alignment = { vertical: "middle", horizontal: "left" };
  headerRow.commit();

  /* ---------- Dados: 1 linha por cor, bloco mesclado por produto ---------- */
  let rowNumber = 5;
  let productIndex = 0;

  for (const product of products) {
    const colors = product.colors.length ? product.colors : [null];
    const blockStart = rowNumber;
    const striped = productIndex % 2 === 1;

    for (const color of colors) {
      const row = sheet.getRow(rowNumber);
      row.height = 20;

      row.getCell(COL_REFERENCE).value = product.reference;
      row.getCell(COL_DESCRIPTION).value = product.description;
      row.getCell(COL_COLLECTION).value = product.collection;
      row.getCell(COL_COLOR).value = color ? color.name : "—";

      sizes.forEach((size, index) => {
        const quantity = color?.sizes[size] ?? 0;
        row.getCell(COL_SIZE_FIRST + index).value = quantity > 0 ? quantity : null;
      });

      row.getCell(COL_TOTAL).value = color ? color.total : 0;

      ACCESS_TYPES.forEach((type, index) => {
        row.getCell(COL_ACCESS_FIRST + index).value = product.access?.[type.key] ? "Sim" : "—";
      });

      // Estilo da linha inteira
      for (let col = COL_REFERENCE; col <= COL_LAST; col += 1) {
        const cell = row.getCell(col);
        cell.border = thinBorder();
        if (striped) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE } };
        }
        if (col === COL_REFERENCE) {
          cell.font = { bold: true, size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "left" };
        } else if (col === COL_DESCRIPTION || col === COL_COLOR) {
          cell.font = { size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "left" };
        } else if (col === COL_COLLECTION) {
          cell.font = { size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else if (col === COL_TOTAL) {
          cell.font = { bold: true, size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else if (col >= COL_ACCESS_FIRST) {
          const isYes = cell.value === "Sim";
          cell.font = {
            size: 10,
            bold: isYes,
            color: { argb: isYes ? "FF1E7A34" : MUTED },
          };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else {
          cell.font = { size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        }
      }

      rowNumber += 1;
    }

    // Mescla o que e do produto (nao da cor) quando ha mais de uma cor
    const blockEnd = rowNumber - 1;
    if (blockEnd > blockStart) {
      for (const col of [COL_REFERENCE, COL_DESCRIPTION, COL_COLLECTION]) {
        sheet.mergeCells(blockStart, col, blockEnd, col);
        sheet.getCell(blockStart, col).alignment = {
          vertical: "middle",
          horizontal: col === COL_COLLECTION ? "center" : "left",
        };
      }
      for (let index = 0; index < ACCESS_TYPES.length; index += 1) {
        const col = COL_ACCESS_FIRST + index;
        sheet.mergeCells(blockStart, col, blockEnd, col);
        sheet.getCell(blockStart, col).alignment = {
          vertical: "middle",
          horizontal: "center",
        };
      }
    }

    // Linha divisoria mais forte no fim de cada produto
    for (let col = COL_REFERENCE; col <= COL_LAST; col += 1) {
      const cell = sheet.getCell(blockEnd, col);
      cell.border = { ...thinBorder(), bottom: { style: "medium", color: { argb: "FFBFBFBF" } } };
    }

    productIndex += 1;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `portal-saldo-estoque-${Date.now()}.xlsx`,
  );
}
