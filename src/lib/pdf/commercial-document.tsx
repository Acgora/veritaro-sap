/** @jsxRuntime automatic @jsxImportSource react */
// (pragma keeps the automatic JSX runtime under Vitest, whose tsconfig uses jsx: "preserve")
import { Document, Image, Page, StyleSheet, Text, View, type TextProps } from "@react-pdf/renderer";
import { formatMoney } from "@/lib/money";
import { formatDocDate } from "@/domain/commercial/dates";
import type { CommercialDocumentData } from "./document-data";

/**
 * ONE professional A4 template for quotes and (tax) invoices. Standard Helvetica (WinAnsi):
 * all text is normalised to characters that font can draw.
 */

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const BAND = "#f3f4f6";
const ACCENT = "#1f4e79";

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9, color: INK, lineHeight: 1.35 },
  row: { flexDirection: "row" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  sellerBlock: { width: "55%" },
  logo: { maxWidth: 140, maxHeight: 56, marginBottom: 8, objectFit: "contain" },
  sellerName: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  small: { fontSize: 8, color: MUTED },
  docBlock: { width: "40%", alignItems: "flex-end" },
  heading: { fontSize: 20, fontFamily: "Helvetica-Bold", color: ACCENT, textTransform: "uppercase", letterSpacing: 1 },
  draftTag: { marginTop: 4, paddingVertical: 2, paddingHorizontal: 6, backgroundColor: "#fef3c7", color: "#92400e", fontSize: 8, fontFamily: "Helvetica-Bold" },
  metaTable: { marginTop: 8, minWidth: 170 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  metaLabel: { color: MUTED, marginRight: 12 },
  metaValue: { fontFamily: "Helvetica-Bold" },
  parties: { flexDirection: "row", marginBottom: 16, gap: 16 },
  party: { flex: 1, padding: 10, backgroundColor: BAND, borderRadius: 3 },
  partyLabel: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 },
  partyName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  docTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4, marginBottom: 2 },
  thText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", color: MUTED },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 5 },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 50, textAlign: "right" },
  cPrice: { width: 72, textAlign: "right" },
  cDisc: { width: 60, textAlign: "right" },
  cTax: { width: 40, textAlign: "right" },
  cAmt: { width: 80, textAlign: "right" },
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
  totals: { width: 230 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  totGrand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, marginTop: 3, borderTopWidth: 1, borderTopColor: INK },
  totGrandText: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  dueBox: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 8, marginTop: 4, backgroundColor: ACCENT, color: "#ffffff" },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.8, color: MUTED, marginBottom: 3 },
  payBox: { marginTop: 16, padding: 10, borderWidth: 1, borderColor: LINE, borderRadius: 3 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
  watermark: { position: "absolute", top: 330, left: 0, right: 0, textAlign: "center", fontSize: 110, fontFamily: "Helvetica-Bold", color: "#9ca3af", opacity: 0.18, transform: "rotate(-30deg)" },
});

/** Map characters Helvetica/WinAnsi can't draw (narrow no-break space, smart dashes are fine). */
function pdfSafe(text: string): string {
  return text.replace(/[   ]/g, " ").replace(/[−]/g, "-").replace(/[^\n\t -ÿ–—‘’“”•…€]/g, "?");
}

function Lines({ text, style }: { text: string | null | undefined; style?: TextProps["style"] }) {
  if (!text) return null;
  return <Text style={style}>{pdfSafe(text)}</Text>;
}

export function CommercialDocument({ data: d }: { data: CommercialDocumentData }) {
  const money = (v: string) => pdfSafe(formatMoney(v, d.currency));
  const showDiscount = d.lines.some((l) => l.discount) || Number(d.totals.discountTotal) > 0;
  const showTax = d.tax.registered;
  const taxName = d.tax.label || "VAT";
  const amountHeader = d.tax.pricesInclude && showTax ? `Amount (incl. ${taxName})` : showTax ? `Amount (excl. ${taxName})` : "Amount";
  const docLabel = `${d.heading}${d.number ? ` ${d.number}` : ""}`;
  const partyLabel = d.kind === "quote" ? "Quote for" : "Bill to";

  return (
    <Document title={pdfSafe(`${d.draft ? "DRAFT " : ""}${docLabel}`)} author={pdfSafe(d.seller.name)} creator="Veritaro" producer="Veritaro">
      <Page size="A4" style={s.page}>
        {d.draft ? <Text style={s.watermark} fixed>DRAFT</Text> : d.watermark ? <Text style={s.watermark} fixed>{d.watermark}</Text> : null}

        <View style={s.header}>
          <View style={s.sellerBlock}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt attribute */}
            {d.seller.logo ? <Image style={s.logo} src={{ data: d.seller.logo.data, format: d.seller.logo.format }} /> : null}
            <Text style={s.sellerName}>{pdfSafe(d.seller.name)}</Text>
            {d.seller.legalName && d.seller.legalName !== d.seller.name ? <Lines text={d.seller.legalName} /> : null}
            <Lines text={d.seller.address} />
            {d.seller.phone || d.seller.email ? <Text>{pdfSafe([d.seller.phone, d.seller.email].filter(Boolean).join("  ·  "))}</Text> : null}
            {d.seller.registration ? <Text style={s.small}>Reg. no. {pdfSafe(d.seller.registration)}</Text> : null}
            {d.seller.tax ? <Text style={s.small}>{pdfSafe(taxName)} no. {pdfSafe(d.seller.tax)}</Text> : null}
          </View>
          <View style={s.docBlock}>
            <Text style={s.heading}>{pdfSafe(d.heading)}</Text>
            {d.draft ? <Text style={s.draftTag}>DRAFT - NOT ISSUED</Text> : null}
            <View style={s.metaTable}>
              <View style={s.metaRow}><Text style={s.metaLabel}>Number</Text><Text style={s.metaValue}>{d.number ? pdfSafe(d.number) : "Assigned when issued"}</Text></View>
              <View style={s.metaRow}><Text style={s.metaLabel}>Date</Text><Text style={s.metaValue}>{formatDocDate(d.issueDate)}</Text></View>
              {d.secondaryDate ? (
                <View style={s.metaRow}><Text style={s.metaLabel}>{d.secondaryDate.label}</Text><Text style={s.metaValue}>{formatDocDate(d.secondaryDate.value)}</Text></View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.partyLabel}>{partyLabel}</Text>
            <Text style={s.partyName}>{pdfSafe(d.customer.name)}</Text>
            {d.customer.contactName ? <Text>Attn: {pdfSafe(d.customer.contactName)}</Text> : null}
            <Lines text={d.customer.address} />
            {d.customer.contactPhone || d.customer.contactEmail ? (
              <Text>{pdfSafe([d.customer.contactPhone, d.customer.contactEmail].filter(Boolean).join("  ·  "))}</Text>
            ) : null}
            {d.customer.registration ? <Text style={s.small}>Reg. no. {pdfSafe(d.customer.registration)}</Text> : null}
            {d.customer.tax ? <Text style={s.small}>{pdfSafe(taxName)} no. {pdfSafe(d.customer.tax)}</Text> : null}
          </View>
          {d.customer.siteAddress && d.customer.siteAddress !== d.customer.address ? (
            <View style={s.party}>
              <Text style={s.partyLabel}>Site</Text>
              <Lines text={d.customer.siteAddress} />
            </View>
          ) : null}
        </View>

        {d.title ? <Text style={s.docTitle}>{pdfSafe(d.title)}</Text> : null}

        <View style={s.th} fixed>
          <Text style={[s.thText, s.cDesc]}>Description</Text>
          <Text style={[s.thText, s.cQty]}>Qty</Text>
          <Text style={[s.thText, s.cPrice]}>Unit price</Text>
          {showDiscount ? <Text style={[s.thText, s.cDisc]}>Discount</Text> : null}
          {showTax ? <Text style={[s.thText, s.cTax]}>{pdfSafe(taxName)}</Text> : null}
          <Text style={[s.thText, s.cAmt]}>{pdfSafe(amountHeader)}</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.cDesc}>{pdfSafe(l.description)}</Text>
            <Text style={s.cQty}>{pdfSafe(`${l.quantity}${l.unit ? ` ${l.unit}` : ""}`)}</Text>
            <Text style={s.cPrice}>{money(l.unitPrice)}</Text>
            {showDiscount ? (
              <Text style={s.cDisc}>{l.discount ? (l.discount.type === "percent" ? `${l.discount.value}%` : money(l.discount.amount)) : ""}</Text>
            ) : null}
            {showTax ? <Text style={s.cTax}>{l.taxable ? `${d.tax.rate}%` : "0%"}</Text> : null}
            <Text style={s.cAmt}>{money(l.amount)}</Text>
          </View>
        ))}

        <View style={s.totalsWrap} wrap={false}>
          <View style={s.totals}>
            {showDiscount ? (
              <View style={s.totRow}><Text>Discount included</Text><Text>-{money(d.totals.discountTotal)}</Text></View>
            ) : null}
            <View style={s.totRow}><Text>{showTax ? `Subtotal (excl. ${pdfSafe(taxName)})` : "Subtotal"}</Text><Text>{money(d.totals.subtotal)}</Text></View>
            {showTax ? (
              <View style={s.totRow}><Text>{pdfSafe(`${taxName} @ ${d.tax.rate}%`)}</Text><Text>{money(d.totals.taxTotal)}</Text></View>
            ) : null}
            <View style={s.totGrand}><Text style={s.totGrandText}>Total</Text><Text style={s.totGrandText}>{money(d.totals.total)}</Text></View>
            {d.payment && Number(d.payment.amountPaid) > 0 ? (
              <View style={s.totRow}><Text>Paid</Text><Text>-{money(d.payment.amountPaid)}</Text></View>
            ) : null}
            {d.payment ? (
              <View style={s.dueBox}><Text style={{ fontFamily: "Helvetica-Bold" }}>Amount due</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{money(d.payment.amountDue)}</Text></View>
            ) : null}
          </View>
        </View>
        {showTax && d.tax.pricesInclude ? <Text style={[s.small, { textAlign: "right", marginTop: 3 }]}>Prices include {pdfSafe(taxName)}.</Text> : null}

        {d.payment ? (
          <View style={s.payBox} wrap={false}>
            <Text style={s.sectionTitle}>How to pay</Text>
            {d.payment.details ? <Lines text={d.payment.details} /> : <Text style={s.small}>Contact us for payment details.</Text>}
            {d.number ? <Text style={{ marginTop: 3 }}>Please use <Text style={{ fontFamily: "Helvetica-Bold" }}>{pdfSafe(d.number)}</Text> as your payment reference.</Text> : null}
          </View>
        ) : null}

        {d.notes ? (
          <View style={s.section} wrap={false}><Text style={s.sectionTitle}>Notes</Text><Lines text={d.notes} /></View>
        ) : null}
        {d.terms ? (
          <View style={s.section}><Text style={s.sectionTitle}>Terms</Text><Lines text={d.terms} style={{ fontSize: 8 }} /></View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{pdfSafe(`${d.seller.legalName ?? d.seller.name}${d.seller.registration ? ` · Reg. ${d.seller.registration}` : ""}`)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pdfSafe(docLabel)}${d.draft ? " (draft)" : ""} · Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
