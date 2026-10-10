import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFound from "@/app/not-found";
import { ErrorView } from "./error-view";

describe("NotFound", () => {
  it("explains the page is missing and links home", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toMatch(/<h1[^>]*>Page not found<\/h1>/);
    expect(html).toMatch(/<a[^>]*href="\/today"[^>]*>Go to Today<\/a>/);
  });
});

describe("ErrorView", () => {
  const retry = () => {};

  it("offers a try again button and a way home", () => {
    const html = renderToStaticMarkup(<ErrorView error={new Error("boom")} retry={retry} />);
    expect(html).toMatch(/<h1[^>]*>Something went wrong<\/h1>/);
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/today"[^>]*>Go to Today<\/a>/);
  });

  it("does not show the raw error message to students", () => {
    const html = renderToStaticMarkup(<ErrorView error={new Error("relation users does not exist")} retry={retry} />);
    expect(html).not.toContain("relation users does not exist");
  });

  it("shows the error ID when there is one so it can be matched to server logs", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    expect(renderToStaticMarkup(<ErrorView error={error} retry={retry} />)).toContain("Error ID: abc123");
  });
});
