export interface ColorStock {
  name: string;
  total: number;
  sizes: Record<string, number>;
}

export interface Product {
  reference: string;
  description: string;
  subgroup: string;
  collection: string;
  brand: string;
  composition: string;
  sellIn: number;
  sellOut: number;
  imageUrl: string;
  totalQuantity: number;
  colors: ColorStock[];
}

export type ViewMode = "cards" | "table";

export type SortKey =
  | "stock_desc"
  | "stock_asc"
  | "ref_asc"
  | "ref_desc"
  | "desc_asc"
  | "collection"
  | "subgroup"
  | "brand"
  | "sellin_desc"
  | "sellin_asc"
  | "sellout_desc"
  | "sellout_asc";

export interface Filters {
  search: string;
  brands: string[];
  collections: string[];
  subgroups: string[];
  colors: string[];
  sizes: string[];
  minQty: number | null;
  maxQty: number | null;
}
