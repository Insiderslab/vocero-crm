import type base from "../es/settings";

/** EN dictionary — settings screens. */
const messages: typeof base = {
  title: "Settings",
  tabs: {
    whatsapp: "WhatsApp",
    branding: "Brand",
    templates: "Templates",
    team: "Team",
    apiKeys: "API keys",
  },
  branding: {
    title: "CRM brand",
    description:
      "This CRM is yours: give it your business name and your color. They are reflected across the whole interface and on the sign-in screen.",
    currencyLabel: "Business currency",
    currencyHelp:
      "It's the only one the Pipeline adds up. Amounts captured in another currency are shown, but stay out of their column's total.",
    accentLabel: "Accent color",
    accentHelp:
      "With a custom color, the derived tones (hover, soft backgrounds) are computed automatically and contrast is adjusted.",
    preset: {
      azulAcero: "Steel blue",
      grafito: "Graphite",
      verdeApagado: "Muted green",
      ciruela: "Plum",
    },
    custom: "Custom",
    previewButton: "Sample button",
    saveError: "Could not save",
    saved: "Brand saved ✓",
    submit: "Save brand",
  },
  favicon: {
    title: "Tab icon",
    previewAlt: "Tab icon preview",
    own: "Custom logo",
    ownHelp: "Replaces the generated one. You can remove it to go back.",
    generated: "Generated from your brand",
    generatedHelp:
      "The initial over your accent color. Upload a logo to replace it.",
    tooBig: "The icon can't exceed {{kb}} KB.",
    uploadError: "Could not upload the icon",
    removeError: "Could not remove the icon",
    uploading: "Uploading…",
    change: "Change logo",
    upload: "Upload logo",
    remove: "Remove",
    formats: "PNG, SVG, ICO, JPEG or WebP, up to {{kb}} KB. Square looks best.",
  },
  team: {
    title: "Create team account",
    description:
      "No emails or invitations: share the temporary password with your teammate yourself (it's shown only ONCE).",
    createError: "Could not create the account",
    created: "Account created ✓",
    shareNow: "Share these details now (they won't be shown again):",
    passwordPrefix: "password",
    submit: "Create account",
    membersTitle: "Members",
    owner: "Owner",
    member: "Member",
  },
  apiKeys: {
    forbidden:
      "Only the organization owner or an administrator can manage API keys.",
    bot: {
      title: "Bot keys (vbk_)",
      description:
        "For the external brain that uses /api/bot/*. Each key works only for this organization.",
    },
    export: {
      title: "Export keys (vex_)",
      description:
        "For read-only scripts and automations on /api/export/*. Each key works only for this organization.",
    },
    labelLabel: "Key name",
    labelPlaceholder: "e.g. production bot, n8n",
    submit: "Create key",
    createError: "Could not create the key",
    created: "Key “{{label}}” created ✓",
    shareNow:
      "Copy it now: it will not be shown again. Store it in the secret manager of the service that will use it.",
    copy: "Copy key",
    copied: "Copied ✓",
    hide: "Hide",
    empty: "No keys of this type yet.",
    createdAt: "created {{date}}",
    lastUsed: "last used {{date}}",
    neverUsed: "never used",
    revoke: "Revoke",
    revoked: "Revoked",
    confirmRevoke:
      "Revoke the key “{{label}}”? The service using it will stop working immediately.",
    revokeError: "Could not revoke the key",
  },
  templates: {
    intro:
      "Templates let you reopen conversations once the 24-hour window has closed. Meta approves them within hours or days and may reclassify the category (which changes the per-conversation cost). This screen checks the status with Meta every time you open it; Sync forces the check without reloading.",
    sync: "Sync",
    syncUpdated: "{{count}} template(s) updated",
    syncUpToDate: "Everything is up to date",
    syncError: "Could not sync",
    rejectionReason: "Rejection reason: {{reason}}",
    empty:
      "No templates yet. Create the first one above — for example a “we're still available, shall we pick your quote back up?” for cold conversations.",
    status: {
      draft: "Draft",
      pending: "Pending with Meta",
      approved: "Approved",
      rejected: "Rejected",
    },
    createTitle: "New template",
    createIntro1: "Body with as many variables as you need: number them ",
    createIntro2:
      "… in order, with no gaps. It's sent to Meta for approval when created.",
    languageLabel: "Language",
    categoryLabel: "Category",
    utilityOption: "UTILITY (follow-up)",
    bodyLabel: "Body",
    bodyPlaceholder: "Hi {{1}}, I'm confirming your session on {{2}} at {{3}}.",
    variableOne: "1 variable: sending will ask for its value.",
    variableMany: "{{count}} variables: sending will ask for all {{count}} values.",
    createError: "Could not create the template",
    submitting: "Sending to Meta…",
    submit: "Create and send for approval",
  },
  whatsapp: {
    reconnectTitle: "The WhatsApp token expired or was revoked.",
    reconnectBody:
      "Sending is paused. Paste a new token below and test the connection to reconnect.",
    connectedNumber: "Connected number: {{number}}",
    tokenTail: "token …{{last4}}",
    connected: "Connected",
    titleReconnect: "Reconnect / update the number",
    titleConnect: "Connect your WhatsApp number",
    connectDescription:
      "Paste your WhatsApp Cloud API credentials. The token is validated against Meta BEFORE being saved and is stored encrypted.",
    originTitle: "Where does the token come from?",
    originDirectTitle: "Direct mode",
    originDirect1: "The business has its own app at ",
    originDirect2: ": use a ",
    originSystemUser: "system user",
    originDirect3:
      " token (doesn't expire) with WhatsApp permissions. In this mode it's also worth configuring the App Secret for webhook signature.",
    originAgencyTitle: "Agency mode (Tech Provider)",
    originAgency1:
      "Your agency runs the Embedded Signup on THEIR platform and its backend obtains the client's token; it hands it to you to paste here. The webhook connects via the ",
    originAgencyWaba: "per-WABA override",
    originAgency2: " (5-step checklist in the README).",
    wabaPlaceholder: "WhatsApp Business account ID",
    phoneIdPlaceholder: "Phone number ID",
    tokenLabel: "Access token",
    tokenPlaceholderSaved: "Saved (…{{last4}}) — paste a new one to change it",
    tokenValid: "✓ Token valid for {{display}}. You can save now.",
    noServer: "No connection to the server",
    validationFailed: "Validation failed",
    saveError: "Could not save the connection",
    testing: "Testing…",
    test: "Test connection",
    save: "Save connection",
    webhookTitle: "WhatsApp webhook",
    webhookDesc1:
      "Paste these values in the Meta dashboard (direct mode) or use them in your agency backend's override (at WABA level). ",
    webhookDescStrong: "Save the connection BEFORE configuring the webhook:",
    webhookDesc2:
      " verification (handshake) works without saving, but messages are only received if the connection is saved — they're routed by your Phone Number ID.",
    httpsWarning:
      "The configured URL is not https: Meta requires https for webhooks. Set APP_BASE_URL to your public domain.",
    urlLabel: "Webhook URL (callback URL)",
    copyUrl: "Copy URL",
    copiedUrl: "Copied ✓",
    urlHelp:
      "The URL contains the secret token in its path: treat it like a password.",
    copyToken: "Copy verify token",
    copiedToken: "Copied ✓",
    signatureActive:
      "Signature verification active (META_APP_SECRET configured): every event is validated with x-hub-signature-256.",
    signatureInactive:
      "No App Secret configured: the webhook is protected by the secret URL (normal in agency mode). For the extra signature layer, add META_APP_SECRET to the instance.",
  },
};
export default messages;
