export const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const numero = new Intl.NumberFormat("pt-BR");

export function formatarPercentual(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function formatarMes(mes: string): string {
  return new Date(`${mes}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function dataHoje(): string {
  return dataLocal(new Date());
}

export function mesHoje(): string {
  return dataHoje().slice(0, 7);
}

function dataLocal(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
