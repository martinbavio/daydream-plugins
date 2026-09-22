// The tokenizer reads where each start tag was written — past comments,
// raw text and quoted attribute values — and where an element ends.
import { describe, expect, test } from "vitest";

import { elementEnd, startTags } from "./sourceTags";

const names = (html: string): string[] => startTags(html).map((t) => t.name);

describe("startTags", () => {
  test("every start tag in order, with where it starts and ends", () => {
    const html =
      '<!doctype html><html><body><h1 class="a">Hi</h1><br/></body></html>';
    const tags = startTags(html);
    expect(tags.map((t) => t.name)).toEqual(["html", "body", "h1", "br"]);
    const h1 = tags[2]!;
    expect(html.slice(h1.start, h1.end)).toBe('<h1 class="a">');
    expect(html.slice(h1.start, h1.nameEnd)).toBe("<h1");
    expect(tags[3]!.selfClosing).toBe(true);
  });

  test("a comment, a quoted `>` and raw text hide what looks like a tag", () => {
    expect(
      names(
        '<div title="a > <b>"><!-- <p> --><style>p > a { }</style><textarea><i></textarea><span></span></div>',
      ),
    ).toEqual(["div", "style", "textarea", "span"]);
  });

  test("inside SVG a style or a title is markup, and CDATA is skipped", () => {
    expect(
      names("<svg><title><b></b></title><![CDATA[<x>]]><rect/></svg><p></p>"),
    ).toEqual(["svg", "title", "b", "rect", "p"]);
  });

  test("names are lower-cased; a `<` that starts no tag is text", () => {
    expect(names("<DIV>1 < 2 <3</DIV>")).toEqual(["div"]);
  });
});

describe("elementEnd", () => {
  const endOf = (html: string, index: number): string => {
    const tags = startTags(html);
    const tag = tags[index]!;
    const bound = tags[index + 1]?.start ?? html.length;
    return html.slice(tag.start, elementEnd(html, tag, tag.end, bound));
  };

  test("an element ends past its own end tag", () => {
    expect(endOf("<p>Body copy</p>\n<p>b</p>", 0)).toBe("<p>Body copy</p>");
  });

  test("a void or self-closed element ends with its start tag", () => {
    expect(endOf('<img src="a.png"><p></p>', 0)).toBe('<img src="a.png">');
    expect(endOf("<svg><path d='M0'/></svg>", 1)).toBe("<path d='M0'/>");
  });

  test("an element written without its end tag ends at the next tag, blank space left out", () => {
    expect(endOf("<ul><li>a\n  <li>b\n</ul>", 1)).toBe("<li>a");
    expect(endOf("<ul><li>a\n  <li>b\n</ul>", 2)).toBe("<li>b");
  });
});
