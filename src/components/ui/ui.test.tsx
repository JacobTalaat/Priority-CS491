import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, ButtonLink, Input, List, ListRow, Notice, PageHeader } from ".";

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    expect(renderToStaticMarkup(<Button>Save</Button>)).toContain('type="button"');
  });

  it("keeps an explicit submit type", () => {
    expect(renderToStaticMarkup(<Button type="submit">Save</Button>)).toContain('type="submit"');
  });

  it("is disabled and busy while loading", () => {
    const html = renderToStaticMarkup(<Button loading>Save</Button>);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
  });

  it("is not busy when idle", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-busy");
  });
});

describe("ButtonLink", () => {
  it("renders a link", () => {
    expect(renderToStaticMarkup(<ButtonLink href="/login">Log in</ButtonLink>)).toMatch(
      /<a[^>]*href="\/login"[^>]*>Log in<\/a>/,
    );
  });
});

describe("Input", () => {
  it("ties the label to the input", () => {
    const html = renderToStaticMarkup(<Input id="email" label="Email" />);
    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
  });

  it("marks the input invalid and points at the error text", () => {
    const html = renderToStaticMarkup(<Input id="email" label="Email" error="Enter an email" />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('<p id="email-error"');
    expect(html).toContain("Enter an email");
  });

  it("describes the input with its hint when there is no error", () => {
    const html = renderToStaticMarkup(<Input id="password" label="Password" hint="8 or more characters" />);
    expect(html).toContain('aria-describedby="password-hint"');
    expect(html).not.toContain("aria-invalid");
  });

  it("shows the error in place of the hint", () => {
    const html = renderToStaticMarkup(
      <Input id="password" label="Password" hint="8 or more characters" error="Too short" />,
    );
    expect(html).toContain('aria-describedby="password-error"');
    expect(html).toContain("Too short");
    expect(html).not.toContain("8 or more characters");
  });
});

describe("ListRow", () => {
  it("renders title, meta, and trailing text inside a list item", () => {
    const html = renderToStaticMarkup(
      <List label="Classes">
        <ListRow title="CS 490" meta="Capstone" trailing="3 due" />
      </List>,
    );
    expect(html).toMatch(/<ul[^>]*aria-label="Classes"/);
    expect(html).toMatch(/<li[^>]*>.*CS 490.*Capstone.*3 due.*<\/li>/);
  });

  it("makes the whole row a link when given an href", () => {
    const html = renderToStaticMarkup(<ListRow title="CS 490" href="/classes/1" />);
    expect(html).toMatch(/<a[^>]*href="\/classes\/1"[^>]*>.*CS 490.*<\/a>/);
  });

  it("is not a link without an href", () => {
    expect(renderToStaticMarkup(<ListRow title="CS 490" />)).not.toContain("<a");
  });
});

describe("PageHeader", () => {
  it("renders the title as the page heading", () => {
    expect(renderToStaticMarkup(<PageHeader title="Classes" />)).toMatch(/<h1[^>]*>Classes<\/h1>/);
  });

  it("renders optional eyebrow, description, and actions", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        eyebrow="This term"
        title="Classes"
        description="Your classes"
        actions={<Button>Sync now</Button>}
      />,
    );
    expect(html).toContain("This term");
    expect(html).toContain("Your classes");
    expect(html).toContain("Sync now");
  });
});

describe("Notice", () => {
  it("announces errors immediately", () => {
    expect(renderToStaticMarkup(<Notice tone="error">Wrong password</Notice>)).toContain('role="alert"');
  });

  it("announces success politely", () => {
    expect(renderToStaticMarkup(<Notice tone="success">Saved</Notice>)).toContain('role="status"');
  });
});
