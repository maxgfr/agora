import type { JSX } from "preact";
import { go, groups, session, sessionsVersion } from "../../app/state";
import { membersLabel, t } from "../i18n";

export function Home(): JSX.Element {
  void sessionsVersion.value;
  const list = groups.value;
  return (
    <div class="stack home">
      <section class="hero stack">
        <h1>{t("tagline")}</h1>
        <p class="lead">{t("intro")}</p>
        <div class="row">
          <button
            type="button"
            class="btn btn-primary btn-large"
            onClick={() => go({ name: "create" })}
          >
            {t("createGroup")}
          </button>
          <button type="button" class="btn btn-large" onClick={() => go({ name: "join" })}>
            {t("joinGroup")}
          </button>
        </div>
      </section>
      <section class="stack">
        <h2>{t("yourGroups")}</h2>
        {list.length === 0 && <p class="hint">{t("noGroups")}</p>}
        <ul class="tiles" data-testid="groups">
          {list.map((g) => {
            const view = session(g.id)?.view.value;
            const isMember = !!view?.me;
            return (
              <li key={g.id}>
                <button type="button" class="tile" onClick={() => go({ name: "group", id: g.id })}>
                  <span class="tile-title">{g.name || view?.genesis?.name || "…"}</span>
                  <span class="tile-meta">
                    {view?.genesis ? membersLabel(view.members.length) : t("loadingGroup")}
                    {view?.genesis && !isMember && (
                      <span class="badge badge-warn">{t("pending")}</span>
                    )}
                    {isMember && view?.polls.some((p) => !p.closed && !p.mine) && (
                      <span class="badge">
                        {view.polls.filter((p) => !p.closed && !p.mine).length}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
