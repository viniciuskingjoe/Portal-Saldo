const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR");

export const formatBRL = (n: number) => BRL.format(Math.max(0, n));
export const formatNum = (n: number) => NUM.format(Math.max(0, n));
export const formatTime = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const formatDateTime = (d: Date) =>
  `${d.toLocaleDateString("pt-BR")} ${formatTime(d)}`;
