import { Button, Notice } from "@/components/ui";
import type { ButtonVariant } from "@/components/ui";
import { resendLabel, useResendConfirmation } from "@/lib/resend-email";

export type ResendConfirmationViewProps = {
  label: string;
  variant?: ButtonVariant;
  sent: boolean;
  failed: boolean;
  secondsLeft: number;
  onResend: () => void;
};

// Split out so the visuals — notices and the countdown-locked button — can be
// rendered directly in tests without a DOM.
export function ResendConfirmationView({
  label,
  variant,
  sent,
  failed,
  secondsLeft,
  onResend,
}: ResendConfirmationViewProps) {
  return (
    <>
      {sent ? (
        <Notice tone="success">
          If this address is still waiting for confirmation, a new link is on its way.
        </Notice>
      ) : null}
      {failed ? (
        <Notice tone="error">The email did not send. Wait a minute and try again.</Notice>
      ) : null}
      <Button variant={variant} onClick={onResend} disabled={secondsLeft > 0}>
        {resendLabel(label, secondsLeft)}
      </Button>
    </>
  );
}

type ResendConfirmationProps = {
  email: string | null;
  label: string;
  // Secondary where another action leads the screen, like Log in on a used link.
  variant?: ButtonVariant;
};

// The one resend button shared by the check-your-email screen, the
// confirmation-link page, and the log in form. Clicking through its send leads
// to the neutral confirmation above (or a plain retry message when Supabase
// refuses) and locks the button for a minute, because Supabase rate-limits
// resend.
export function ResendConfirmation({ email, label, variant }: ResendConfirmationProps) {
  const { sent, failed, secondsLeft, resend } = useResendConfirmation(email);
  return (
    <ResendConfirmationView
      label={label}
      variant={variant}
      sent={sent}
      failed={failed}
      secondsLeft={secondsLeft}
      onResend={() => resend()}
    />
  );
}
