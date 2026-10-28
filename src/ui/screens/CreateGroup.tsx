import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { createGroup, go } from "../../app/state";
import { MAX_MEMBERS } from "../../model/events";
import { Link } from "../components/Link";
import { t } from "../i18n";

export function CreateGroup(): JSX.Element {
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [memberName, setMemberName] = useState("");
  const [vouch, setVouch] = useState(true);
  const [k, setK] = useState(2);
  const [ticket, setTicket] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!vouch && !ticket) {
      setError(t("needOne"));
      return;
    }
    setBusy(true);
    try {
      const id = await createGroup({
        name: name.trim(),
        about: about.trim(),
        vouches: vouch ? k : 0,
        organizer: ticket,
        memberName: memberName.trim(),
      });
      go({ name: "group", id, tab: "members" }, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form class="stack narrow" onSubmit={submit}>
      <Link to={{ name: "home" }} class="btn btn-ghost btn-small back">
        ← {t("back")}
      </Link>
      <h1>{t("createGroup")}</h1>
      <label class="field">
        <span>{t("groupName")}</span>
        <input
          required
          maxLength={64}
          value={name}
          placeholder={t("groupNamePh")}
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </label>
      <label class="field">
        <span>{t("groupAbout")}</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={about}
          onInput={(e) => setAbout(e.currentTarget.value)}
        />
      </label>
      <label class="field">
        <span>{t("yourName")}</span>
        <input
          required
          maxLength={64}
          value={memberName}
          onInput={(e) => setMemberName(e.currentTarget.value)}
        />
        <small class="hint">{t("yourNameHint")}</small>
      </label>
      <fieldset class="card stack">
        <legend>{t("admission")}</legend>
        <p class="hint">{t("admissionHint")}</p>
        <label class="check">
          <input
            type="checkbox"
            checked={vouch}
            onChange={(e) => setVouch(e.currentTarget.checked)}
          />
          <span>
            <strong>{t("byVouch")}</strong>
            <small class="hint">{t("byVouchHint", { k })}</small>
          </span>
        </label>
        {vouch && (
          <label class="field inline">
            <span>{t("vouchCount")}</span>
            <input
              type="number"
              min={1}
              max={MAX_MEMBERS}
              value={k}
              onInput={(e) =>
                setK(Math.max(1, Math.min(MAX_MEMBERS, Number(e.currentTarget.value) || 1)))
              }
            />
          </label>
        )}
        <label class="check">
          <input
            type="checkbox"
            checked={ticket}
            data-testid="ticket-mode"
            onChange={(e) => setTicket(e.currentTarget.checked)}
          />
          <span>
            <strong>{t("byTicket")}</strong>
            <small class="hint">{t("byTicketHint")}</small>
          </span>
        </label>
      </fieldset>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" class="btn btn-primary btn-large" disabled={busy}>
        {t("create")}
      </button>
    </form>
  );
}
