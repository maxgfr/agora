import type { JSX } from "preact";
import { go, phase, route } from "../app/state";
import { Logo } from "./components/Logo";
import { lang, setLang, t } from "./i18n";
import { applyUpdate, updateReady } from "./pwa";
import { CreateGroup } from "./screens/CreateGroup";
import { GroupScreen } from "./screens/Group";
import { Home } from "./screens/Home";
import { Join } from "./screens/Join";
import { Locked } from "./screens/Locked";
import { SettingsScreen } from "./screens/Settings";

function Screen(): JSX.Element {
  const r = route.value;
  switch (r.name) {
    case "create":
      return <CreateGroup />;
    case "join":
      return <Join {...(r.invite ? { invite: r.invite } : {})} />;
    case "group":
      return <GroupScreen id={r.id} tab={r.tab ?? "polls"} {...(r.item ? { item: r.item } : {})} />;
    case "settings":
      return <SettingsScreen />;
    default:
      return <Home />;
  }
}

export function App(): JSX.Element {
  const p = phase.value;
  return (
    <div class="app">
      <header class="topbar">
        <button type="button" class="brand" onClick={() => go({ name: "home" })}>
          <Logo />
          <span class="wordmark">agora</span>
        </button>
        <div class="row">
          <button
            type="button"
            class="btn btn-small btn-ghost"
            aria-label={t("language")}
            onClick={() => setLang(lang.value === "fr" ? "en" : "fr")}
          >
            {lang.value === "fr" ? "EN" : "FR"}
          </button>
          {p === "ready" && (
            <button
              type="button"
              class="btn btn-small btn-ghost"
              onClick={() => go({ name: "settings" })}
            >
              {t("settings")}
            </button>
          )}
        </div>
      </header>
      {updateReady.value && (
        <div class="banner" role="status">
          <span>{t("updateReady")}</span>
          <button type="button" class="btn btn-small" onClick={applyUpdate}>
            {t("reload")}
          </button>
        </div>
      )}
      <main class="page">
        {p === "loading" && <div class="spinner" aria-hidden="true" />}
        {p === "error" && <p class="error">{t("bootError")}</p>}
        {p === "locked" && <Locked />}
        {p === "ready" && <Screen />}
      </main>
      <footer class="footer">
        <a href="https://github.com/maxgfr/agora" rel="noreferrer" target="_blank">
          {t("source")}
        </a>
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/maxgfr/agora/blob/main/SECURITY.md"
          rel="noreferrer"
          target="_blank"
        >
          {t("security")}
        </a>
        <span aria-hidden="true">·</span>
        <span class="faint">v{__APP_VERSION__}</span>
      </footer>
    </div>
  );
}
