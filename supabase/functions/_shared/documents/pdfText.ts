// Extração da camada de texto do PDF.
//
// Faturas e extratos digitais quase sempre têm texto embutido. Ler esse texto
// permite conciliação determinística (rótulos, subtotais e todas as linhas),
// deixando o modelo de visão apenas para PDFs escaneados e categorização.

export type PdfTextResult = {
  text: string;
  pages: string[];
  hasTextLayer: boolean;
};

const MIN_CHARS_PER_DOC = 200;

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  try {
    const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf@0.12.1");
    const copy = new Uint8Array(bytes);
    const pdf = await getDocumentProxy(copy);
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text.map((p) => String(p ?? "")) : [String(text ?? "")];
    const joined = pages.join("\n");
    return {
      text: joined,
      pages,
      hasTextLayer: joined.replace(/\s/g, "").length >= MIN_CHARS_PER_DOC,
    };
  } catch (error) {
    console.warn("[pdfText] extraction_failed", String(error).slice(0, 200));
    return { text: "", pages: [], hasTextLayer: false };
  }
}
