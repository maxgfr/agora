import type { JSX } from "preact";
import { groups, session, sessionsVersion } from "../../app/state";
import { Link } from "../components/Link";
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
          <Link to={{ name: "create" }} class="btn btn-primary btn-large">
            {t("createGroup")}
          </Link>
          <Link to={{ name: "join" }} class="btn btn-large">
            {t("joinGroup")}
          </Link>
        </div>
      </section>
      <section class="stack">
        <h2>{t("yourGroups")}</h2>
        {list.length === 0 && <p class="hint">{t("noGroups")}</p>}
        <ul class="tiles" data-testid="groups">
          {list.map((g) => {
            const view = session(g.id)?.view.value;
            const isMember = !!view?.me;
            const asking = session(g.id)?.requests.value.length ?? 0;
            return (
              <li key={g.id}>
                <Link to={{ name: "group", id: g.id }} class="tile">
                  <span class="tile-title">{g.name || view?.genesis?.name || "…"}</span>
                  <span class="tile-meta">
                    {view?.genesis ? membersLabel(view.members.length) : t("loadingGroup")}
                    {asking > 0 && (
                      <span class="badge badge-warn">{t("requestsCount", { n: asking })}</span>
                    )}
                    {view?.genesis && !isMember && (
                      <span class="badge badge-warn">{t("pending")}</span>
                    )}
                    {isMember && view?.polls.some((p) => !p.closed && !p.mine) && (
                      <span class="badge">
                        {view.polls.filter((p) => !p.closed && !p.mine).length}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
