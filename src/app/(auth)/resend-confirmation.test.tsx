import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResendConfirmationView } from "./resend-confirmation";

describe("ResendConfirmationView", () => {
  it("offers the button with its plain label before anything was sent", () => {
    const html = renderToStaticMarkup(
      <ResendConfirmationView
        label="Send it again"
        sent={false}
        failed={false}
        secondsLeft={0}
        onResend={() => {}}
      />,
    );
    expect(html).toContain("Send it again");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("locks the button and counts the cooldown down on its face", () => {
    const html = renderToStaticMarkup(
      <ResendConfirmationView
        label="Send it again"
        sent={false}
        failed={false}
        secondsLeft={60}
        onResend={() => {}}
      />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain("Send it again (60s)");
  });

  it("confirms a fresh send politely", () => {
    const html = renderToStaticMarkup(
      <ResendConfirmationView
        label="Send it again"
        sent={true}
        failed={false}
        secondsLeft={59}
        onResend={() => {}}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("If this address is still waiting for confirmation, a new link is on its way.");
  });

  it("keeps a failed send a plain retry message, with the button back", () => {
    const html = renderToStaticMarkup(
      <ResendConfirmationView
        label="Send a new link"
        sent={false}
        failed={true}
        secondsLeft={0}
        onResend={() => {}}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("The email did not send. Wait a minute and try again.");
    expect(html).toContain("Send a new link");
    expect(html).not.toContain("disabled");
  });
});
