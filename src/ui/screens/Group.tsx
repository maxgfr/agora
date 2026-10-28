import type { JSX } from "preact";
import { type GroupTab, go, leaveGroup, session, sessionsVersion } from "../../app/state";
import type { GroupSession } from "../../model/session";
import { Actions } from "../group/Actions";
import { Admission } from "../group/Admission";
import { Invite } from "../group/Invite";
import { Members } from "../group/Members";
import { PollDetail, Polls } from "../group/Polls";
import { t } from "../i18n";

const TABS: [GroupTab, Parameters<typeof t>[0]][] = [
  ["polls", "tabPolls"],
  ["actions", "tabActions"],
  ["members", "tabMembers"],
  ["invite", "tabInvite"],
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
  if (!s) {
    return (
      <div class="stack">
        <button type="button" class="btn btn-ghost" onClick={() => go({ name: "home" })}>
          ← {t("back")}
        </button>
      </div>
    );
  }
  const view = s.view.value;
  const genesis = view?.genesis;
  const tab = props.tab;
  return (
    <div class="stack group">
      <div class="group-head stack-tight">
        <button
          type="button"
          class="btn btn-ghost btn-small back"
          onClick={() => go({ name: "home" })}
        >
          ← {t("back")}
        </button>
        <h1 data-testid="group-name">{genesis?.name ?? "…"}</h1>
        {genesis?.about && <p class="lead">{genesis.about}</p>}
        <Status s={s} />
      </div>
      {!view || !genesis ? (
        <div class="card center stack">
          <div class="spinner" aria-hidden="true" />
          <p class="hint">{t("loadingGroup")}</p>
        </div>
      ) : !view.me ? (
        <Admission s={s} view={view} />
      ) : (
        <>
          <nav class="tabs" aria-label={genesis.name}>
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                class={`tab ${tab === id ? "tab-on" : ""}`}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => go({ name: "group", id: props.id, tab: id })}
              >
                {t(label)}
              </button>
            ))}
          </nav>
          {tab === "polls" &&
            (props.item ? (
              <PollDetail s={s} view={view} id={props.item} />
            ) : (
              <Polls s={s} view={view} />
            ))}
          {tab === "actions" && <Actions s={s} view={view} />}
          {tab === "members" && <Members s={s} view={view} />}
          {tab === "invite" && <Invite s={s} view={view} />}
        </>
      )}
      <div class="danger-zone">
        <button
          type="button"
          class="btn btn-small btn-danger-ghost"
          onClick={async () => {
            if (!confirm(t("leaveConfirm"))) return;
            await leaveGroup(props.id);
            go({ name: "home" });
          }}
        >
          {t("leave")}
        </button>
      </div>
    </div>
  );
}
