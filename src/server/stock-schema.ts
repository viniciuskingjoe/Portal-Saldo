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
  // Join com politica comercial B2B. O codigo de cada TIPO_ACESSO vem de
  // ACCESS_TYPES (lib/stock-types); aqui ficam so tabelas/colunas e STATUS ativo.
  accessPolicy: {
    productTable: { database: "PORTAL_CLIENTE", schema: "dbo", name: "B2B_PRODUTO" },
    policyTable: { database: "PORTAL_CLIENTE", schema: "dbo", name: "B2B_POLITICA_COMERCIAL" },
    columns: {
      product: "PRODUTO",
      color: "COR",
      policyId: "ID_POLITICA_COMERCIAL",
      accessType: "TIPO_ACESSO",
      status: "STATUS",
    },
    activeStatus: 1,
  },
  productImage: {
    table: { database: "PORTAL_CLIENTE", schema: "dbo", name: "B2B_PRODUTO_IMAGEM" },
    cloudFrontBaseUrl: "https://dfcl9ybffzusy.cloudfront.net/",
    columns: {
      product: "PRODUTO",
      color: "COR_PRODUTO",
      position: "POSICAO",
      image: "IMAGEM",
    },
  },
  maxRows: 50000,
  onlyPositiveStock: true,
} as const;

export function sqlIdentifier(value: string): string {
  return `[${value.replaceAll("]", "]]")}]`;
}

export function sqlTableName(table: { database?: string; schema: string; name: string }): string {
  const { database, schema, name } = table;
  const qualified = `${sqlIdentifier(schema)}.${sqlIdentifier(name)}`;
  return database ? `${sqlIdentifier(database)}.${qualified}` : qualified;
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
