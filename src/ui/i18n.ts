/** UI strings, French and English. The language follows the browser, and can be switched. */
import { signal } from "@preact/signals";

const fr = {
  tagline: "Décider ensemble, sans dire qui a voté quoi.",
  intro:
    "Des sondages et des actions communes pour un groupe : une personne réelle, une voix, et personne ne sait qui a voté quoi. Chiffré de bout en bout, sans compte ni serveur.",
  createGroup: "Créer un groupe",
  joinGroup: "Rejoindre un groupe",
  yourGroups: "Vos groupes",
  noGroups: "Aucun groupe pour l'instant.",
  settings: "Paramètres",
  security: "Sécurité",
  source: "Code source",
  back: "Retour",
  cancel: "Annuler",
  copy: "Copier",
  copied: "Copié",
  share: "Partager",
  scan: "Scanner",
  save: "Enregistrer",
  saved: "Enregistré",
  members: "{n} membres",
  member1: "1 membre",
  pending: "En attente d'admission",
  loadingGroup: "Recherche du groupe sur le réseau…",
  // Create
  groupName: "Nom du groupe",
  groupNamePh: "Copropriété du 12, Collectif vélo…",
  groupAbout: "Description (facultatif)",
  yourName: "Votre pseudonyme dans le groupe",
  yourNameHint:
    "Les membres voient qui fait partie du groupe, jamais qui a voté quoi. Un pseudonyme suffit.",
  admission: "Comment entre-t-on ?",
  admissionHint:
    "C'est ce qui garantit qu'il y a une vraie personne derrière chaque voix. Vous pouvez activer les deux.",
  byVouch: "Parrainage",
  byVouchHint:
    "Un nouveau venu entre quand {k} membres se portent garants de lui (en personne, en scannant son code). Tant que le groupe compte moins de {k} membres, tous doivent le parrainer.",
  vouchCount: "Parrains requis",
  byTicket: "Tickets d'organisateur",
  byTicketHint:
    "Vous vérifiez chaque personne à votre façon (en personne, sur une liste…) et lui signez un ticket à l'aveugle : vous saurez qui en a reçu un, jamais quelle voix vient de quel ticket. Vous devenez un tiers de confiance : un organisateur malhonnête pourrait créer de faux membres.",
  needOne: "Choisissez au moins un mode d'entrée.",
  create: "Créer le groupe",
  // Join
  joinTitle: "Rejoindre",
  pasteInvite: "Collez le lien d'invitation",
  invalidInvite: "Ce n'est pas un lien d'invitation agora.",
  join: "Rejoindre",
  invitedTo: "Vous êtes invité dans",
  // Group
  tabPolls: "Sondages",
  tabActions: "Actions",
  tabMembers: "Membres",
  tabInvite: "Inviter",
  relaysOnline: "Relais connectés",
  relaysOffline: "Relais hors ligne",
  peers: "{n} pair(s) en direct",
  verifying: "Vérification des signatures {done}/{total}",
  leave: "Quitter le groupe",
  leaveConfirm: "Supprimer ce groupe de cet appareil ? Vos clés seront perdues.",
  // Admission
  notMemberYet: "Vous n'êtes pas encore membre",
  notMemberHint: "Vous pouvez lire le groupe, mais pas encore voter. Faites-vous admettre :",
  vouchPath: "Par parrainage",
  vouchPathHint:
    "Montrez ce code à {k} membre(s) : ils le scannent depuis l'onglet Membres. Vous entrez automatiquement dès que vous avez assez de parrains.",
  vouchesReceived: "Parrainages reçus : {n}/{k}",
  fingerprintHint:
    "À distance ? Envoyez le code, puis comparez ces emojis de vive voix avec la personne qui vous parraine.",
  ticketPath: "Par ticket d'organisateur",
  ticketPathHint:
    "Montrez ce code à un organisateur après qu'il a vérifié votre identité. Il le signe sans le voir : votre admission ne sera pas reliable à votre identité.",
  requestTicket: "Demander un ticket",
  yourRequest: "Votre demande, à montrer à l'organisateur",
  pasteAnswer: "Code de réponse de l'organisateur",
  delayAdmit: "Différer mon admission de quelques minutes (recommandé)",
  delayAdmitHint:
    "Ainsi l'organisateur ne peut pas relier l'heure où il a signé à l'heure de votre arrivée.",
  validateTicket: "Valider le ticket",
  invalidAnswer: "Cette réponse ne correspond pas à votre demande.",
  admitScheduled: "Ticket valide. Votre admission sera publiée vers {t}.",
  admitPublishing: "Admission en cours de publication…",
  // Polls
  newPoll: "Nouveau sondage",
  question: "Question",
  options: "Réponses",
  optionN: "Réponse {n}",
  addOption: "Ajouter une réponse",
  multi: "Plusieurs réponses possibles",
  closesIn: "Clôture dans",
  publish: "Publier",
  noPolls: "Aucun sondage pour l'instant.",
  voters: "{n}/{m} ont voté",
  closed: "Clos",
  open: "Ouvert",
  closesAt: "Clôture {t}",
  vote: "Voter",
  changeVote: "Changer mon vote",
  yourVote: "Vous avez voté : {c}",
  notInRing: "Vous n'étiez pas membre à la création de ce sondage.",
  ringNote:
    "Électeurs possibles : {n} membres, fixés à la création. Chaque voix porte une signature d'anneau : elle prouve qu'elle vient de l'un d'eux, une seule fois, sans dire lequel.",
  ringPartial: "Attention : ce sondage n'inclut que {n} des {m} membres de l'époque.",
  motion: "Motion d'exclusion",
  motionAbout: "Exclure {name} ?",
  motionHint:
    "Adoptée si plus de la moitié des électeurs votent oui avant la clôture. La personne exclue ne pourra plus voter ni lire ce qui suit.",
  passed: "Adoptée",
  rejected: "Rejetée",
  yes: "Oui",
  no: "Non",
  // Actions
  newAction: "Nouvelle action",
  actionTitle: "L'action",
  actionTitlePh: "Assister à l'AG, faire grève le 12…",
  actionDetails: "Détails (facultatif)",
  threshold: "Elle a lieu si au moins",
  thresholdUnit: "membres s'engagent",
  noActions: "Aucune action pour l'instant.",
  pledged: "{n}/{t} engagés",
  reached: "Seuil atteint : l'action a lieu",
  notReached: "Seuil pas encore atteint",
  pledge: "Je m'engage",
  unpledge: "Je me retire",
  youPledged: "Vous êtes engagé.",
  actionHint:
    "Les engagements sont anonymes : on voit combien de membres s'engagent, jamais qui. Chacun ne compte qu'une fois.",
  // Members
  vouchSomeone: "Parrainer quelqu'un",
  vouchSomeoneHint:
    "Scannez ou collez le code de la personne. Ne parrainez que quelqu'un que vous avez identifié : vous engagez votre nom.",
  invalidCard: "Ce n'est pas un code de membre agora.",
  personCode: "Code de la personne",
  checkPerson: "Vérifiez avec la personne",
  vouchFor: "Parrainer {name}",
  vouched: "Parrainage publié.",
  alreadyMember: "Cette personne est déjà membre.",
  unnamed: "Membre anonyme",
  viaFounder: "fondateur",
  viaVouch: "parrainé par {names}",
  viaTicket: "entré avec un ticket",
  you: "vous",
  excludedMembers: "Membres exclus",
  proposeExclusion: "Proposer l'exclusion",
  // Invite
  inviteTitle: "Lien d'invitation",
  inviteHint:
    "Toute personne qui a ce lien peut lire le groupe et demander à entrer, mais ne peut voter qu'une fois admise. Envoyez-le par un canal de confiance.",
  ticketDesk: "Guichet des tickets",
  ticketDeskHint:
    "Vérifiez la personne, puis scannez ou collez sa demande. Votre signature est aveugle : vous ne saurez pas quelle clé vous signez.",
  pasteRequest: "Demande de ticket",
  invalidRequest: "Ce n'est pas une demande de ticket.",
  signTicket: "Signer le ticket",
  answerFor: "Réponse à montrer à la personne",
  served: "Tickets signés sur cet appareil : {n}",
  admittedByTicket: "Membres entrés avec un ticket : {n}",
  exportOrganizer: "Clé d'organisateur",
  exportOrganizerHint:
    "Pour signer depuis un autre appareil ou confier le guichet à un co-organisateur. Gardez-la secrète : elle permet d'admettre des membres.",
  importOrganizer: "Importer une clé d'organisateur",
  invalidOrganizer: "Ce n'est pas une clé d'organisateur de ce groupe.",
  show: "Afficher",
  // Settings
  language: "Langue",
  lockTitle: "Verrou de l'appareil",
  lockHint:
    "Chiffre vos groupes et vos clés sur cet appareil avec une phrase de passe (Argon2id). Sans elle, toute personne qui a accès à l'appareil peut voter à votre place.",
  passphrase: "Phrase de passe",
  passphraseRepeat: "Répétez-la",
  mismatch: "Les deux phrases diffèrent.",
  setLock: "Verrouiller",
  removeLock: "Retirer le verrou",
  lockedOn: "Verrou actif.",
  unlockTitle: "Déverrouiller",
  unlock: "Déverrouiller",
  wrongPassphrase: "Phrase de passe incorrecte.",
  network: "Réseau",
  relays: "Relais Nostr (un par ligne)",
  relaysHint:
    "Ils stockent les événements chiffrés du groupe pour les membres hors ligne. Ils ne voient qu'un identifiant opaque et du chiffré.",
  trackers: "Trackers WebTorrent (un par ligne)",
  useTrackers: "Utiliser aussi les trackers pour trouver les pairs",
  stun: "Serveurs STUN (un par ligne)",
  relayOnlyLabel: "Ne jamais révéler mon adresse IP aux pairs (TURN obligatoire)",
  turn: "Serveur TURN (facultatif)",
  wipe: "Tout effacer sur cet appareil",
  wipeConfirm: "Effacer tous vos groupes et vos clés de cet appareil ?",
  updateReady: "Une nouvelle version est prête.",
  reload: "Recharger",
  bootError: "Le stockage du navigateur est indisponible (navigation privée ?).",
  hours: "{n} h",
  days: "{n} j",
  never: "jamais",
  cameraUnavailable: "Caméra indisponible. Collez le code à la place.",
  cameraPreview: "Aperçu de la caméra pour scanner un QR code",
  saveFailed: "Impossible d'enregistrer sur cet appareil (stockage plein ou indisponible).",
  elsewhereTitle: "agora est ouvert dans un autre onglet",
  elsewhereHint:
    "Un seul onglet à la fois, pour que deux onglets n'écrasent pas vos groupes. Fermez l'autre, ou utilisez celui-ci.",
  useHere: "Utiliser cet onglet",
  actionFailed: "Échec",
  pollNotHere: "Ce sondage n'est pas (encore) arrivé sur cet appareil.",
  groupNotFound: "Groupe introuvable",
  groupNotFoundHint:
    "Ce groupe n'est pas sur cet appareil. Pour le rejoindre, ouvrez son lien d'invitation.",
};

type Dict = typeof fr;
export type Key = keyof Dict;

const en: Dict = {
  tagline: "Decide together, without saying who voted what.",
  intro:
    "Polls and collective actions for a group: one real person, one vote, and nobody knows who voted what. End-to-end encrypted, no account, no server.",
  createGroup: "Create a group",
  joinGroup: "Join a group",
  yourGroups: "Your groups",
  noGroups: "No groups yet.",
  settings: "Settings",
  security: "Security",
  source: "Source code",
  back: "Back",
  cancel: "Cancel",
  copy: "Copy",
  copied: "Copied",
  share: "Share",
  scan: "Scan",
  save: "Save",
  saved: "Saved",
  members: "{n} members",
  member1: "1 member",
  pending: "Waiting for admission",
  loadingGroup: "Looking for the group on the network…",
  groupName: "Group name",
  groupNamePh: "Building 12 owners, Bike collective…",
  groupAbout: "Description (optional)",
  yourName: "Your pseudonym in the group",
  yourNameHint:
    "Members see who belongs to the group, never who voted what. A pseudonym is enough.",
  admission: "How do people get in?",
  admissionHint:
    "This is what makes sure a real person stands behind each vote. You can turn on both.",
  byVouch: "Vouching",
  byVouchHint:
    "A newcomer gets in once {k} members vouch for them (in person, by scanning their code). While the group has fewer than {k} members, all of them must vouch.",
  vouchCount: "Vouches needed",
  byTicket: "Organizer tickets",
  byTicketHint:
    "You check each person your own way (in person, against a list…) and sign them a ticket blind: you will know who got one, never which vote comes from which ticket. You become a trusted party: a dishonest organizer could create fake members.",
  needOne: "Pick at least one way in.",
  create: "Create the group",
  joinTitle: "Join",
  pasteInvite: "Paste the invitation link",
  invalidInvite: "This is not an agora invitation link.",
  join: "Join",
  invitedTo: "You are invited to",
  tabPolls: "Polls",
  tabActions: "Actions",
  tabMembers: "Members",
  tabInvite: "Invite",
  relaysOnline: "Relays connected",
  relaysOffline: "Relays offline",
  peers: "{n} live peer(s)",
  verifying: "Checking signatures {done}/{total}",
  leave: "Leave the group",
  leaveConfirm: "Remove this group from this device? Your keys will be lost.",
  notMemberYet: "You are not a member yet",
  notMemberHint: "You can read the group, but not vote yet. Get admitted:",
  vouchPath: "By vouching",
  vouchPathHint:
    "Show this code to {k} member(s): they scan it from the Members tab. You get in automatically once you have enough vouches.",
  vouchesReceived: "Vouches received: {n}/{k}",
  fingerprintHint:
    "Remotely? Send the code, then compare these emojis out loud with the person vouching for you.",
  ticketPath: "With an organizer ticket",
  ticketPathHint:
    "Show this code to an organizer once they have checked who you are. They sign it without seeing it: your admission cannot be linked to your identity.",
  requestTicket: "Ask for a ticket",
  yourRequest: "Your request, to show the organizer",
  pasteAnswer: "The organizer's answer code",
  delayAdmit: "Delay my admission by a few minutes (recommended)",
  delayAdmitHint: "So the organizer cannot match the time they signed with the time you arrive.",
  validateTicket: "Use the ticket",
  invalidAnswer: "This answer does not match your request.",
  admitScheduled: "Valid ticket. Your admission will be published around {t}.",
  admitPublishing: "Publishing your admission…",
  newPoll: "New poll",
  question: "Question",
  options: "Answers",
  optionN: "Answer {n}",
  addOption: "Add an answer",
  multi: "Several answers allowed",
  closesIn: "Closes in",
  publish: "Publish",
  noPolls: "No polls yet.",
  voters: "{n}/{m} voted",
  closed: "Closed",
  open: "Open",
  closesAt: "Closes {t}",
  vote: "Vote",
  changeVote: "Change my vote",
  yourVote: "You voted: {c}",
  notInRing: "You were not a member when this poll was created.",
  ringNote:
    "Possible voters: {n} members, fixed when the poll was created. Each vote carries a ring signature: it proves it comes from one of them, only once, without saying which.",
  ringPartial: "Note: this poll only includes {n} of the {m} members at the time.",
  motion: "Motion to exclude",
  motionAbout: "Exclude {name}?",
  motionHint:
    "Passes if more than half of the voters vote yes before it closes. The excluded person can no longer vote nor read what follows.",
  passed: "Passed",
  rejected: "Rejected",
  yes: "Yes",
  no: "No",
  newAction: "New action",
  actionTitle: "The action",
  actionTitlePh: "Attend the meeting, strike on the 12th…",
  actionDetails: "Details (optional)",
  threshold: "It happens if at least",
  thresholdUnit: "members commit",
  noActions: "No actions yet.",
  pledged: "{n}/{t} committed",
  reached: "Threshold reached: the action is on",
  notReached: "Threshold not reached yet",
  pledge: "I'm in",
  unpledge: "Withdraw",
  youPledged: "You are committed.",
  actionHint:
    "Commitments are anonymous: everyone sees how many members are in, never who. Each counts once.",
  vouchSomeone: "Vouch for someone",
  vouchSomeoneHint:
    "Scan or paste the person's code. Only vouch for someone you have identified: your name is on it.",
  invalidCard: "This is not an agora member code.",
  personCode: "The person's code",
  checkPerson: "Check with the person",
  vouchFor: "Vouch for {name}",
  vouched: "Vouch published.",
  alreadyMember: "This person is already a member.",
  unnamed: "Anonymous member",
  viaFounder: "founder",
  viaVouch: "vouched for by {names}",
  viaTicket: "joined with a ticket",
  you: "you",
  excludedMembers: "Excluded members",
  proposeExclusion: "Propose exclusion",
  inviteTitle: "Invitation link",
  inviteHint:
    "Anyone with this link can read the group and ask to join, but can only vote once admitted. Send it over a channel you trust.",
  ticketDesk: "Ticket desk",
  ticketDeskHint:
    "Check the person, then scan or paste their request. Your signature is blind: you will not know which key you sign.",
  pasteRequest: "Ticket request",
  invalidRequest: "This is not a ticket request.",
  signTicket: "Sign the ticket",
  answerFor: "Answer to show the person",
  served: "Tickets signed on this device: {n}",
  admittedByTicket: "Members who joined with a ticket: {n}",
  exportOrganizer: "Organizer key",
  exportOrganizerHint:
    "To sign from another device or hand the desk to a co-organizer. Keep it secret: it admits members.",
  importOrganizer: "Import an organizer key",
  invalidOrganizer: "This is not an organizer key of this group.",
  show: "Show",
  language: "Language",
  lockTitle: "Device lock",
  lockHint:
    "Encrypts your groups and keys on this device with a passphrase (Argon2id). Without it, anyone with access to the device can vote as you.",
  passphrase: "Passphrase",
  passphraseRepeat: "Repeat it",
  mismatch: "The two passphrases differ.",
  setLock: "Lock",
  removeLock: "Remove the lock",
  lockedOn: "Lock on.",
  unlockTitle: "Unlock",
  unlock: "Unlock",
  wrongPassphrase: "Wrong passphrase.",
  network: "Network",
  relays: "Nostr relays (one per line)",
  relaysHint:
    "They store the group's encrypted events for members who are offline. They only see an opaque tag and ciphertext.",
  trackers: "WebTorrent trackers (one per line)",
  useTrackers: "Also use trackers to find peers",
  stun: "STUN servers (one per line)",
  relayOnlyLabel: "Never reveal my IP address to peers (requires TURN)",
  turn: "TURN server (optional)",
  wipe: "Erase everything on this device",
  wipeConfirm: "Erase all your groups and keys from this device?",
  updateReady: "A new version is ready.",
  reload: "Reload",
  bootError: "Browser storage is unavailable (private browsing?).",
  hours: "{n} h",
  days: "{n} d",
  never: "never",
  cameraUnavailable: "Camera unavailable. Paste the code instead.",
  cameraPreview: "Camera preview for QR scanning",
  saveFailed: "Could not save on this device (storage full or unavailable).",
  elsewhereTitle: "agora is open in another tab",
  elsewhereHint:
    "One tab at a time, so two tabs do not overwrite your groups. Close the other one, or use this one.",
  useHere: "Use this tab",
  actionFailed: "Failed",
  pollNotHere: "This poll has not reached this device (yet).",
  groupNotFound: "Group not found",
  groupNotFoundHint: "This group is not on this device. To join it, open its invitation link.",
};

export type Lang = "fr" | "en";
const dicts: Record<Lang, Dict> = { fr, en };

function initial(): Lang {
  try {
    const saved = localStorage.getItem("agora.lang");
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    // no storage
  }
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const lang = signal<Lang>(typeof window === "undefined" ? "en" : initial());

export function setLang(l: Lang): void {
  lang.value = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem("agora.lang", l);
  } catch {
    // no storage
  }
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s: string = dicts[lang.value][key] ?? fr[key];
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** "dans 3 h", "in 2 d": coarse. */
export function duration(ms: number): string {
  const h = Math.max(0, ms) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.ceil(h * 60))} min`;
  if (h < 48) return t("hours", { n: Math.round(h) });
  return t("days", { n: Math.round(h / 24) });
}

export function when(ts: number): string {
  return new Date(ts).toLocaleString(lang.value === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function membersLabel(n: number): string {
  return n === 1 ? t("member1") : t("members", { n });
}

/** Choices of duration offered when making a poll or an action, in hours. */
export const CLOSE_HOURS = [1, 24, 72, 168, 720];
