import { TemplateReadError } from "./template-profile";
import { parseTag } from "./zip-gate";

// ponytail: a small forward XML tokenizer, not a general parser. It reports start tags
// (attributes tokenized by the gate's strict tag reader), text and end tags, and decodes
// what SpreadsheetML uses: the five predefined entities and character references. The
// gate has already refused DOCTYPE and entity declarations and anything not UTF-8;
// whatever else this cannot read plainly (CDATA, a stray "&", a mismatched end tag)
// is refused as not a workbook.

export interface XmlHandler {
  open(name: string, attributes: Map<string, string>): void;
  /** Text between tags, decoded. Not called when absent. */
  text?(text: string): void;
  close(name: string): void;
}

const NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
const ENTITY = /&(?:(lt|gt|amp|apos|quot)|#(\d{1,7})|#x([0-9A-Fa-f]{1,6}));/y;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };
/** How many tags between two looks at the clock. */
const CHECK_EVERY = 4096;

const notAWorkbook = () => new TemplateReadError("NOT_A_WORKBOOK");

/**
 * Reads `xml` from `from` to the end. A whole document must have exactly one root element.
 * With `partial`, reading starts inside it: end tags of elements opened before `from` are
 * reported too. `check` is called now and then, and may throw to stop the reading.
 */
export function readXml(xml: string, handler: XmlHandler, check: () => void, from = 0, partial = false): void {
  const open: string[] = [];
  let roots = 0;
  let tags = 0;
  let i = from;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const end = lt < 0 ? xml.length : lt;
    if (end > i) {
      const raw = xml.slice(i, end);
      if (!open.length && !partial) {
        if (raw.trim()) throw notAWorkbook();
      } else if (handler.text) {
        handler.text(decodeText(raw));
      } else if (raw.includes("&")) {
        decodeText(raw); // still refused when malformed
      }
    }
    if (lt < 0) break;
    if (++tags % CHECK_EVERY === 0) check();
    const next = xml[lt + 1];
    if (next === "/") {
      const expected = open.pop();
      let name = expected;
      if (expected === undefined || !xml.startsWith(expected, lt + 2)) {
        NAME.lastIndex = lt + 2;
        name = NAME.exec(xml)?.[0];
        if (!name || expected !== undefined || !partial) throw notAWorkbook();
      }
      i = lt + 2 + name!.length;
      while (" \t\r\n".includes(xml[i] ?? "<")) i++;
      if (xml[i] !== ">") throw notAWorkbook();
      i++;
      handler.close(name!);
    } else if (next === "!") {
      // Comments are skipped; CDATA and declarations are not something Excel writes.
      if (!xml.startsWith("<!--", lt)) throw notAWorkbook();
      const close = xml.indexOf("-->", lt + 4);
      if (close < 0) throw notAWorkbook();
      i = close + 3;
    } else if (next === "?") {
      const close = xml.indexOf("?>", lt + 2);
      if (close < 0) throw notAWorkbook();
      i = close + 2;
    } else {
      NAME.lastIndex = lt + 1;
      const name = NAME.exec(xml)?.[0];
      if (!name) throw notAWorkbook();
      if (!open.length && !partial && roots++) throw notAWorkbook();
      const tag = parseTag(xml, lt + 1 + name.length, decodeAttribute);
      handler.open(name, tag.attributes);
      if (tag.selfClosing) handler.close(name);
      else open.push(name);
      i = tag.end;
    }
  }
  if (open.length || (!partial && !roots)) throw notAWorkbook();
}

/** Line breaks are normalized to "\n" before entities are decoded, as an XML parser does. */
function decodeText(raw: string): string {
  if (!/[&\r]/.test(raw)) return raw;
  return decodeEntities(raw.replace(/\r\n?/g, "\n"));
}

/** In attribute values every literal line break or tab is a space. */
function decodeAttribute(raw: string): string {
  if (!/[&\t\n\r]/.test(raw)) return raw;
  return decodeEntities(raw.replace(/\r\n|[\t\n\r]/g, " "));
}

function decodeEntities(text: string): string {
  let amp = text.indexOf("&");
  if (amp < 0) return text;
  let out = "";
  let i = 0;
  while (amp >= 0) {
    ENTITY.lastIndex = amp;
    const match = ENTITY.exec(text);
    if (!match) throw notAWorkbook();
    out += text.slice(i, amp);
    if (match[1]) {
      out += PREDEFINED[match[1]];
    } else {
      const code = match[2] ? Number(match[2]) : parseInt(match[3], 16);
      const allowed = code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff)
        || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
      if (!allowed) throw notAWorkbook();
      out += String.fromCodePoint(code);
    }
    i = amp + match[0].length;
    amp = text.indexOf("&", i);
  }
  return out + text.slice(i);
}
