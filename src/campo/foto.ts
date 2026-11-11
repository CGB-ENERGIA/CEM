import { FOTO_TAMANHO_MAXIMO } from "../lib/compartilhado";

// Foto da câmera do celular costuma passar de 4 MB. Antes de guardar ou enviar, ela é redesenhada em JPEG menor:
// o lado maior fica em até 1600 px e a qualidade cai até o arquivo caber no limite do servidor.
const LADO_MAXIMO = 1600;
const QUALIDADES = [0.8, 0.65, 0.5, 0.35];

function paraJpeg(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise((resolver) => canvas.toBlob(resolver, "image/jpeg", qualidade));
}

export async function reduzirFoto(arquivo: File): Promise<Blob> {
  if (!arquivo.type.startsWith("image/")) throw new Error("O arquivo escolhido não é uma imagem.");

  let imagem: ImageBitmap;
  try {
    // "from-image" aplica a rotação gravada pela câmera; sem isso a foto de retrato sairia deitada.
    imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Não foi possível ler esta foto. Tire outra.");
  }

  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagem.width * escala));
    canvas.height = Math.max(1, Math.round(imagem.height * escala));
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("Não foi possível preparar a foto.");
    contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height);

    for (const qualidade of QUALIDADES) {
      const blob = await paraJpeg(canvas, qualidade);
      if (blob && blob.size <= FOTO_TAMANHO_MAXIMO) return blob;
    }
    throw new Error("A foto ficou grande demais. Tire outra.");
  } finally {
    imagem.close();
  }
}
