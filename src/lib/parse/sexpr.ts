/**
 * S-expression reader for KiCad files.
 *
 * Both `.kicad_sch` and `.net` are Lisp-ish, so one reader covers both. The
 * only unusual requirement is that every node remembers the line it started
 * on — that's what lets the rest of the app point at "netlist.net:41" when it
 * makes a claim.
 */

export interface SAtom {
  kind: "atom";
  value: string;
  quoted: boolean;
  line: number;
}

export interface SList {
  kind: "list";
  items: SNode[];
  line: number;
}

export type SNode = SAtom | SList;

const WHITESPACE = new Set([" ", "\t", "\r", "\n"]);

/**
 * Parses a whole document. KiCad files have a single root form, but some
 * exports concatenate several, so this returns all top-level forms.
 *
 * Malformed input never throws — a truncated file still yields whatever was
 * readable up to the break. Design exports get hand-edited more often than
 * you'd like, and half a netlist is more useful than an error page.
 */
export function parseSexpr(text: string): SList[] {
  const roots: SList[] = [];
  const stack: SList[] = [];
  let line = 1;
  let i = 0;

  const push = (node: SNode) => {
    const top = stack[stack.length - 1];
    if (top) top.items.push(node);
    else if (node.kind === "list") roots.push(node);
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (WHITESPACE.has(ch)) {
      i += 1;
      continue;
    }

    // KiCad doesn't emit comments, but hand-edited files sometimes have them.
    if (ch === ";") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "(") {
      const node: SList = { kind: "list", items: [], line };
      stack.push(node);
      i += 1;
      continue;
    }

    if (ch === ")") {
      const done = stack.pop();
      if (done) {
        if (stack.length === 0) roots.push(done);
        else stack[stack.length - 1].items.push(done);
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      const startLine = line;
      let value = "";
      i += 1;
      while (i < text.length) {
        const c = text[i];
        if (c === "\\" && i + 1 < text.length) {
          const next = text[i + 1];
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          if (next === "\n") line += 1;
          i += 2;
          continue;
        }
        if (c === '"') {
          i += 1;
          break;
        }
        if (c === "\n") line += 1;
        value += c;
        i += 1;
      }
      push({ kind: "atom", value, quoted: true, line: startLine });
      continue;
    }

    const startLine = line;
    let value = "";
    while (i < text.length && !WHITESPACE.has(text[i]) && text[i] !== "(" && text[i] !== ")") {
      value += text[i];
      i += 1;
    }
    push({ kind: "atom", value, quoted: false, line: startLine });
  }

  // Anything still open was truncated; keep it rather than dropping it.
  while (stack.length) {
    const node = stack.pop()!;
    if (stack.length === 0) roots.push(node);
  }

  return roots;
}

/** The symbol at the head of a list, e.g. "symbol" for `(symbol ...)`. */
export function head(node: SNode): string | null {
  if (node.kind !== "list") return null;
  const first = node.items[0];
  return first && first.kind === "atom" ? first.value : null;
}

/** Direct children that are lists headed by `name`. */
export function children(node: SNode, name: string): SList[] {
  if (node.kind !== "list") return [];
  return node.items.filter(
    (item): item is SList => item.kind === "list" && head(item) === name,
  );
}

/** Every descendant list headed by `name`, at any depth. */
export function findAll(node: SNode, name: string): SList[] {
  const out: SList[] = [];
  const walk = (n: SNode) => {
    if (n.kind !== "list") return;
    if (head(n) === name) out.push(n);
    for (const item of n.items) walk(item);
  };
  walk(node);
  return out;
}

/** The nth atom after the head, e.g. `atomAt(node, 0)` for `(ref U1)` -> "U1". */
export function atomAt(node: SNode, index: number): string | null {
  if (node.kind !== "list") return null;
  const atoms = node.items.slice(1).filter((i): i is SAtom => i.kind === "atom");
  return atoms[index]?.value ?? null;
}

/** First value of a direct child list, e.g. `(value RP2040)` -> "RP2040". */
export function childValue(node: SNode, name: string): string | null {
  const [first] = children(node, name);
  return first ? atomAt(first, 0) : null;
}

/**
 * KiCad 6+ schematic properties look like `(property "Reference" "U1" ...)`.
 * Older files used `(property (name "Reference") (value "U1"))`.
 */
export function symbolProperty(symbol: SList, key: string): { value: string; line: number } | null {
  for (const prop of children(symbol, "property")) {
    const first = atomAt(prop, 0);
    if (first === key) {
      const value = atomAt(prop, 1);
      if (value != null) return { value, line: prop.line };
      continue;
    }
    const named = childValue(prop, "name");
    if (named === key) {
      const value = childValue(prop, "value");
      if (value != null) return { value, line: prop.line };
    }
  }
  return null;
}
