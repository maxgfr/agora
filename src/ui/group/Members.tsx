import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { go } from "../../app/state";
import { fingerprint, parseCard } from "../../model/codes";
import type { MemberCard } from "../../model/events";
import type { GroupView, MemberView } from "../../model/group";
import type { GroupSession } from "../../model/session";
import { CodeInput } from "../components/Codes";
import { useAction } from "../components/useAction";
import { useIntent } from "../components/useIntent";
import { t } from "../i18n";
import { memberName } from "./Polls";
import { InviteLink, TicketDesk } from "./Tickets";

function VouchForm(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  const [card, setCard] = useState<MemberCard | null>(null);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  const [scanError, setScanError] = useState<string | null>(null);
  // A card read by the app's scanner lands here, ready to confirm.
  useIntent(s.record.id, "card", (i) => {
    setDone(false);
    if (view.members.some((m) => m.key === i.card.key)) setScanError(t("alreadyMember"));
    else {
      setScanError(null);
      setCard(i.card);
    }
  });
  return (
    <div class="stack">
      {done && (
        <p class="ok-line" role="status" data-testid="vouched">
          {t("vouched")}
        </p>
      )}
      {scanError && (
        <p class="error" role="alert">
          {scanError}
        </p>
      )}
      {!card ? (
        // Scanning goes through the header's Scan button; pasting is the rarer case.
        <details class="paste">
          <summary>{t("pasteTheirCode")}</summary>
          <CodeInput
            label={t("personCode")}
            submit={t("checkCard")}
            testId="card-input"
            noScan
            onCode={(text) => {
              const parsed = parseCard(text);
              if (!parsed) return t("invalidCard");
              if (parsed.groupId && parsed.groupId !== s.record.id) return t("codeWrongGroup");
              const c = parsed.value;
              if (view.members.some((m) => m.key === c.key)) return t("alreadyMember");
              setDone(false);
              setCard(c);
              return null;
            }}
          />
        </details>
      ) : (
        <div class="stack">
          <p>
            <strong>{t("checkPerson")}</strong>
          </p>
          <p class="person">
            <span class="person-name">{card.name ?? t("unnamed")}</span>
            <span class="fingerprint">{fingerprint(card)}</span>
          </p>
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          <div class="row">
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy}
              data-testid="confirm-vouch"
              onClick={() => {
                void run(async () => {
                  await s.vouch(card);
                  setDone(true);
                  setCard(null);
                });
              }}
            >
              {t("vouchFor", { name: card.name ?? t("unnamed") })}
            </button>
            <button type="button" class="btn btn-ghost" onClick={() => setCard(null)}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      <p class="hint small">{t("vouchSomeoneHint")}</p>
    </div>
  );
}

/** Newcomers who asked this member, by name, to vouch for them. */
function Requests(props: { s: GroupSession }): JSX.Element | null {
  const { s } = props;
  const list = s.requests.value;
  const { busy, error, run } = useAction();
  if (list.length === 0) return null;
  return (
    <section class="card stack requests" data-testid="requests">
      <h2>
        {t("requestsTitle")} · {list.length}
      </h2>
      <p class="hint">{t("requestsHint")}</p>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <ul class="list-plain stack">
        {list.map((r) => (
          <li key={r.card.key} class="stack-tight" data-testid="request">
            <p class="person">
              <span class="person-name">{r.card.name ?? t("unnamed")}</span>
              <span class="fingerprint">{fingerprint(r.card)}</span>
            </p>
            <div class="row">
              <button
                type="button"
                class="btn btn-primary"
                disabled={busy}
                onClick={() => void run(() => s.vouch(r.card))}
              >
                {t("vouchFor", { name: r.card.name ?? t("unnamed") })}
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                disabled={busy}
                onClick={() => s.dismissRequest(r.card.key)}
              >
                {t("ignore")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Adding someone, in the order it happens: send the link, then let them in. */
function AddPeople(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  const vouching = (view.policy?.vouches ?? 0) > 0;
  const tickets = (view.policy?.issuers.length ?? 0) > 0;
  return (
    <section class="card stack" data-testid="add-people">
      <h2>{t("addPeople")}</h2>
      <ol class="steps">
        <li class="stack">
          <h3>{t("stepInvite")}</h3>
          <p class="hint">{t("inviteHint")}</p>
          <InviteLink s={s} />
        </li>
        {vouching && (
          <li class="stack">
            <h3>{t("stepVouch")}</h3>
            <p class="hint">{t("stepVouchHint")}</p>
            <VouchForm s={s} view={view} />
          </li>
        )}
        {!vouching && tickets && (
          <li class="stack">
            <h3>{t("stepTicket")}</h3>
            <p class="hint">{t("stepTicketHint")}</p>
          </li>
        )}
      </ol>
    </section>
  );
}

function via(view: GroupView, m: MemberView): string {
  if (m.via === "founder") return t("viaFounder");
  if (m.via === "ticket") return t("viaTicket");
  return t("viaVouch", { names: m.vouchedBy.map((k) => memberName(view, k)).join(", ") });
}

export function Members(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  const { busy, error, run } = useAction();
  const motionOpen = (key: string) => view.polls.some((p) => p.poll.exclude === key && !p.closed);
  return (
    <div class="stack">
      {view.policy && view.policy.vouches > 0 && <Requests s={s} />}
      <AddPeople s={s} view={view} />
      {view.policy && view.policy.issuers.length > 0 && <TicketDesk s={s} view={view} />}
      <section class="stack">
        <h2>
          {t("tabMembers")} · {view.members.length}
        </h2>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <ul class="members" data-testid="members">
          {view.members.map((m) => {
            const me = m.key === s.me.card.key;
            return (
              <li key={m.key} class="member">
                <div class="stack-tight">
                  <span class="member-name">
                    {m.name ?? t("unnamed")}
                    {me && <span class="faint"> · {t("you")}</span>}
                  </span>
                  <span class="hint small">{via(view, m)}</span>
                </div>
                {!me && !motionOpen(m.key) && (
                  <button
                    type="button"
                    class="btn btn-small btn-danger-ghost"
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        const id = await s.createPoll({
                          q: t("motionAbout", { name: m.name ?? t("unnamed") }),
                          options: [t("yes"), t("no")],
                          multi: false,
                          closes: Date.now() + 72 * 3_600_000,
                          exclude: m.key,
                        });
                        go({ name: "group", id: s.record.id, tab: "polls", item: id });
                      });
                    }}
                  >
                    {t("proposeExclusion")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {view.excluded.length > 0 && (
        <section class="stack">
          <h3>{t("excludedMembers")}</h3>
          <ul class="members">
            {view.excluded.map((m) => (
              <li key={m.key} class="member member-excluded">
                {m.name ?? t("unnamed")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
