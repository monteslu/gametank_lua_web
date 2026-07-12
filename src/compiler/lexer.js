// gtlua lexer - PICO-8-flavored Lua tokens.
//
// Dialect notes (see PICO8.md):
//  - `//` starts a comment (PICO-8/C style); `\` is floor division
//  - `!=` is an alias for `~=`
//  - numbers are 16.16 fixed point: decimal/hex/binary literals may carry
//    fractions; every number token carries `fixed` (the 32-bit 16.16 bits)
//    and `isInt` (true when the literal is integral and fits 16 bits)
//  - PICO-8 button glyphs (⬅️➡️⬆️⬇️🅾️❎) lex as number tokens 0..5

const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while", "goto",
]);

// PICO-8 button glyphs -> btn()/btnp() indices. The emoji include optional
// variation selectors (U+FE0F); match longest-first.
const GLYPHS = [
  ["⬅️", 0], ["⬅", 0], ["➡️", 1], ["➡", 1],
  ["⬆️", 2], ["⬆", 2], ["⬇️", 3], ["⬇", 3],
  ["🅾️", 4], ["🅾", 4], ["❎", 5], ["❌", 5],
];

/** Convert a JS number (value) to 16.16 bits, wrapped to signed 32-bit. */
export function toFixed(value) {
  return (Math.round(value * 65536) | 0);
}

/**
 * @typedef {{type:string, value:string|number, fixed?:number, isInt?:boolean, line:number, col:number}} Token
 */

/**
 * @param {string} src
 * @param {string} file
 * @returns {{tokens: Token[], diagnostics: object[]}}
 */
export function lex(src, file) {
  const tokens = [];
  const diagnostics = [];
  let i = 0, line = 1, col = 1;

  const err = (msg, l = line, c = col) =>
    diagnostics.push({ file, line: l, col: c, severity: "error", message: msg });

  const isDigit = (ch) => ch >= "0" && ch <= "9";
  const isHex = (ch) => isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
  const isBin = (ch) => ch === "0" || ch === "1";
  const isNameStart = (ch) => /[A-Za-z_]/.test(ch);
  const isName = (ch) => /[A-Za-z0-9_]/.test(ch);

  function advance(n = 1) {
    while (n-- > 0) {
      if (src[i] === "\n") { line++; col = 1; } else { col++; }
      i++;
    }
  }

  function pushNumber(value, isIntLiteral, l, c) {
    const intVal = Math.trunc(value);
    const isInt = isIntLiteral && intVal >= -32768 && intVal <= 32767;
    if (value > 32767.9999847 || value < -32768) {
      err(`number ${value} is outside the 16.16 range (-32768 .. 32767.99998)`, l, c);
    }
    tokens.push({ type: "number", value, fixed: toFixed(value), isInt, line: l, col: c });
  }

  while (i < src.length) {
    const ch = src[i];

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { advance(); continue; }

    // comments: -- line, --[[ block ]], // line (PICO-8/C style)
    if (ch === "-" && src[i + 1] === "-") {
      if (src[i + 2] === "[" && src[i + 3] === "[") {
        const end = src.indexOf("]]", i + 4);
        if (end === -1) { err("unterminated block comment"); i = src.length; break; }
        advance(end + 2 - i);
      } else {
        while (i < src.length && src[i] !== "\n") advance();
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") advance();
      continue;
    }

    const startLine = line, startCol = col;

    // button glyphs
    let matchedGlyph = false;
    for (const [g, v] of GLYPHS) {
      if (src.startsWith(g, i)) {
        advance(g.length);
        pushNumber(v, true, startLine, startCol);
        matchedGlyph = true;
        break;
      }
    }
    if (matchedGlyph) continue;

    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1]))) {
      if (ch === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
        advance(2);
        let intPart = "", fracPart = "";
        while (i < src.length && isHex(src[i])) { intPart += src[i]; advance(); }
        if (src[i] === "." ) {
          advance();
          while (i < src.length && isHex(src[i])) { fracPart += src[i]; advance(); }
        }
        if (intPart === "" && fracPart === "") err("malformed hex literal", startLine, startCol);
        const value = parseInt(intPart || "0", 16) +
          (fracPart ? parseInt(fracPart, 16) / Math.pow(16, fracPart.length) : 0);
        pushNumber(value, fracPart === "", startLine, startCol);
        continue;
      }
      if (ch === "0" && (src[i + 1] === "b" || src[i + 1] === "B")) {
        advance(2);
        let intPart = "", fracPart = "";
        while (i < src.length && isBin(src[i])) { intPart += src[i]; advance(); }
        if (src[i] === ".") {
          advance();
          while (i < src.length && isBin(src[i])) { fracPart += src[i]; advance(); }
        }
        if (intPart === "" && fracPart === "") err("malformed binary literal", startLine, startCol);
        const value = parseInt(intPart || "0", 2) +
          (fracPart ? parseInt(fracPart, 2) / Math.pow(2, fracPart.length) : 0);
        pushNumber(value, fracPart === "", startLine, startCol);
        continue;
      }
      let intPart = "", fracPart = "", sawDot = false;
      while (i < src.length && isDigit(src[i])) { intPart += src[i]; advance(); }
      if (src[i] === "." && isDigit(src[i + 1] ?? "")) {
        sawDot = true;
        advance();
        while (i < src.length && isDigit(src[i])) { fracPart += src[i]; advance(); }
      } else if (src[i] === "." && src[i + 1] !== ".") {
        // trailing dot: "1." - treat as integral
        advance();
      }
      const value = parseFloat(`${intPart || "0"}.${fracPart || "0"}`);
      pushNumber(value, !sawDot || fracPart === "", startLine, startCol);
      continue;
    }

    if (isNameStart(ch)) {
      let text = "";
      while (i < src.length && isName(src[i])) { text += src[i]; advance(); }
      tokens.push({
        type: KEYWORDS.has(text) ? text : "name",
        value: text, line: startLine, col: startCol,
      });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      advance();
      let text = "";
      while (i < src.length && src[i] !== quote && src[i] !== "\n") { text += src[i]; advance(); }
      if (src[i] !== quote) err("unterminated string");
      else advance();
      tokens.push({ type: "string", value: text, line: startLine, col: startCol });
      continue;
    }

    // operators, longest first
    const push = (type, len) => {
      tokens.push({ type, value: type, line: startLine, col: startCol });
      advance(len);
    };
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (three === "..=" ) { push("..=", 3); continue; }
    if (three === ">>>" || three === "<<>" || three === "><<") { push(three, 3); continue; }
    if (two === "!=") { tokens.push({ type: "~=", value: "!=", line: startLine, col: startCol }); advance(2); continue; }
    if (["==", "~=", "<=", ">=", "..", "+=", "-=", "*=", "/=", "%=", "^=",
         "<<", ">>", "^^", "\\="].includes(two)) { push(two, 2); continue; }
    if ("+-*/%^#<>=(){}[];:,.\\&|~?@$".includes(ch)) { push(ch, 1); continue; }

    err(`unexpected character '${ch}'`);
    advance();
  }

  tokens.push({ type: "eof", value: "", line, col });
  return { tokens, diagnostics };
}
