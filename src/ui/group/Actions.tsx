import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { ActionView, GroupView } from "../../model/group";
import type { GroupSession } from "../../model/session";
import { t, when } from "../i18n";
import { CloseSelect } from "./Polls";

function NewAction(props: { s: GroupSession; view: GroupView; onDone: () => void }): JSX.Element {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [threshold, setThreshold] = useState(Math.max(1, Math.ceil(props.view.members.length / 2)));
  const [hours, setHours] = useState(168);
  const [busy, setBusy] = useState(false);
  const max = props.view.members.length;
  return (
    <form
      class="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await props.s.createAction({
            title: title.trim(),
            details: details.trim(),
            threshold,
            closes: Date.now() + hours * 3_600_000,
          });
          props.onDone();
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{t("newAction")}</h2>
      <label class="field">
        <span>{t("actionTitle")}</span>
        <input
          required
          maxLength={200}
          value={title}
          placeholder={t("actionTitlePh")}
          data-testid="action-title"
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
      </label>
      <label class="field">
        <span>{t("actionDetails")}</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={details}
          onInput={(e) => setDetails(e.currentTarget.value)}
        />
      </label>
      <label class="field inline">
        <span>{t("threshold")}</span>
        <input
          type="number"
          min={1}
          max={max}
          value={threshold}
          data-testid="action-threshold"
          onInput={(e) =>
            setThreshold(Math.max(1, Math.min(max, Number(e.currentTarget.value) || 1)))
          }
        />
        <span>{t("thresholdUnit")}</span>
      </label>
      <CloseSelect hours={hours} onChange={setHours} />
      <div class="row">
        <button type="submit" class="btn btn-primary" disabled={busy || !title.trim()}>
          {t("publish")}
        </button>
        <button type="button" class="btn btn-ghost" onClick={props.onDone}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

function ActionCard(props: { s: GroupSession; av: ActionView }): JSX.Element {
  const { s, av } = props;
  const [busy, setBusy] = useState(false);
  const a = av.action;
  const inRing = a.ring.includes(s.me.card.key);
  const on = av.mine?.on ?? false;
  const pct = Math.min(100, Math.round((av.pledged / a.threshold) * 100));
  return (
    <li class="card stack" data-testid="action">
      <div class="row-between">
        <h2>{a.title}</h2>
        <span class={av.reached ? "badge badge-ok" : "badge"}>
          {av.reached ? t("reached") : t("notReached")}
        </span>
      </div>
      {a.details && <p>{a.details}</p>}
      <div class="bar bar-large" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p class="tile-meta">
        <span data-testid="pledged">{t("pledged", { n: av.pledged, t: a.threshold })}</span>
        <span>·</span>
        <span>{av.closed ? t("closed") : t("closesAt", { t: when(a.closes) })}</span>
      </p>
      {on && <p class="ok-line">{t("youPledged")}</p>}
      {inRing && !av.closed && (
        <button
          type="button"
          class={on ? "btn" : "btn btn-primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await s.pledge(av.id, !on);
            } finally {
              setBusy(false);
            }
          }}
        >
          {on ? t("unpledge") : t("pledge")}
        </button>
      )}
      {!inRing && <p class="hint">{t("notInRing")}</p>}
    </li>
  );
}

export function Actions(props: { s: GroupSession; view: GroupView }): JSX.Element {
  const { s, view } = props;
  const [creating, setCreating] = useState(false);
  return (
    <section class="stack">
      <p class="hint">{t("actionHint")}</p>
      {creating ? (
        <NewAction s={s} view={view} onDone={() => setCreating(false)} />
      ) : (
        <button type="button" class="btn btn-primary" onClick={() => setCreating(true)}>
          + {t("newAction")}
        </button>
      )}
      {view.actions.length === 0 && !creating && <p class="hint">{t("noActions")}</p>}
      <ul class="stack list-plain" data-testid="actions">
        {view.actions.map((av) => (
          <ActionCard key={av.id} s={s} av={av} />
        ))}
      </ul>
    </section>
  );
}
