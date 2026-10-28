import type { JSX } from "preact";
import { type GroupTab, go, groups, leaveGroup, session, sessionsVersion } from "../../app/state";
import type { GroupSession } from "../../model/session";
import { Link } from "../components/Link";
import { Actions } from "../group/Actions";
import { Admission } from "../group/Admission";
import { Members } from "../group/Members";
import { PollDetail, Polls } from "../group/Polls";
import { t } from "../i18n";

const TABS: [GroupTab, Parameters<typeof t>[0]][] = [
  ["polls", "tabPolls"],
  ["actions", "tabActions"],
  ["members", "tabMembers"],
];

function Status(props: { s: GroupSession }): JSX.Element {
  const relays = props.s.relays.value;
  const peers = props.s.peers.value;
  const verifying = props.s.verifying.value;
  const online = relays?.state === "online";
  return (
    <p class="status-line" data-testid="status">
      <span class={`dot ${online ? "dot-ok" : "dot-off"}`} aria-hidden="true" />
      <span>{online ? t("relaysOnline") : t("relaysOffline")}</span>
      {peers > 0 && <span>· {t("peers", { n: peers })}</span>}
      {verifying && <span>· {t("verifying", verifying)}</span>}
    </p>
  );
}

export function GroupScreen(props: { id: string; tab: GroupTab; item?: string }): JSX.Element {
  void sessionsVersion.value;
  const s = session(props.id);
  if (!s && groups.value.some((g) => g.id === props.id)) {
    // Restarting (back from sleep, network settings): only a moment.
    return <div class="spinner" aria-hidden="true" />;
  }
  if (!s) {
    return (
      <div class="stack narrow">
        <h1>{t("groupNotFound")}</h1>
        <p class="lead">{t("groupNotFoundHint")}</p>
        <Link to={{ name: "home" }} class="btn btn-primary">
          {t("yourGroups")}
        </Link>
      </div>
    );
  }
  const view = s.view.value;
  const genesis = view?.genesis;
  const tab = props.tab;
  return (
    <div class="stack group">
      <div class="group-head stack-tight">
        <Link to={{ name: "home" }} class="btn btn-ghost btn-small back">
          ← {t("back")}
        </Link>
        <h1 data-testid="group-name">{genesis?.name ?? "…"}</h1>
        {genesis?.about && <p class="lead">{genesis.about}</p>}
        <Status s={s} />
      </div>
      {view?.me && s.requests.value.length > 0 && tab !== "members" && (
        <Link to={{ name: "group", id: props.id, tab: "members" }} class="notice notice-link">
          {t("requestsCount", { n: s.requests.value.length })} →
        </Link>
      )}
      {!view || !genesis ? (
        <div class="card center stack">
          <div class="spinner" aria-hidden="true" />
          <p class="hint">{t("loadingGroup")}</p>
        </div>
      ) : !view.me && view.excluded.some((m) => m.key === s.me.card.key) ? (
        <div class="card stack" data-testid="excluded">
          <h2>{t("youWereExcluded")}</h2>
          <p class="hint">{t("youWereExcludedHint")}</p>
        </div>
      ) : !view.me ? (
        <Admission s={s} view={view} />
      ) : (
        <>
          <nav class="tabs" aria-label={genesis.name}>
            {TABS.map(([id, label]) => (
              <Link
                key={id}
                to={{ name: "group", id: props.id, tab: id }}
                class={`tab ${tab === id ? "tab-on" : ""}`}
                current={tab === id && !(id === "polls" && props.item)}
              >
                {t(label)}
              </Link>
            ))}
          </nav>
          {tab === "polls" &&
            (props.item ? (
              <PollDetail key={props.item} s={s} view={view} id={props.item} />
            ) : (
              <Polls s={s} view={view} />
            ))}
          {tab === "actions" && <Actions s={s} view={view} />}
          {tab === "members" && <Members s={s} view={view} />}
        </>
      )}
      <div class="danger-zone">
        <button
          type="button"
          class="btn btn-small btn-danger-ghost"
          onClick={async () => {
            if (!confirm(t("leaveConfirm"))) return;
            await leaveGroup(props.id);
            go({ name: "home" }, { replace: true });
          }}
        >
          {t("leave")}
        </button>
      </div>
    </div>
  );
}
