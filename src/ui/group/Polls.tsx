import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { go } from "../../app/state";
import { MAX_OPTIONS } from "../../model/events";
import type { GroupView, PollView } from "../../model/group";
import type { GroupSession } from "../../model/session";
import { CLOSE_HOURS, duration, t, when } from "../i18n";

export function memberName(view: GroupView, key: string): string {
  const m = [...view.members, ...view.excluded].find((x) => x.key === key);
  return m?.name ?? t("unnamed");
}

export function CloseSelect(props: { hours: number; onChange: (h: number) => void }): JSX.Element {
  return (
    <label class="field inline">
      <span>{t("closesIn")}</span>
      <select value={props.hours} onChange={(e) => props.onChange(Number(e.currentTarget.value))}>
        {CLOSE_HOURS.map((h) => (
          <option key={h} value={h}>
            {duration(h * 3_600_000)}
          </option>
        ))}
      </select>
    </label>
  );
}

function NewPoll(props: { s: GroupSession; onDone: () => void }): JSX.Element {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);
  const [hours, setHours] = useState(72);
  const [busy, setBusy] = useState(false);
  const valid = q.trim() && options.filter((o) => o.trim()).length >= 2;
  return (
    <form
      class="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await props.s.createPoll({
            q: q.trim(),
            options: options.map((o) => o.trim()).filter(Boolean),
            multi,
            closes: Date.now() + hours * 3_600_000,
          });
          props.onDone();
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{t("newPoll")}</h2>
      <label class="field">
        <span>{t("question")}</span>
        <input
          required
          maxLength={2000}
          value={q}
          data-testid="poll-q"
          onInput={(e) => setQ(e.currentTarget.value)}
        />
      </label>
      <fieldset class="stack-tight">
        <legend>{t("options")}</legend>
        {options.map((o, i) => (
          <input
            key={i}
            maxLength={200}
            value={o}
            aria-label={t("optionN", { n: i + 1 })}
            placeholder={t("optionN", { n: i + 1 })}
            data-testid={`poll-option-${i}`}
            onInput={(e) => {
              const next = [...options];
              next[i] = e.currentTarget.value;
              setOptions(next);
            }}
          />
        ))}
        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            class="btn btn-small btn-ghost"
            onClick={() => setOptions([...options, ""])}
          >
            + {t("addOption")}
          </button>
        )}
      </fieldset>
      <label class="check">
        <input
          type="checkbox"
          checked={multi}
          onChange={(e) => setMulti(e.currentTarget.checked)}
        />
        <span>{t("multi")}</span>
      </label>
      <CloseSelect hours={hours} onChange={setHours} />
      <div class="row">
        <button type="submit" class="btn btn-primary" disabled={busy || !valid}>
          {t("publish")}
        </button>
        <button type="button" class="btn btn-ghost" onClick={props.onDone}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

function pollTitle(view: GroupView, pv: PollView): string {
  return pv.poll.exclude
    ? t("motionAbout", { name: memberName(view, pv.poll.exclude) })
    : pv.poll.q;
}

export function Polls(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  const [creating, setCreating] = useState(false);
  return (
    <section class="stack">
      {creating ? (
        <NewPoll s={s} onDone={() => setCreating(false)} />
      ) : (
        <button type="button" class="btn btn-primary" onClick={() => setCreating(true)}>
          + {t("newPoll")}
        </button>
      )}
      {view.polls.length === 0 && !creating && <p class="hint">{t("noPolls")}</p>}
      <ul class="tiles" data-testid="polls">
        {view.polls.map((pv) => (
          <li key={pv.id}>
            <button
              type="button"
              class="tile"
              onClick={() => go({ name: "group", id: s.record.id, tab: "polls", item: pv.id })}
            >
              <span class="tile-title">
                {pv.poll.exclude && <span class="badge badge-warn">{t("motion")}</span>}{" "}
                {pollTitle(view, pv)}
              </span>
              <span class="tile-meta">
                <span>{t("voters", { n: pv.voters, m: pv.poll.ring.length })}</span>
                <span>·</span>
                <span>{pv.closed ? t("closed") : t("closesAt", { t: when(pv.poll.closes) })}</span>
                {pv.mine && <span class="badge badge-ok">✓</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Results(props: { pv: PollView }): JSX.Element {
  const { pv } = props;
  const max = Math.max(1, pv.voters);
  return (
    <ul class="results" data-testid="results">
      {pv.poll.options.map((o, i) => {
        const n = pv.counts[i] ?? 0;
        const pct = Math.round((n / max) * 100);
        const mine = pv.mine?.choice.includes(i);
        return (
          <li key={i} class={mine ? "result result-mine" : "result"}>
            <div class="result-label">
              <span>
                {o}
                {mine && <span class="faint"> · {t("you")}</span>}
              </span>
              <span class="result-count" data-testid={`count-${i}`}>
                {n}
              </span>
            </div>
            <div class="bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PollDetail(props: { s: GroupSession; view: GroupView; id: string }): JSX.Element {
  const { s, view } = props;
  const pv = view.polls.find((p) => p.id === props.id);
  const [choice, setChoice] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!pv) return <p class="hint">…</p>;
  const inRing = pv.poll.ring.includes(s.me.card.key);
  const canVote = inRing && !pv.closed && (!pv.mine || editing);
  const toggle = (i: number) => {
    if (!pv.poll.multi) setChoice([i]);
    else setChoice(choice.includes(i) ? choice.filter((c) => c !== i) : [...choice, i].sort());
  };
  return (
    <section class="stack">
      <button
        type="button"
        class="btn btn-ghost btn-small back"
        onClick={() => go({ name: "group", id: s.record.id, tab: "polls" })}
      >
        ← {t("tabPolls")}
      </button>
      <article class="card stack">
        {pv.poll.exclude && <span class="badge badge-warn">{t("motion")}</span>}
        <h2 data-testid="poll-title">{pollTitle(view, pv)}</h2>
        {pv.poll.exclude && <p class="hint">{t("motionHint")}</p>}
        <p class="tile-meta">
          <span data-testid="voters">{t("voters", { n: pv.voters, m: pv.poll.ring.length })}</span>
          <span>·</span>
          <span>{pv.closed ? t("closed") : t("closesAt", { t: when(pv.poll.closes) })}</span>
          {pv.passed !== undefined && (
            <span class={pv.passed ? "badge badge-warn" : "badge"}>
              {pv.passed ? t("passed") : t("rejected")}
            </span>
          )}
        </p>
        {canVote ? (
          <form
            class="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await s.vote(pv.id, choice);
                setEditing(false);
                setChoice([]);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset class="choices">
              <legend class="sr-only">{pollTitle(view, pv)}</legend>
              {pv.poll.options.map((o, i) => (
                <label key={i} class="choice">
                  <input
                    type={pv.poll.multi ? "checkbox" : "radio"}
                    name={`poll-${pv.id}`}
                    checked={choice.includes(i)}
                    onChange={() => toggle(i)}
                  />
                  <span>{o}</span>
                </label>
              ))}
            </fieldset>
            <div class="row">
              <button type="submit" class="btn btn-primary" disabled={busy || choice.length === 0}>
                {t("vote")}
              </button>
              {editing && (
                <button type="button" class="btn btn-ghost" onClick={() => setEditing(false)}>
                  {t("cancel")}
                </button>
              )}
            </div>
          </form>
        ) : (
          <>
            {pv.mine && (
              <p class="ok-line" data-testid="my-vote">
                {t("yourVote", { c: pv.mine.choice.map((c) => pv.poll.options[c]).join(", ") })}
              </p>
            )}
            {pv.mine && !pv.closed && inRing && (
              <button
                type="button"
                class="btn btn-small"
                onClick={() => {
                  setChoice(pv.mine?.choice ?? []);
                  setEditing(true);
                }}
              >
                {t("changeVote")}
              </button>
            )}
            {!inRing && <p class="hint">{t("notInRing")}</p>}
          </>
        )}
        <Results pv={pv} />
        <p class="hint small">{t("ringNote", { n: pv.poll.ring.length })}</p>
        {pv.poll.ring.length < pv.rosterSize && (
          <p class="notice">{t("ringPartial", { n: pv.poll.ring.length, m: pv.rosterSize })}</p>
        )}
      </article>
    </section>
  );
}
