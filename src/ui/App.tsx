import type { JSX } from "preact";
import { phase, route, saveError, takeOver } from "../app/state";
import { Link } from "./components/Link";
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
      return (
        <Join key={r.invite ? "invite" : "paste"} {...(r.invite ? { invite: r.invite } : {})} />
      );
    case "group":
      return (
        <GroupScreen
          key={r.id}
          id={r.id}
          tab={r.tab ?? "polls"}
          {...(r.item ? { item: r.item } : {})}
        />
      );
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
        <Link to={{ name: "home" }} class="brand">
          <Logo />
          <span class="wordmark">agora</span>
        </Link>
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
            <Link to={{ name: "settings" }} class="btn btn-small btn-ghost">
              {t("settings")}
            </Link>
          )}
        </div>
      </header>
      {saveError.value && (
        <div class="banner banner-error" role="alert">
          <span>{t("saveFailed")}</span>
        </div>
      )}
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
        {p === "elsewhere" && (
          <div class="stack narrow">
            <h1>{t("elsewhereTitle")}</h1>
            <p class="lead">{t("elsewhereHint")}</p>
            <button type="button" class="btn btn-primary" onClick={takeOver}>
              {t("useHere")}
            </button>
          </div>
        )}
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
