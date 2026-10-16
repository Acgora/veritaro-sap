import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { CommercialDocument } from "./commercial-document";
import type { CommercialDocumentData } from "./document-data";

/**
 * Render the commercial document to a PDF buffer (Node runtime only).
 * @react-pdf/renderer is in Next 15's built-in serverExternalPackages list, so it loads
 * from node_modules in route handlers without next.config changes.
 */
export async function renderCommercialPdf(data: CommercialDocumentData): Promise<Buffer> {
  const element = createElement(CommercialDocument, { data }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
