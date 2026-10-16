import zlib from "node:zlib";

/** Extract the visible text of a react-pdf/pdfkit PDF (inflates content streams, decodes TJ hex strings). */
export function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let content: string;
    try {
      content = zlib.inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...tj[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join("");
      out.push(Buffer.from(hex, "hex").toString("latin1"));
    }
  }
  return out.join(" ");
}
