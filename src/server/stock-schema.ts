export const stockSqlSchema = {
  stockTable: {
    schema: "dbo",
    name: "king_estoque_disponiel",
  },
  sizeTable: {
    schema: "dbo",
    name: "PRODUTOS_TAMANHOS",
  },
  stockColumns: {
    reference: "PRODUTO",
    description: "DESC_PRODUTO",
    brand: "GRIFFE",
    collection: "COLECAO",
    subgroup: "SUBGRUPO_PRODUTO",
    grade: "GRADE",
    colorCode: "COR_PRODUTO",
    colorDescription: "DESC_COR_PRODUTO",
    quantities: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12"],
  },
  sizeColumns: {
    grade: "GRADE",
    sizes: [
      "TAMANHO_1",
      "TAMANHO_2",
      "TAMANHO_3",
      "TAMANHO_4",
      "TAMANHO_5",
      "TAMANHO_6",
      "TAMANHO_7",
      "TAMANHO_8",
      "TAMANHO_9",
      "TAMANHO_10",
      "TAMANHO_11",
      "TAMANHO_12",
    ],
  },
  maxRows: 50000,
  onlyPositiveStock: true,
} as const;

export function sqlIdentifier(value: string): string {
  return `[${value.replaceAll("]", "]]")}]`;
}

export function sqlTableName(table: { schema: string; name: string }): string {
  const { schema, name } = table;
  return `${sqlIdentifier(schema)}.${sqlIdentifier(name)}`;
}
