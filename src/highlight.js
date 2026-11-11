
const JAVA_KEYWORDS = new Set(
  (
    "abstract assert boolean break byte case catch char class const continue default do double " +
    "else enum extends final finally float for goto if implements import instanceof int interface " +
    "long native new package private protected public return short static strictfp super switch " +
    "synchronized this throw throws transient try void volatile while var record sealed permits yield " +
    "true false null"
  ).split(" ")
);

const JAVA_TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("""[\s\S]*?(?:"""|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(@[A-Za-z_]\w*)|(0[xX][\da-fA-F_]+[Ll]?|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[LlFfDd]?\b)|([A-Za-z_$][\w$]*)/g;

export function highlightJava(text) {
  const out = [];
  let last = 0;
  JAVA_TOKEN.lastIndex = 0;
  let m;

  while ((m = JAVA_TOKEN.exec(text))) {
    if (m.index > last) out.push([null, text.slice(last, m.index)]);

    let cls;

    if (m[1] !== undefined) cls = "tok-comment";
    else if (m[2] !== undefined) cls = "tok-string";
    else if (m[3] !== undefined) cls = "tok-annotation";
    else if (m[4] !== undefined) cls = "tok-number";
    else {
      const word = m[5];

      if (JAVA_KEYWORDS.has(word)) cls = "tok-keyword";
      else if (/^[A-Z]/.test(word)) cls = "tok-type";
      else if (text[JAVA_TOKEN.lastIndex] === "(") cls = "tok-function";
      else cls = null;
    }

    out.push([cls, m[0]]);
    last = JAVA_TOKEN.lastIndex;
  }

  if (last < text.length) out.push([null, text.slice(last)]);
  return out;
}

// C++ --------------------------------------------------

const CPP_KEYWORDS = new Set(
  (
    "alignas alignof and and_eq asm auto bitand bitor bool break case catch char " +
    "char8_t char16_t char32_t class compl concept const consteval constexpr " +
    "constinit const_cast continue co_await co_return co_yield decltype default " +
    "delete do double dynamic_cast else enum explicit export extern false float " +
    "for friend goto if inline int long mutable namespace new noexcept not not_eq " +
    "nullptr operator or or_eq private protected public register reinterpret_cast " +
    "requires return short signed sizeof static static_assert static_cast struct " +
    "switch template this thread_local throw true try typedef typeid typename union " +
    "unsigned using virtual void volatile wchar_t while xor xor_eq"
  ).split(" ")
);

const CPP_TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|((?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\([\s\S]*?\)\3"|(?:u8|u|U|L)?"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b0[xX][\da-fA-F']+[uUlL]*|\b0[bB][01']+[uUlL]*|\b\d[\d'.]*(?:[eEpP][+-]?\d[\d']*)?[uUlL]*|\b\d[\d']*(?:\.\d[\d']*)?(?:[eE][+-]?\d[\d']+)?[fFlL]?)(?![\w])|([A-Za-z_]\w*)/g;

export function highlightCpp(text) {
  const out = [];
  let last = 0;
  CPP_TOKEN.lastIndex = 0;
  let m;

  while ((m = CPP_TOKEN.exec(text))) {
    if (m.index > last) out.push([null, text.slice(last, m.index)]);

    let cls;

    if (m[1] !== undefined) cls = "tok-comment";
    else if (m[2] !== undefined) cls = "tok-string";
    else if (m[4] !== undefined) cls = "tok-number";
    else {
      const word = m[5];

      if (CPP_KEYWORDS.has(word)) cls = "tok-keyword";
      else if (/^[A-Z]/.test(word)) cls = "tok-type";
      else if (text[CPP_TOKEN.lastIndex] === "(") cls = "tok-function";
      else cls = null;
    }

    out.push([cls, m[0]]);
    last = CPP_TOKEN.lastIndex;
  }

  if (last < text.length) out.push([null, text.slice(last)]);
  return out;
}

// Python -----------------------------------------------

const PYTHON_KEYWORDS = new Set(
  (
    "False None True and as assert async await break class continue def del " +
    "elif else except finally for from global if import in is lambda nonlocal " +
    "not or pass raise return try while with yield match case"
  ).split(" ")
);

const PYTHON_TOKEN =
  /(#.*)|(([rRuUbBfF]{0,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(@[A-Za-z_]\w*)|((?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)[jJ]?)|([A-Za-z_]\w*)/g;

export function highlightPython(text) {
  const out = [];
  let last = 0;
  PYTHON_TOKEN.lastIndex = 0;
  let m;

  while ((m = PYTHON_TOKEN.exec(text))) {
    if (m.index > last) out.push([null, text.slice(last, m.index)]);

    let cls;

    if (m[1] !== undefined) cls = "tok-comment";
    else if (m[2] !== undefined) cls = "tok-string";
    else if (m[4] !== undefined) cls = "tok-annotation";
    else if (m[5] !== undefined) cls = "tok-number";
    else {
      const word = m[6];

      if (PYTHON_KEYWORDS.has(word)) cls = "tok-keyword";
      else if (/^[A-Z]/.test(word)) cls = "tok-type";
      else if (text[PYTHON_TOKEN.lastIndex] === "(") cls = "tok-function";
      else cls = null;
    }

    out.push([cls, m[0]]);
    last = PYTHON_TOKEN.lastIndex;
  }

  if (last < text.length) out.push([null, text.slice(last)]);
  return out;
}
