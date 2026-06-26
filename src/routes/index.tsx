import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Grid3x3,
  ImageIcon,
  ImageOff,
  LayoutList,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";

import { Toaster } from "@/components/ui/sonner";
import { generateMockStock } from "@/lib/mock-stock";
import type { Filters, Product, SortKey, ViewMode } from "@/lib/stock-types";
import { formatBRL, formatNum, formatTime } from "@/lib/format";
import { exportToExcel, exportToPdf } from "@/lib/exporters";

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
  sellin_desc: "Maior Sell In",
  sellin_asc: "Menor Sell In",
  sellout_desc: "Maior Sell Out",
  sellout_asc: "Menor Sell Out",
};

const EMPTY_FILTERS: Filters = {
  search: "",
  brands: [],
  collections: [],
  subgroups: [],
  colors: [],
  sizes: [],
  minQty: null,
  maxQty: null,
};

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
      case "sellin_desc": return b.sellIn - a.sellIn;
      case "sellin_asc": return a.sellIn - b.sellIn;
      case "sellout_desc": return b.sellOut - a.sellOut;
      case "sellout_asc": return a.sellOut - b.sellOut;
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
    if (f.sizes.length) {
      const available = new Set<string>();
      for (const c of p.colors) {
        for (const [sz, qty] of Object.entries(c.sizes)) {
          if (qty > 0) available.add(sz);
        }
      }
      if (!f.sizes.some((s) => available.has(s))) return false;
    }
    if (f.minQty != null && p.totalQuantity < f.minQty) return false;
    if (f.maxQty != null && p.totalQuantity > f.maxQty) return false;
    return true;
  });
}

function PortalPage() {
  const [allProducts, setAllProducts] = useState<Product[]>(() => generateMockStock(120));
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
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
  const [editingImageRef, setEditingImageRef] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [imageCache, setImageCache] = useState<Record<string, string>>({});

  // Persist view
  useEffect(() => {
    localStorage.setItem("psv-view", view);
  }, [view]);

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
      setLastUpdate(new Date());
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const refresh = () => {
    setLoading(true);
    setTimeout(() => {
      setLastUpdate(new Date());
      setLoading(false);
      toast.success("Estoque atualizado.");
    }, 600);
  };

  // Apply image overrides
  const products = useMemo(
    () =>
      allProducts.map((p) =>
        imageCache[p.reference] ? { ...p, imageUrl: imageCache[p.reference] } : p,
      ),
    [allProducts, imageCache],
  );

  // Distinct filter options
  const opts = useMemo(() => {
    const brands = new Set<string>();
    const collections = new Set<string>();
    const subgroups = new Set<string>();
    const colors = new Set<string>();
    const sizes = new Set<string>();
    for (const p of products) {
      brands.add(p.brand);
      collections.add(p.collection);
      subgroups.add(p.subgroup);
      for (const c of p.colors) {
        colors.add(c.name);
        for (const sz of Object.keys(c.sizes)) sizes.add(sz);
      }
    }
    return {
      brands: [...brands].sort(),
      collections: [...collections].sort(),
      subgroups: [...subgroups].sort(),
      colors: [...colors].sort(),
      sizes: [...sizes].sort((a, b) => {
        const na = Number(a), nb = Number(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      }),
    };
  }, [products]);

  const filtered = useMemo(() => applyFilters(products, filters), [products, filters]);
  const sorted = useMemo(() => sortProducts(filtered, sort), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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

  const selectedProducts = useMemo(
    () => products.filter((p) => selected.has(p.reference)),
    [products, selected],
  );

  const handleExportPdf = (onlySelected: boolean) => {
    const list = onlySelected ? selectedProducts : sorted;
    if (!list.length) return toast.error("Nenhum produto para exportar.");
    exportToPdf(list);
    toast.success("PDF gerado com sucesso.");
  };
  const handleExportExcel = (onlySelected: boolean) => {
    const list = onlySelected ? selectedProducts : sorted;
    if (!list.length) return toast.error("Nenhum produto para exportar.");
    exportToExcel(list);
    toast.success("Planilha exportada com sucesso.");
  };

  const handleShare = () => {
    const params = new URLSearchParams();
    if (selected.size) params.set("refs", [...selected].join(","));
    if (filters.search) params.set("q", filters.search);
    if (filters.brands.length) params.set("brands", filters.brands.join(","));
    if (filters.collections.length) params.set("collections", filters.collections.join(","));
    if (filters.subgroups.length) params.set("subgroups", filters.subgroups.join(","));
    if (filters.colors.length) params.set("colors", filters.colors.join(","));
    if (filters.sizes.length) params.set("sizes", filters.sizes.join(","));
    const url = `${window.location.origin}/?${params.toString()}`;
    navigator.clipboard.writeText(url).then(() => {
      toast.success("Link da seleção copiado com sucesso.");
    });
  };

  const activeFilterCount =
    filters.brands.length +
    filters.collections.length +
    filters.subgroups.length +
    filters.colors.length +
    filters.sizes.length +
    (filters.minQty != null ? 1 : 0) +
    (filters.maxQty != null ? 1 : 0);

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

  const editingProduct = products.find((p) => p.reference === editingImageRef) ?? null;

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
                    loading ? "animate-pulse bg-muted-foreground" : "bg-foreground"
                  }`}
                />
                <span className="font-medium">{loading ? "Atualizando" : "Conectado"}</span>
                <span className="text-muted-foreground">· {formatTime(lastUpdate)}</span>
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
            value={formatTime(lastUpdate)}
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
            <div className="mt-3 rounded-lg border border-border bg-card p-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <FilterChips
                  label="Griffe"
                  options={opts.brands}
                  selected={filters.brands}
                  onToggle={(v) => toggleArr("brands", v)}
                />
                <FilterChips
                  label="Coleção"
                  options={opts.collections}
                  selected={filters.collections}
                  onToggle={(v) => toggleArr("collections", v)}
                />
                <FilterChips
                  label="Subgrupo"
                  options={opts.subgroups}
                  selected={filters.subgroups}
                  onToggle={(v) => toggleArr("subgroups", v)}
                />
                <FilterChips
                  label="Cor"
                  options={opts.colors}
                  selected={filters.colors}
                  onToggle={(v) => toggleArr("colors", v)}
                />
                <FilterChips
                  label="Tamanho disponível"
                  options={opts.sizes}
                  selected={filters.sizes}
                  onToggle={(v) => toggleArr("sizes", v)}
                />
                <div>
                  <div className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Quantidade total
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      placeholder="Mín."
                      value={filters.minQty ?? ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        setFilters((f) => ({ ...f, minQty: v }));
                        setPage(1);
                      }}
                      className="w-1/2 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="Máx."
                      value={filters.maxQty ?? ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        setFilters((f) => ({ ...f, maxQty: v }));
                        setPage(1);
                      }}
                      className="w-1/2 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                    />
                  </div>
                </div>
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
              {filters.sizes.map((v) => (
                <Chip key={`sz-${v}`} label={`Tam. ${v}`} onRemove={() => toggleArr("sizes", v)} />
              ))}
              {filters.minQty != null && (
                <Chip label={`Mín. ${filters.minQty}`} onRemove={() => setFilters((f) => ({ ...f, minQty: null }))} />
              )}
              {filters.maxQty != null && (
                <Chip label={`Máx. ${filters.maxQty}`} onRemove={() => setFilters((f) => ({ ...f, maxQty: null }))} />
              )}
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
            <button
              onClick={() => handleExportPdf(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
            >
              <FileText className="h-3.5 w-3.5" />
              PDF
            </button>
            <button
              onClick={() => handleExportExcel(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel
            </button>
          </div>
        </section>

        {/* Results */}
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
              />
            ))}
          </div>
        ) : (
          <ProductTable
            items={pageItems}
            selected={selected}
            onToggle={toggleSelect}
            onTogglePage={toggleSelectPage}
            onEditImage={(r) => setEditingImageRef(r)}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
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
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setPage((p) => p + 1)}
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
                onClick={() => handleExportPdf(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                <FileText className="h-3.5 w-3.5" /> PDF da seleção
              </button>
              <button
                onClick={() => handleExportExcel(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel da seleção
              </button>
              <button
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                <Share2 className="h-3.5 w-3.5" /> Compartilhar
              </button>
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

      {/* Image edit dialog */}
      {editingProduct && (
        <ImageEditDialog
          product={editingProduct}
          onClose={() => setEditingImageRef(null)}
          onSave={(url) => {
            setImageCache((c) => ({ ...c, [editingProduct.reference]: url }));
            setEditingImageRef(null);
            toast.success("Imagem da referência atualizada com sucesso.");
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

function FilterChips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              onClick={() => onToggle(o)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                on
                  ? "border-foreground bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              {on && <Check className="mr-1 inline h-3 w-3" />}
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProductImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [error, setError] = useState(false);
  useEffect(() => { setError(false); }, [src]);

  if (!src || error) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground ${className ?? ""}`}>
        <ImageOff className="h-6 w-6" />
        <span className="text-[10px]">Imagem indisponível</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setError(true)}
      className={className}
    />
  );
}

function ProductCard({
  product,
  selected,
  onToggle,
  onEditImage,
}: {
  product: Product;
  selected: boolean;
  onToggle: () => void;
  onEditImage: () => void;
}) {
  const allSizes = useMemo(
    () => Array.from(new Set(product.colors.flatMap((c) => Object.keys(c.sizes)))).sort((a, b) => {
      const na = Number(a), nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    }),
    [product],
  );

  return (
    <article
      className={`overflow-hidden rounded-lg border bg-card transition ${
        selected ? "border-foreground ring-1 ring-foreground" : "border-border"
      }`}
    >
      <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="relative bg-muted">
          <ProductImage
            src={product.imageUrl}
            alt={product.reference}
            className="aspect-[3/4] w-full object-cover md:aspect-auto md:h-full"
          />
          <label className="absolute top-3 left-3 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border bg-background">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="h-4 w-4 accent-black"
              aria-label={`Selecionar ${product.reference}`}
            />
          </label>
        </div>

        <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
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
              <p className="mt-1 text-xs text-muted-foreground">{product.composition}</p>
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

          <div className="flex gap-6 border-y border-border py-2">
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Sell In
              </div>
              <div className="text-sm font-bold">{formatBRL(product.sellIn)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Sell Out
              </div>
              <div className="text-sm font-bold">{formatBRL(product.sellOut)}</div>
            </div>
          </div>

          <div className="-mx-1 overflow-x-auto no-scrollbar">
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
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums">{c.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button
              onClick={onEditImage}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <ImageIcon className="h-3.5 w-3.5" /> Corrigir imagem
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
  onEditImage,
  expandedRow,
  setExpandedRow,
}: {
  items: Product[];
  selected: Set<string>;
  onToggle: (ref: string) => void;
  onTogglePage: () => void;
  onEditImage: (ref: string) => void;
  expandedRow: string | null;
  setExpandedRow: (r: string | null) => void;
}) {
  const allPageSelected = items.length > 0 && items.every((p) => selected.has(p.reference));
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[900px] text-sm">
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
            <th className="w-14 p-3"></th>
            <th className="p-3 text-left font-semibold">Referência</th>
            <th className="p-3 text-left font-semibold">Descrição</th>
            <th className="p-3 text-left font-semibold">Griffe</th>
            <th className="p-3 text-left font-semibold">Col.</th>
            <th className="p-3 text-left font-semibold">Subgrupo</th>
            <th className="p-3 text-right font-semibold">Sell In</th>
            <th className="p-3 text-right font-semibold">Sell Out</th>
            <th className="p-3 text-right font-semibold">Total</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const expanded = expandedRow === p.reference;
            const isSel = selected.has(p.reference);
            const allSizes = Array.from(
              new Set(p.colors.flatMap((c) => Object.keys(c.sizes))),
            );
            return (
              <>
                <tr
                  key={p.reference}
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
                    <ProductImage
                      src={p.imageUrl}
                      alt={p.reference}
                      className="h-10 w-10 rounded object-cover"
                    />
                  </td>
                  <td className="p-3 font-bold">{p.reference}</td>
                  <td className="p-3 text-muted-foreground">{p.description}</td>
                  <td className="p-3">{p.brand}</td>
                  <td className="p-3">{p.collection}</td>
                  <td className="p-3">{p.subgroup}</td>
                  <td className="p-3 text-right tabular-nums">{formatBRL(p.sellIn)}</td>
                  <td className="p-3 text-right tabular-nums">{formatBRL(p.sellOut)}</td>
                  <td className="p-3 text-right font-bold tabular-nums">
                    {formatNum(p.totalQuantity)}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => onEditImage(p.reference)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      aria-label="Corrigir imagem"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr key={`${p.reference}-x`} className="border-t border-border bg-muted/30">
                    <td colSpan={12} className="p-4">
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
              </>
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

function ImageEditDialog({
  product,
  onClose,
  onSave,
}: {
  product: Product;
  onClose: () => void;
  onSave: (url: string) => void;
}) {
  const [url, setUrl] = useState(product.imageUrl);
  const [previewError, setPreviewError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validate = () => {
    if (!url.trim()) {
      toast.error("Não foi possível atualizar a imagem. Verifique a URL e tente novamente.");
      return;
    }
    try {
      const u = new URL(url);
      if (!["https:", "http:"].includes(u.protocol)) {
        toast.error("Não foi possível atualizar a imagem. Verifique a URL e tente novamente.");
        return;
      }
    } catch {
      toast.error("Não foi possível atualizar a imagem. Verifique a URL e tente novamente.");
      return;
    }
    if (previewError) {
      toast.error("Não foi possível atualizar a imagem. Verifique a URL e tente novamente.");
      return;
    }
    onSave(url.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold">Corrigir imagem</h2>
            <p className="text-xs text-muted-foreground">Referência {product.reference}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Atual
            </div>
            <ProductImage
              src={product.imageUrl}
              alt="Atual"
              className="aspect-square w-full rounded object-cover"
            />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Pré-visualização
            </div>
            {url ? (
              <img
                src={url}
                alt="Pré-visualização"
                onLoad={() => setPreviewError(false)}
                onError={() => setPreviewError(true)}
                className="aspect-square w-full rounded object-cover"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-muted-foreground">
                <ImageOff className="h-6 w-6" />
              </div>
            )}
          </div>
        </div>

        <label className="mt-4 block text-xs font-semibold text-muted-foreground">
          URL da nova imagem
        </label>
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setPreviewError(false);
          }}
          placeholder="https://catalogo.exemplo.com/produtos/..."
          className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            onClick={validate}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Copy className="hidden" />
            <Download className="hidden" />
            Salvar imagem
          </button>
        </div>
      </div>
    </div>
  );
}
