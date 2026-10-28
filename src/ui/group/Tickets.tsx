import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { fromB64u } from "../../lib/bytes";
import {
  answerCode,
  inviteLink,
  organizerCode,
  parseOrganizer,
  parseRequest,
} from "../../model/codes";
import type { GroupView } from "../../model/group";
import type { GroupSession } from "../../model/session";
import { CodeBox, CodeInput } from "../components/Codes";
import { useIntent } from "../components/useIntent";
import { t } from "../i18n";

export function TicketDesk(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  void s.recordRev.value;
  const [answer, setAnswer] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [orgPrefill, setOrgPrefill] = useState<string | null>(null);
  // Codes read by the app's scanner: the organizer still confirms with one tap.
  useIntent(s.record.id, "request", (i) => setPrefill(i.text));
  useIntent(s.record.id, "organizer", (i) => setOrgPrefill(i.text));
  const org = s.record.organizer?.[0];
  const byTicket = view.members.filter((m) => m.via === "ticket").length;
  if (!org) {
    return (
      <section class="card stack">
        <h2>{t("importOrganizer")}</h2>
        <CodeInput
          label={t("exportOrganizer")}
          submit={t("save")}
          testId="organizer-input"
          prefill={orgPrefill}
          onCode={(text) => {
            const parsed = parseOrganizer(text);
            if (!parsed) return t("invalidOrganizer");
            if (parsed.groupId && parsed.groupId !== s.record.id) return t("codeWrongGroup");
            try {
              s.addOrganizerKey(parsed.value);
              return null;
            } catch {
              return t("invalidOrganizer");
            }
          }}
        />
      </section>
    );
  }
  return (
    <section class="card stack" data-testid="ticket-desk">
      <h2>{t("ticketDesk")}</h2>
      <p class="hint">{t("ticketDeskHint")}</p>
      <CodeInput
        label={t("pasteRequest")}
        submit={t("signTicket")}
        testId="request-input"
        prefill={prefill}
        onCode={(text) => {
          const parsed = parseRequest(text);
          if (!parsed) return t("invalidRequest");
          if (parsed.groupId && parsed.groupId !== s.record.id) return t("codeWrongGroup");
          try {
            setPrefill(null);
            setAnswer(answerCode(s.record.id, s.signTicket(parsed.value)));
            return null;
          } catch {
            return t("invalidRequest");
          }
        }}
      />
      {answer && (
        <div class="stack">
          <h3>{t("answerFor")}</h3>
          <CodeBox code={answer} label={t("answerFor")} testId="ticket-answer-code" />
        </div>
      )}
      <p class="hint small">
        {t("served", { n: org.served })} · {t("admittedByTicket", { n: byTicket })}
      </p>
      <details onToggle={(e) => setShowKey(e.currentTarget.open)}>
        <summary>{t("exportOrganizer")}</summary>
        <p class="hint">{t("exportOrganizerHint")}</p>
        {showKey && (
          <CodeBox
            code={organizerCode(s.record.id, fromB64u(org.secret))}
            label={t("exportOrganizer")}
            testId="organizer-key"
          />
        )}
      </details>
    </section>
  );
}

/** The invitation link: its text first (to send), the QR code on demand (to show in person). */
export function InviteLink(props: { s: GroupSession }): JSX.Element {
  const { s } = props;
  const link = inviteLink({ secret: fromB64u(s.record.secret), genesisId: s.record.genesisId });
  return <CodeBox code={link} label={t("inviteTitle")} testId="invite-link" qr="toggle" share />;
}
