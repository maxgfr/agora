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
import { t } from "../i18n";

function TicketDesk(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  void s.recordRev.value;
  const [answer, setAnswer] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
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
          onCode={(text) => {
            const secret = parseOrganizer(text);
            if (!secret) return t("invalidOrganizer");
            try {
              s.addOrganizerKey(secret);
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
        onCode={(text) => {
          const req = parseRequest(text);
          if (!req) return t("invalidRequest");
          try {
            setAnswer(answerCode(s.signTicket(req)));
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
            code={organizerCode(fromB64u(org.secret))}
            label={t("exportOrganizer")}
            testId="organizer-key"
          />
        )}
      </details>
    </section>
  );
}

export function Invite(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  const link = inviteLink({ secret: fromB64u(s.record.secret), genesisId: s.record.genesisId });
  return (
    <div class="stack">
      <section class="card stack">
        <h2>{t("inviteTitle")}</h2>
        <p class="hint">{t("inviteHint")}</p>
        <CodeBox code={link} label={t("inviteTitle")} testId="invite-link" share />
      </section>
      {view.policy && view.policy.issuers.length > 0 && <TicketDesk s={s} view={view} />}
    </div>
  );
}
