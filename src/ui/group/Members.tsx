import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { go } from "../../app/state";
import { fingerprint, parseCard } from "../../model/codes";
import type { MemberCard } from "../../model/events";
import type { GroupView, MemberView } from "../../model/group";
import type { GroupSession } from "../../model/session";
import { CodeInput } from "../components/Codes";
import { t } from "../i18n";
import { memberName } from "./Polls";

function VouchSomeone(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  const [card, setCard] = useState<MemberCard | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section class="card stack">
      <h2>{t("vouchSomeone")}</h2>
      <p class="hint">{t("vouchSomeoneHint")}</p>
      {done && (
        <p class="ok-line" role="status" data-testid="vouched">
          {t("vouched")}
        </p>
      )}
      {!card ? (
        <CodeInput
          label={t("personCode")}
          submit={t("show")}
          testId="card-input"
          onCode={(text) => {
            const c = parseCard(text);
            if (!c) return t("invalidCard");
            if (view.members.some((m) => m.key === c.key)) return t("alreadyMember");
            setDone(false);
            setCard(c);
            return null;
          }}
        />
      ) : (
        <div class="stack">
          <p>
            <strong>{t("checkPerson")}</strong>
          </p>
          <p class="person">
            <span class="person-name">{card.name ?? t("unnamed")}</span>
            <span class="fingerprint">{fingerprint(card)}</span>
          </p>
          <div class="row">
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy}
              data-testid="confirm-vouch"
              onClick={async () => {
                setBusy(true);
                try {
                  await s.vouch(card);
                  setDone(true);
                  setCard(null);
                } finally {
                  setBusy(false);
                }
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
  const [busy, setBusy] = useState<string | null>(null);
  const motionOpen = (key: string) => view.polls.some((p) => p.poll.exclude === key && !p.closed);
  return (
    <div class="stack">
      {view.policy && view.policy.vouches > 0 && <VouchSomeone s={s} view={view} />}
      <section class="stack">
        <h2>
          {t("tabMembers")} · {view.members.length}
        </h2>
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
                    disabled={busy === m.key}
                    onClick={async () => {
                      setBusy(m.key);
                      try {
                        const id = await s.createPoll({
                          q: t("motionAbout", { name: m.name ?? t("unnamed") }),
                          options: [t("yes"), t("no")],
                          multi: false,
                          closes: Date.now() + 72 * 3_600_000,
                          exclude: m.key,
                        });
                        go({ name: "group", id: s.record.id, tab: "polls", item: id });
                      } finally {
                        setBusy(null);
                      }
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
