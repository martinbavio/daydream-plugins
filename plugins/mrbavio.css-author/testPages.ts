// A test's project as a gate reads it (decision #78): a gate's context
// hands the lints each viewport's page by path (`ctx.page`), and these
// build that lookup from the project a test made with
// `@daydream/plugin-testing`'s `testProject`, and a page of several
// sheets from one `createPageItem` made. Types only from the API, so the
// module typechecks where the kernel's harness is out of reach.

import type {
  DreamPage,
  DreamViewport,
  PageSheet,
} from "@daydream/plugin-api";

/** What a gate's `ctx.page` answers for the project: its page at a
 * path, or undefined. */
export function pagesOf(project: {
  pages: readonly DreamPage[];
}): (path: string) => DreamPage | undefined {
  return (path) => project.pages.find((page) => page.path === path);
}

/** A viewport and its page (`createPageItem`), the page's sheets
 * replaced by `sheets`, in document order. */
export function withSheets(
  shown: { item: DreamViewport; page: DreamPage },
  sheets: PageSheet[],
): { item: DreamViewport; page: DreamPage } {
  return { item: shown.item, page: { ...shown.page, sheets } };
}
