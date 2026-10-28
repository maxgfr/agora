import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { fromB64u } from "../../lib/bytes";
import { cardCode, fingerprint, parseAnswer, requestCode } from "../../model/codes";
import type { GroupView } from "../../model/group";
import type { GroupSession } from "../../model/session";
import { CodeBox, CodeInput } from "../components/Codes";
import { useAction } from "../components/useAction";
import { useIntent } from "../components/useIntent";
import { t, when } from "../i18n";

/** Ten seconds to ten minutes: enough to blur the moment the ticket was signed. */
function randomDelay(): number {
  return 10_000 + Math.floor(Math.random() * 590_000);
}

/** The newcomer types the name of a member who knows them; no list of members is ever shown. */
function AskMember(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  void s.recordRev.value;
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();
  const [missing, setMissing] = useState(false);
  const vouchedBy = new Set(s.vouches.value.map((v) => v.by));
  const done = (asked: string) =>
    view.members.some(
      (m) => m.name?.toLocaleLowerCase() === asked.toLocaleLowerCase() && vouchedBy.has(m.key),
    );
  return (
    <div class="stack">
      <h3>{t("askMember")}</h3>
      <p class="hint">{t("askMemberHint")}</p>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const n = await s.requestVouch(name);
            setMissing(n === 0);
            if (n > 0) setName("");
          });
        }}
      >
        <input
          class="grow"
          maxLength={64}
          value={name}
          autocomplete="off"
          aria-label={t("askMemberLabel")}
          placeholder={t("askMemberPh")}
          data-testid="ask-member"
          onInput={(e) => {
            setName(e.currentTarget.value);
            setMissing(false);
          }}
        />
        <button type="submit" class="btn btn-primary" disabled={busy || !name.trim()}>
          {t("sendRequest")}
        </button>
      </form>
      {missing && (
        <p class="error" role="alert">
          {t("nobodyByThatName")}
        </p>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {(s.record.asked ?? []).length > 0 && (
        <ul class="list-plain stack-tight" data-testid="asked">
          {(s.record.asked ?? []).map((n) => (
            <li key={n} class={done(n) ? "ok-line" : "hint"}>
              {done(n) ? t("askedDone", { name: n }) : t("askedPending", { name: n })}
            </li>
          ))}
        </ul>
      )}
      {(s.record.asked ?? []).length > 0 && (
        <p class="hint">
          {t("yourEmojis")} <span class="fingerprint-inline">{fingerprint(s.me.card)}</span>
        </p>
      )}
    </div>
  );
}

function TicketPath(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s } = props;
  void s.recordRev.value;
  const [prefill, setPrefill] = useState<string | null>(null);
  useIntent(s.record.id, "answer", (i) => setPrefill(i.text));
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
        code={requestCode(s.record.id, fromB64u(rec.ticket.request))}
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
        prefill={prefill}
        label={t("pasteAnswer")}
        submit={t("validateTicket")}
        testId="ticket-answer"
        onCode={async (text) => {
          const parsed = parseAnswer(text);
          if (!parsed) return t("invalidAnswer");
          if (parsed.groupId && parsed.groupId !== s.record.id) return t("codeWrongGroup");
          const answer = parsed.value;
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
          <AskMember s={s} view={view} />
          <h3>{t("inPerson")}</h3>
          <p class="hint">{t("inPersonHint")}</p>
          <CodeBox
            code={cardCode(card, s.record.id)}
            label={t("vouchPath")}
            testId="my-card"
            share
          />
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
