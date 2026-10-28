import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { fromB64u } from "../../lib/bytes";
import { cardCode, fingerprint, parseAnswer, requestCode } from "../../model/codes";
import type { GroupView } from "../../model/group";
import type { GroupSession } from "../../model/session";
import { CodeBox, CodeInput } from "../components/Codes";
import { t, when } from "../i18n";

/** Ten seconds to ten minutes: enough to blur the moment the ticket was signed. */
function randomDelay(): number {
  return 10_000 + Math.floor(Math.random() * 590_000);
}

function TicketPath(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s } = props;
  void s.recordRev.value;
  const rec = s.record;
  const issuers = props.view.policy?.issuers ?? [];
  const [delay, setDelay] = useState(true);
  if (rec.pendingAdmit) {
    return (
      <p class="notice" data-testid="admit-scheduled">
        {rec.pendingAdmit.at > Date.now()
          ? t("admitScheduled", { t: when(rec.pendingAdmit.at) })
          : t("admitPublishing")}
      </p>
    );
  }
  if (!rec.ticket) {
    return (
      <button
        type="button"
        class="btn btn-primary"
        onClick={() => s.requestTicket(issuers[0] as string)}
      >
        {t("requestTicket")}
      </button>
    );
  }
  return (
    <div class="stack">
      <h3>{t("yourRequest")}</h3>
      <CodeBox
        code={requestCode(fromB64u(rec.ticket.request))}
        label={t("yourRequest")}
        testId="ticket-request"
      />
      <label class="check">
        <input
          type="checkbox"
          checked={delay}
          data-testid="delay-admit"
          onChange={(e) => setDelay(e.currentTarget.checked)}
        />
        <span>
          {t("delayAdmit")}
          <small class="hint">{t("delayAdmitHint")}</small>
        </span>
      </label>
      <CodeInput
        label={t("pasteAnswer")}
        submit={t("validateTicket")}
        testId="ticket-answer"
        onCode={async (text) => {
          const answer = parseAnswer(text);
          if (!answer) return t("invalidAnswer");
          try {
            await s.acceptTicket(answer, delay ? randomDelay() : 0);
            return null;
          } catch {
            return t("invalidAnswer");
          }
        }}
      />
    </div>
  );
}

export function Admission(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  const policy = view.policy;
  const need = s.vouchesNeeded();
  const got = s.vouches.value.length;
  const card = s.me.card;
  return (
    <div class="stack">
      <div class="card stack">
        <h2>{t("notMemberYet")}</h2>
        <p class="hint">{t("notMemberHint")}</p>
      </div>
      {policy && policy.vouches > 0 && (
        <section class="card stack">
          <h2>{t("vouchPath")}</h2>
          <p class="hint">{t("vouchPathHint", { k: need })}</p>
          <CodeBox code={cardCode(card)} label={t("vouchPath")} testId="my-card" share />
          <p class="fingerprint">{fingerprint(card)}</p>
          <p class="hint">{t("fingerprintHint")}</p>
          <p class="progress-label" data-testid="vouch-count">
            {t("vouchesReceived", { n: got, k: need })}
          </p>
        </section>
      )}
      {policy && policy.issuers.length > 0 && (
        <section class="card stack">
          <h2>{t("ticketPath")}</h2>
          <p class="hint">{t("ticketPathHint")}</p>
          <TicketPath s={s} view={view} />
        </section>
      )}
    </div>
  );
}
