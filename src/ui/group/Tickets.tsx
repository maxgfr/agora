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
import { CodeBox, CodeInput, CopyButton } from "../components/Codes";
import { useAction } from "../components/useAction";
import { useIntent } from "../components/useIntent";
import { t } from "../i18n";

/** One-time entry passwords: made here, handed over by any means, typed by the newcomer. */
function Passwords(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  void s.recordRev.value;
  const [count, setCount] = useState(1);
  const { busy, error, run } = useAction();
  const made = [...(s.record.passwords ?? [])].reverse();
  const usedOf = (batch: string) => view.passBatches.find((b) => b.id === batch)?.used ?? 0;
  return (
    <div class="stack">
      <div class="row">
        <label class="field inline">
          <span class="sr-only">{t("passwordCount")}</span>
          <select
            value={count}
            aria-label={t("passwordCount")}
            onChange={(e) => setCount(Number(e.currentTarget.value))}
          >
            {[1, 5, 10, 20].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          data-testid="make-passwords"
          onClick={() => void run(() => s.createPasswords(count))}
        >
          {count === 1 ? t("makePassword") : t("makePasswords", { n: count })}
        </button>
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {made.map((b) => (
        <div key={b.batch} class="stack-tight passwords" data-testid="passwords">
          <p class="hint small">
            {t("passwordsUsed", { used: usedOf(b.batch), n: b.codes.length })}
          </p>
          <ul class="list-plain stack-tight">
            {b.codes.map((code) => (
              <li key={code} class="row">
                <code class="password" data-testid="password">
                  {code}
                </code>
                <CopyButton text={code} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

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
      <Passwords s={s} view={view} />
      <details class="other-method" open={!!prefill || !!answer}>
        <summary>{t("scannedMethod")}</summary>
        <div class="stack">
          <p class="hint">{t("scannedMethodHint")}</p>
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
        </div>
      </details>
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
