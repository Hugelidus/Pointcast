import { composedParent, isShadowRoot } from "./dom";
import { isSensitive, isSensitiveSelf, type SensitivityOptions } from "./sensitive";
import { INLINE_TAGS, collapseWhitespace, isTextOpaque, truncate } from "./text";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Long selections are kept for context, not verbatim: the agent needs to recognise the passage. */
const MAX_SELECTION_TEXT = 500;

export interface RangeReading {
  /** Element that contains the whole range (the common ancestor, or its parent for a text node). */
  container: Element | null;
  /** Selected visible text, collapsed and trimmed; "" when the range touches anything sensitive. */
  text: string;
  /** True when the range is inside, or crosses, a sensitive element. */
  sensitive: boolean;
}

/**
 * The element a range boundary points into (text nodes resolve to their parent, and a text node
 * directly under a shadow root to its host).
 */
export function boundaryElement(node: Node): Element | null {
  if (node.nodeType === ELEMENT_NODE) return node as Element;
  return isShadowRoot(node) ? node.host : composedParent(node);
}

function touchesSensitive(range: Range, container: Element, options: SensitivityOptions): boolean {
  if (isSensitive(container, options)) return true;
  // A range spanning a whole shadow root has the root, not its host, as common ancestor, and
  // the host's querySelectorAll does not see inside it.
  const common = range.commonAncestorContainer;
  const scope: ParentNode = isShadowRoot(common) ? common : container;
  // Only these can be sensitive by themselves (isSensitiveSelf); avoids scanning every element.
  const candidates = scope.querySelectorAll(`input, [autocomplete], [${CSS.escape(options.sensitiveAttribute)}]`);
  return Array.from(candidates).some(
    (el) => range.intersectsNode(el) && isSensitiveSelf(el, options),
  );
}

/** A text node counts only when no ancestor hides it or makes it a form value / secret. */
function isReadableText(node: Text, options: SensitivityOptions): boolean {
  for (let el = composedParent(node); el !== null; el = composedParent(el)) {
    if (isTextOpaque(el, options)) return false;
  }
  return true;
}

function nearestBlock(node: Node): Element | null {
  let el = node.parentElement;
  while (el !== null && INLINE_TAGS.has(el.localName)) el = el.parentElement;
  return el;
}

/**
 * Reads a selection range without Selection.toString(): walking text nodes lets us skip form
 * controls (a selection inside a textarea would otherwise return what the user typed) and
 * detect sensitive elements the range crosses.
 */
export function readRange(range: Range, options: SensitivityOptions): RangeReading {
  const common = range.commonAncestorContainer;
  const container = boundaryElement(common);
  if (container === null) return { container, text: "", sensitive: false };
  if (touchesSensitive(range, container, options)) return { container, text: "", sensitive: true };

  const doc = container.ownerDocument;
  // 4 = NodeFilter.SHOW_TEXT; the numeric value avoids depending on a realm's NodeFilter global.
  const walker = doc.createTreeWalker(common, 4);
  const nodes: Text[] = common.nodeType === TEXT_NODE ? [common as Text] : [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text);

  let text = "";
  let previousBlock: Element | null = null;
  for (const node of nodes) {
    if (!range.intersectsNode(node) || !isReadableText(node, options)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    const block = nearestBlock(node);
    // Text from different blocks ("<td>a</td><td>b</td>") must not run together.
    if (previousBlock !== null && block !== previousBlock) text += " ";
    text += node.data.slice(start, end);
    previousBlock = block;
  }
  return { container, text: truncate(collapseWhitespace(text), MAX_SELECTION_TEXT), sensitive: false };
}
