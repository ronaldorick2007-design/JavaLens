// Minimal Java tokenizer. Returns [className | null, text] segments that
// concatenate back to exactly the input string (so overlay and textarea align).

const KEYWORDS = new Set(
  (
    "abstract assert boolean break byte case catch char class const continue default do double " +
    "else enum extends final finally float for goto if implements import instanceof int interface " +
    "long native new package private protected public return short static strictfp super switch " +
    "synchronized this throw throws transient try void volatile while var record sealed permits yield " +
    "true false null"
  ).split(" ")
);

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("""[\s\S]*?(?:"""|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(@[A-Za-z_]\w*)|(0[xX][\da-fA-F_]+[Ll]?|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[LlFfDd]?\b)|([A-Za-z_$][\w$]*)/g;

export function highlightJava(text) {
  const out = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push([null, text.slice(last, m.index)]);
    let cls;
    if (m[1] !== undefined) cls = "tok-comment";
    else if (m[2] !== undefined) cls = "tok-string";
    else if (m[3] !== undefined) cls = "tok-annotation";
    else if (m[4] !== undefined) cls = "tok-number";
    else {
      const word = m[5];
      if (KEYWORDS.has(word)) cls = "tok-keyword";
      else if (/^[A-Z]/.test(word)) cls = "tok-type";
      else if (text[TOKEN.lastIndex] === "(") cls = "tok-function";
      else cls = null;
    }
    out.push([cls, m[0]]);
    last = TOKEN.lastIndex;
    if (m[0].length === 0) TOKEN.lastIndex++; // safety against zero-width matches
  }
  if (last < text.length) out.push([null, text.slice(last)]);
  return out;
}
