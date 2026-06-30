import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Grid3x3,
  ImageIcon,
  ImageOff,
  LayoutList,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Toaster } from "@/components/ui/sonner";
import type { Filters, Product, SortKey, ViewMode } from "@/lib/stock-types";
import { DRIVE_IMAGE_MAP, DRIVE_IMAGE_MAP_BY_BRAND } from "@/lib/drive-image-map";
import { formatNum, formatTime } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Portal-Saldo-Estoque" },
      {
        name: "description",
        content:
          "Consulta interna de disponibilidade de produtos. Filtre por griffe, coleção, subgrupo, cor e tamanho.",
      },
    ],
  }),
  component: PortalPage,
});

const PAGE_SIZE_OPTIONS = [24, 48, 96];

const SORT_LABELS: Record<SortKey, string> = {
  stock_desc: "Maior estoque",
  stock_asc: "Menor estoque",
  ref_asc: "Referência A–Z",
  ref_desc: "Referência Z–A",
  desc_asc: "Descrição A–Z",
  collection: "Coleção",
  subgroup: "Subgrupo",
  brand: "Griffe",
};

const EMPTY_FILTERS: Filters = {
  search: "",
  brands: [],
  collections: [],
  subgroups: [],
  colors: [],
};

const IMAGE_STORAGE_KEY = "psv-product-images";

type FilterKey = "brands" | "collections" | "subgroups" | "colors";

const FILTERS: Array<{
  key: FilterKey;
  label: string;
  placeholder: string;
}> = [
  { key: "brands", label: "Griffe", placeholder: "Buscar griffe..." },
  { key: "collections", label: "Coleção", placeholder: "Buscar coleção..." },
  { key: "subgroups", label: "Subgrupo", placeholder: "Buscar subgrupo..." },
  { key: "colors", label: "Cor", placeholder: "Digite código ou descrição..." },
];

type StockApiResponse = {
  products: Product[];
  updatedAt: string;
};

type ConnectionStatus = "loading" | "connected" | "error";

function isStockApiResponse(value: unknown): value is StockApiResponse {
  if (value == null || typeof value !== "object") return false;
  const payload = value as Partial<StockApiResponse>;
  return Array.isArray(payload.products) && typeof payload.updatedAt === "string";
}

function parseApiDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function sortProducts(items: Product[], sort: SortKey): Product[] {
  const arr = [...items];
  arr.sort((a, b) => {
    switch (sort) {
      case "stock_desc": return b.totalQuantity - a.totalQuantity;
      case "stock_asc": return a.totalQuantity - b.totalQuantity;
      case "ref_asc": return a.reference.localeCompare(b.reference);
      case "ref_desc": return b.reference.localeCompare(a.reference);
      case "desc_asc": return a.description.localeCompare(b.description);
      case "collection": return a.collection.localeCompare(b.collection);
      case "subgroup": return a.subgroup.localeCompare(b.subgroup);
      case "brand": return a.brand.localeCompare(b.brand);
    }
  });
  return arr;
}

function applyFilters(items: Product[], f: Filters): Product[] {
  const q = f.search.trim().toLowerCase();
  return items.filter((p) => {
    if (q && !p.reference.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q))
      return false;
    if (f.brands.length && !f.brands.includes(p.brand)) return false;
    if (f.collections.length && !f.collections.includes(p.collection)) return false;
    if (f.subgroups.length && !f.subgroups.includes(p.subgroup)) return false;
    if (f.colors.length && !p.colors.some((c) => f.colors.includes(c.name))) return false;
    return true;
  });
}

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

function extractUnsplashPhotoId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "unsplash.com") return null;

  const segments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const isPhotoPage =
    segments.includes("photos") ||
    segments.includes("fotografias") ||
    segments.includes("fotos");
  if (!isPhotoPage) return null;

  const lastSegment = segments.at(-1);
  if (!lastSegment) return null;

  const exactId = lastSegment.match(/^[A-Za-z0-9_-]{11}$/);
  if (exactId) return lastSegment;

  const trailingId = lastSegment.slice(-11);
  return /^[A-Za-z0-9_-]{11}$/.test(trailingId) ? trailingId : null;
}

function extractGoogleDriveFileId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "drive.google.com" && host !== "docs.google.com") return null;

  const id = parsed.searchParams.get("id");
  if (id) return id;

  const segments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const fileIndex = segments.indexOf("file");

  if (fileIndex >= 0 && segments[fileIndex + 1] === "d" && segments[fileIndex + 2]) {
    return segments[fileIndex + 2];
  }

  return null;
}

function normalizeImageUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    const driveFileId = extractGoogleDriveFileId(parsed);
    if (driveFileId) {
      return `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1200`;
    }

    const unsplashPhotoId = extractUnsplashPhotoId(parsed);
    if (unsplashPhotoId) {
      return `https://unsplash.com/photos/${unsplashPhotoId}/download?force=true&w=1200`;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function imageLookupKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function referenceLookupKeys(reference: string): string[] {
  const normalized = reference.trim().toUpperCase();
  return [...new Set([normalized, normalized.replace(/\./g, "")])].filter(Boolean);
}

function getDriveImageUrl(product: Product): string | undefined {
  const brandMap = DRIVE_IMAGE_MAP_BY_BRAND[imageLookupKey(product.brand)];
  for (const reference of referenceLookupKeys(product.reference)) {
    const imageUrl = brandMap?.[reference] ?? DRIVE_IMAGE_MAP[reference];
    if (imageUrl) return imageUrl;
  }

  return undefined;
}

function proxiedDisplayImageUrl(src?: string): string | undefined {
  const trimmed = src?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return trimmed;

    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return trimmed;
    }

    return `/api/image?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return trimmed;
  }
}

function PortalPage() {
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const didRenderPageRef = useRef(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("loading");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<SortKey>("stock_desc");
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "cards";
    return (localStorage.getItem("psv-view") as ViewMode) ?? "cards";
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [viewingImageRef, setViewingImageRef] = useState<string | null>(null);
  const [imageMap, setImageMap] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const value = localStorage.getItem(IMAGE_STORAGE_KEY);
      return value ? (JSON.parse(value) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [editingImageRef, setEditingImageRef] = useState<string | null>(null);

  const loadStock = useCallback(async (silent = false) => {
    setLoading(true);
    setConnectionStatus((current) => (current === "connected" ? current : "loading"));

    try {
      const response = await fetch("/api/stock", {
        headers: {
          accept: "application/json",
        },
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload != null && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: unknown }).message)
            : "Nao foi possivel consultar o SQL Server.";
        throw new Error(message);
      }

      if (!isStockApiResponse(payload)) {
        throw new Error("A API de estoque retornou um formato inesperado.");
      }

      setAllProducts(payload.products);
      setLastUpdate(parseApiDate(payload.updatedAt));
      setConnectionStatus("connected");
      if (!silent) toast.success("Estoque atualizado.");
    } catch (error) {
      console.error(error);
      setConnectionStatus("error");
      if (!silent) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Nao foi possivel consultar o SQL Server.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Persist view
  useEffect(() => {
    localStorage.setItem("psv-view", view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem(IMAGE_STORAGE_KEY, JSON.stringify(imageMap));
  }, [imageMap]);

  useEffect(() => {
    if (!filtersOpen) {
      setOpenFilter(null);
      setFilterSearch("");
    }
  }, [filtersOpen]);

  useEffect(() => {
    if (!viewingImageRef) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewingImageRef(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [viewingImageRef]);

  useEffect(() => {
    void loadStock(true);
  }, [loadStock]);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput }));
      setPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Auto refresh every 30s
  useEffect(() => {
    const id = setInterval(() => {
      void loadStock(true);
    }, 30000);
    return () => clearInterval(id);
  }, [loadStock]);

  const refresh = () => {
    void loadStock();
  };
  const lastUpdateText = lastUpdate ? formatTime(lastUpdate) : "--:--:--";

  const products = useMemo(
    () =>
      allProducts.map((product) => {
        const imageUrl =
          imageMap[product.reference] ?? product.imageUrl ?? getDriveImageUrl(product);
        return imageUrl ? { ...product, imageUrl } : product;
      }),
    [allProducts, imageMap],
  );

  // Distinct filter options
  const opts = useMemo(() => {
    const brands = new Set<string>();
    const collections = new Set<string>();
    const subgroups = new Set<string>();
    const colors = new Set<string>();
    for (const p of products) {
      brands.add(p.brand);
      collections.add(p.collection);
      subgroups.add(p.subgroup);
      for (const c of p.colors) {
        colors.add(c.name);
      }
    }
    return {
      brands: [...brands].sort(),
      collections: [...collections].sort(),
      subgroups: [...subgroups].sort(),
      colors: [...colors].sort(),
    };
  }, [products]);

  const filtered = useMemo(() => applyFilters(products, filters), [products, filters]);
  const sorted = useMemo(() => sortProducts(filtered, sort), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  useEffect(() => {
    if (!didRenderPageRef.current) {
      didRenderPageRef.current = true;
      return;
    }

    setExpandedRow(null);
    resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentPage, pageSize]);

  // Dashboard
  const summary = useMemo(() => {
    const refs = filtered.length;
    let pieces = 0;
    const brandSet = new Set<string>();
    const colSet = new Set<string>();
    for (const p of filtered) {
      pieces += p.totalQuantity;
      brandSet.add(p.brand);
      colSet.add(p.collection);
    }
    return { refs, pieces, brands: brandSet.size, collections: colSet.size };
  }, [filtered]);

  // Selection
  const toggleSelect = (ref: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };
  const toggleSelectPage = () => {
    const allPageSelected = pageItems.every((p) => selected.has(p.reference));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageItems.forEach((p) => next.delete(p.reference));
      else pageItems.forEach((p) => next.add(p.reference));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const activeFilterCount =
    filters.brands.length +
    filters.collections.length +
    filters.subgroups.length +
    filters.colors.length;

  const toggleArr = (key: keyof Filters, val: string) => {
    setFilters((f) => {
      const arr = f[key] as string[];
      const next = arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
      return { ...f, [key]: next };
    });
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearchInput("");
    setPage(1);
  };

  const editingImageProduct = products.find((product) => product.reference === editingImageRef);
  const viewingImageProduct = products.find((product) => product.reference === viewingImageRef);

  const saveProductImage = (reference: string, imageUrl: string) => {
    setImageMap((current) => {
      const next = { ...current };
      const trimmed = normalizeImageUrl(imageUrl);
      if (trimmed) next[reference] = trimmed;
      else delete next[reference];
      return next;
    });
    setEditingImageRef(null);
    toast.success(imageUrl.trim() ? "Imagem salva." : "Imagem removida.");
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      <Toaster position="top-right" />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">
                Portal-Saldo-Estoque
              </h1>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                Consulta interna de disponibilidade
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs sm:flex">
                <span
                  className={`h-2 w-2 rounded-full ${
                    loading
                      ? "animate-pulse bg-muted-foreground"
                      : connectionStatus === "connected"
                        ? "bg-foreground"
                        : "bg-red-500"
                  }`}
                />
                <span className="font-medium">
                  {loading
                    ? "Atualizando"
                    : connectionStatus === "connected"
                      ? "SQL Server"
                      : "Banco offline"}
                </span>
                <span className="text-muted-foreground">· {lastUpdateText}</span>
              </div>
              <button
                onClick={refresh}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50 sm:text-sm"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Atualizar agora</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {/* Dashboard */}
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <SummaryCard label="Peças" value={formatNum(summary.pieces)} />
          <SummaryCard label="Referências" value={formatNum(summary.refs)} />
          <SummaryCard label="Griffes" value={formatNum(summary.brands)} />
          <SummaryCard label="Coleções" value={formatNum(summary.collections)} />
          <SummaryCard
            label="Última atualização"
            value={lastUpdateText}
            small
          />
        </section>

        {/* Search */}
        <section className="mb-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por referência ou descrição..."
              className="w-full rounded-lg border border-border bg-card py-3 pr-10 pl-11 text-sm outline-none transition focus:border-foreground"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </section>

        {/* Filters */}
        <section className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Filter className="h-4 w-4" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`h-4 w-4 transition ${filtersOpen ? "rotate-180" : ""}`}
              />
            </button>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="mt-3 rounded-lg border border-border bg-card p-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {FILTERS.map((filter) => (
                  <FilterDropdown
                    key={filter.key}
                    label={filter.label}
                    options={opts[filter.key]}
                    selected={filters[filter.key]}
                    open={openFilter === filter.key}
                    search={openFilter === filter.key ? filterSearch : ""}
                    placeholder={filter.placeholder}
                    onOpenChange={(open) => {
                      setOpenFilter(open ? filter.key : null);
                      setFilterSearch("");
                    }}
                    onSearchChange={setFilterSearch}
                    onToggle={(value) => toggleArr(filter.key, value)}
                  />
                ))}
              </div>
            </div>
          )}

          {activeFilterCount > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {filters.brands.map((v) => (
                <Chip key={`b-${v}`} label={v} onRemove={() => toggleArr("brands", v)} />
              ))}
              {filters.collections.map((v) => (
                <Chip key={`c-${v}`} label={`Col. ${v}`} onRemove={() => toggleArr("collections", v)} />
              ))}
              {filters.subgroups.map((v) => (
                <Chip key={`s-${v}`} label={v} onRemove={() => toggleArr("subgroups", v)} />
              ))}
              {filters.colors.map((v) => (
                <Chip key={`co-${v}`} label={v} onRemove={() => toggleArr("colors", v)} />
              ))}
            </div>
          )}
        </section>

        {/* Toolbar */}
        <section className="mb-4 grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {formatNum(summary.refs)} referências
            </span>{" "}
            · {formatNum(summary.pieces)} peças em estoque
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium outline-none focus:border-foreground sm:text-sm"
            >
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => setView("cards")}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition ${
                  view === "cards" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                }`}
              >
                <Grid3x3 className="h-3.5 w-3.5" /> Cards
              </button>
              <button
                onClick={() => setView("table")}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition ${
                  view === "table" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                }`}
              >
                <LayoutList className="h-3.5 w-3.5" /> Tabela
              </button>
            </div>
          </div>
        </section>

        {/* Results */}
        <div ref={resultsTopRef} className="scroll-mt-28" />
        {pageItems.length === 0 ? (
          <EmptyState
            title={activeFilterCount || filters.search ? "Nenhuma referência encontrada." : "Nenhum produto disponível."}
            description={
              activeFilterCount || filters.search
                ? "Tente remover ou alterar alguns filtros."
                : "Não foram encontrados produtos com saldo para exibição."
            }
            action={
              activeFilterCount || filters.search ? (
                <button
                  onClick={clearFilters}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Limpar filtros
                </button>
              ) : (
                <button
                  onClick={refresh}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Atualizar novamente
                </button>
              )
            }
          />
        ) : view === "cards" ? (
          <div className="space-y-4">
            {pageItems.map((p) => (
              <ProductCard
                key={p.reference}
                product={p}
                selected={selected.has(p.reference)}
                onToggle={() => toggleSelect(p.reference)}
                onEditImage={() => setEditingImageRef(p.reference)}
                onViewImage={() => {
                  if (p.imageUrl) setViewingImageRef(p.reference);
                  else setEditingImageRef(p.reference);
                }}
              />
            ))}
          </div>
        ) : (
          <ProductTable
            items={pageItems}
            selected={selected}
            onToggle={toggleSelect}
            onTogglePage={toggleSelectPage}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
            onEditImage={setEditingImageRef}
            onViewImage={(reference) => {
              const product = products.find((item) => item.reference === reference);
              if (product?.imageUrl) setViewingImageRef(reference);
              else setEditingImageRef(reference);
            }}
          />
        )}

        {/* Pagination */}
        {sorted.length > 0 && (
          <div className="mt-6 grid grid-cols-1 items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="text-xs text-muted-foreground">
              Página {currentPage} de {totalPages}
            </div>
            <div className="flex items-center justify-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs">
              <span className="text-muted-foreground">Por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </main>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold">{selected.size}</span>{" "}
              {selected.size === 1 ? "referência selecionada" : "referências selecionadas"}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={clearSelection}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
                aria-label="Limpar seleção"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {editingImageProduct && (
        <ProductImageDialog
          product={editingImageProduct}
          onClose={() => setEditingImageRef(null)}
          onSave={(imageUrl) => saveProductImage(editingImageProduct.reference, imageUrl)}
        />
      )}

      {viewingImageProduct?.imageUrl && (
        <ProductImageViewerDialog
          product={viewingImageProduct}
          onClose={() => setViewingImageRef(null)}
          onEditImage={() => {
            setViewingImageRef(null);
            setEditingImageRef(viewingImageProduct.reference);
          }}
        />
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */

function SummaryCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className={`mt-1 font-extrabold ${small ? "text-lg" : "text-2xl"}`}>{value}</div>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
    >
      {label}
      <X className="h-3 w-3" />
    </button>
  );
}

function FilterDropdown({
  label,
  options,
  selected,
  open,
  search,
  placeholder,
  onOpenChange,
  onSearchChange,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  open: boolean;
  search: string;
  placeholder: string;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (value: string) => void;
  onToggle: (v: string) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredOptions = normalizedSearch
    ? options.filter((option) => option.toLowerCase().includes(normalizedSearch))
    : options;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm font-medium transition ${
          open ? "border-foreground bg-background" : "border-border bg-background hover:bg-muted"
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-2">
          {selected.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
              {selected.length}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-full min-w-72 rounded-md border border-border bg-background shadow-lg">
          <div className="relative border-b border-border">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={placeholder}
              autoFocus
              className="h-10 w-full rounded-t-md bg-background pr-3 pl-9 text-sm outline-none"
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-1">
            {filteredOptions.map((option) => {
              const on = selected.includes(option);
              return (
                <button
                  type="button"
                  key={option}
                  onClick={() => onToggle(option)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm transition ${
                    on ? "bg-muted font-semibold" : "hover:bg-muted"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-foreground bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{option}</span>
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhum resultado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductImage({
  src,
  alt,
  className,
  flush = false,
  fit = "cover",
}: {
  src?: string;
  alt: string;
  className?: string;
  flush?: boolean;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  const displaySrc = proxiedDisplayImageUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [displaySrc]);

  if (!displaySrc || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground ${
          flush ? "" : "rounded-md border border-dashed border-border"
        } ${className ?? ""}`}
      >
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${flush ? "" : "rounded-md"} ${
        fit === "contain" ? "object-contain" : "object-cover"
      } ${className ?? ""}`}
    />
  );
}

function ProductImageViewerDialog({
  product,
  onClose,
  onEditImage,
}: {
  product: Product;
  onClose: () => void;
  onEditImage: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-extrabold">{product.reference}</h2>
            <p className="truncate text-sm text-muted-foreground">{product.description}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-medium">
              <span className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">
                {product.brand}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5">
                Col. {product.collection}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5">
                {product.subgroup}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onEditImage}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Corrigir
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Fechar imagem"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted">
          <ProductImage
            src={product.imageUrl}
            alt={product.reference}
            flush
            fit="contain"
            className="h-[72vh] w-full"
          />
        </div>
      </div>
    </div>
  );
}

function ProductImageDialog({
  product,
  onClose,
  onSave,
}: {
  product: Product;
  onClose: () => void;
  onSave: (imageUrl: string) => void;
}) {
  const [url, setUrl] = useState(product.imageUrl ?? "");
  const [previewError, setPreviewError] = useState(false);
  const previewUrl = normalizeImageUrl(url);
  const previewDisplayUrl = proxiedDisplayImageUrl(previewUrl);

  useEffect(() => {
    setUrl(product.imageUrl ?? "");
    setPreviewError(false);
  }, [product]);

  const validateAndSave = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      onSave("");
      return;
    }

    try {
      const parsed = new URL(trimmed);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        toast.error("URL inválida.");
        return;
      }
    } catch {
      toast.error("URL inválida.");
      return;
    }

    if (previewError) {
      toast.error("Não foi possível carregar a imagem.");
      return;
    }

    onSave(normalizeImageUrl(trimmed));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold">Imagem do produto</h2>
            <p className="truncate text-xs text-muted-foreground">{product.reference}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ProductImage src={previewUrl} alt={product.reference} className="aspect-[4/3] w-full" />
        {previewDisplayUrl && (
          <img
            src={previewDisplayUrl}
            alt=""
            className="hidden"
            onLoad={() => setPreviewError(false)}
            onError={() => setPreviewError(true)}
          />
        )}

        <label className="mt-4 block text-xs font-semibold text-muted-foreground">
          URL da imagem
        </label>
        <input
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setPreviewError(false);
          }}
          placeholder="https://..."
          autoFocus
          className="mt-1 h-10 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-foreground"
        />

        <div className="mt-5 flex justify-between gap-2">
          <button
            type="button"
            onClick={() => onSave("")}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Remover
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={validateAndSave}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  selected,
  onToggle,
  onEditImage,
  onViewImage,
}: {
  product: Product;
  selected: boolean;
  onToggle: () => void;
  onEditImage: () => void;
  onViewImage: () => void;
}) {
  const allSizes = useMemo(() => availableSizes(product), [product]);

  return (
    <article
      className={`overflow-hidden rounded-lg border bg-card transition ${
        selected ? "border-foreground ring-1 ring-foreground" : "border-border"
      }`}
    >
      <div className="grid grid-cols-1 md:h-[340px] md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="relative h-64 bg-muted md:h-full">
          <button
            type="button"
            onClick={onViewImage}
            className={`block h-full w-full ${
              product.imageUrl ? "cursor-zoom-in" : "cursor-pointer"
            }`}
            aria-label={
              product.imageUrl
                ? `Ampliar imagem de ${product.reference}`
                : `Adicionar imagem para ${product.reference}`
            }
          >
            <ProductImage
              src={product.imageUrl}
              alt={product.reference}
              flush
              fit="contain"
              className="h-full w-full"
            />
          </button>
          <label className="absolute top-3 left-3 z-10 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border bg-background/95 shadow-sm">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="h-4 w-4 accent-black"
              aria-label={`Selecionar ${product.reference}`}
            />
          </label>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-3 p-4 sm:p-5">
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <div className="min-w-0">
              <h3 className="text-lg font-extrabold tracking-tight">{product.reference}</h3>
              <p className="truncate text-sm text-muted-foreground">{product.description}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-medium">
                <span className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">
                  {product.brand}
                </span>
                <span className="rounded border border-border px-1.5 py-0.5">
                  Col. {product.collection}
                </span>
                <span className="rounded border border-border px-1.5 py-0.5">
                  {product.subgroup}
                </span>
              </div>
              <label className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  checked={product.funcionario}
                  readOnly
                  className="pointer-events-none h-3.5 w-3.5 accent-black"
                  aria-label={`Produto ${product.funcionario ? "" : "nao "}disponivel para funcionario`}
                />
                Funcionário
              </label>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Total
              </div>
              <div className="text-2xl font-extrabold leading-none">
                {formatNum(product.totalQuantity)}
              </div>
              <div className="text-[10px] text-muted-foreground">peças</div>
            </div>
          </div>

          <div className="-mx-1 min-h-0 flex-1 overflow-auto pr-1">
            <table className="w-full min-w-max text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-semibold">Cor</th>
                  {allSizes.map((s) => (
                    <th key={s} className="px-2 py-1.5 text-right font-semibold">{s}</th>
                  ))}
                  <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {product.colors.map((c) => (
                  <tr key={c.name} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-1.5 font-medium">{c.name}</td>
                    {allSizes.map((s) => (
                      <td key={s} className="px-2 py-1.5 text-right tabular-nums">
                        {c.sizes[s] ?? 0}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums">
                      {c.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-auto flex justify-end">
            <button
              type="button"
              onClick={onEditImage}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {product.imageUrl ? "Corrigir imagem" : "Adicionar imagem"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductTable({
  items,
  selected,
  onToggle,
  onTogglePage,
  expandedRow,
  setExpandedRow,
  onEditImage,
  onViewImage,
}: {
  items: Product[];
  selected: Set<string>;
  onToggle: (ref: string) => void;
  onTogglePage: () => void;
  expandedRow: string | null;
  setExpandedRow: (r: string | null) => void;
  onEditImage: (ref: string) => void;
  onViewImage: (ref: string) => void;
}) {
  const allPageSelected = items.length > 0 && items.every((p) => selected.has(p.reference));
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="w-10 p-3">
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={onTogglePage}
                className="h-4 w-4 accent-black"
                aria-label="Selecionar todos da página"
              />
            </th>
            <th className="w-8 p-3"></th>
            <th className="w-24 p-3 text-left font-semibold">Imagem</th>
            <th className="p-3 text-left font-semibold">Referência</th>
            <th className="p-3 text-left font-semibold">Descrição</th>
            <th className="p-3 text-left font-semibold">Griffe</th>
            <th className="p-3 text-left font-semibold">Col.</th>
            <th className="p-3 text-left font-semibold">Subgrupo</th>
            <th className="p-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const expanded = expandedRow === p.reference;
            const isSel = selected.has(p.reference);
            const allSizes = availableSizes(p);
            return (
              <Fragment key={p.reference}>
                <tr
                  className={`border-t border-border ${isSel ? "bg-muted/60" : ""}`}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => onToggle(p.reference)}
                      className="h-4 w-4 accent-black"
                    />
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => setExpandedRow(expanded ? null : p.reference)}
                      aria-label="Expandir"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onViewImage(p.reference)}
                        className={`block ${p.imageUrl ? "cursor-zoom-in" : "cursor-pointer"}`}
                        aria-label={
                          p.imageUrl
                            ? `Ampliar imagem de ${p.reference}`
                            : `Adicionar imagem para ${p.reference}`
                        }
                      >
                        <ProductImage
                          src={p.imageUrl}
                          alt={p.reference}
                          className="h-12 w-12"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditImage(p.reference)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Corrigir imagem de ${p.reference}`}
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="p-3 font-bold">{p.reference}</td>
                  <td className="p-3 text-muted-foreground">{p.description}</td>
                  <td className="p-3">{p.brand}</td>
                  <td className="p-3">{p.collection}</td>
                  <td className="p-3">{p.subgroup}</td>
                  <td className="p-3 text-right font-bold tabular-nums">
                    {formatNum(p.totalQuantity)}
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-t border-border bg-muted/30">
                    <td colSpan={9} className="p-4">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-max text-xs">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="px-2 py-1.5 text-left font-semibold">Cor</th>
                              {allSizes.map((s) => (
                                <th key={s} className="px-2 py-1.5 text-right font-semibold">{s}</th>
                              ))}
                              <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.colors.map((c) => (
                              <tr key={c.name} className="border-b border-border/60 last:border-0">
                                <td className="px-2 py-1.5 font-medium">{c.name}</td>
                                {allSizes.map((s) => (
                                  <td key={s} className="px-2 py-1.5 text-right tabular-nums">
                                    {c.sizes[s] ?? 0}
                                  </td>
                                ))}
                                <td className="px-2 py-1.5 text-right font-bold tabular-nums">
                                  {c.total}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

