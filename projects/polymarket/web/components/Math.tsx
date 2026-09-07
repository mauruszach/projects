import katex from "katex";

/** Server-rendered KaTeX. `M` is inline, `D` is display. */
function render(tex: string, displayMode: boolean) {
  return katex.renderToString(tex, { displayMode, throwOnError: false, strict: "ignore" });
}

export function M({ children }: { children: string }) {
  return <span dangerouslySetInnerHTML={{ __html: render(children, false) }} />;
}

export function D({ children }: { children: string }) {
  return <div className="my-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: render(children, true) }} />;
}
