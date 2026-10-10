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
    listError:
      "Couldn't load the key list: reload the page. There may be active keys.",
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
    forbidden:
      "Only the organization owner or an administrator can manage the WhatsApp connection.",
    reconnectTitle: "The WhatsApp token expired or was revoked.",
    reconnectBody:
      "Sending is paused. Paste a new token below and test the connection to reconnect.",
    connectedNumber: "Connected number: {{number}}",
    tokenTail: "token …{{last4}}",
    // 009 — Embedded Signup + coexistence
    coexTitle: "Connect your WhatsApp Business app number",
    coexDescription:
      "The number stays in the phone app and also comes into the CRM: reply from wherever you like. A Meta window opens: log in with Facebook, pick your app number and confirm on the phone.",
    coexPoint1: "Open the WhatsApp Business app on the phone at least every 13 days, otherwise Meta disconnects the number from the CRM.",
    coexPoint2: "You can share up to 6 months of chats: they come into the CRM as history, without waking the AI.",
    coexPoint3: "Groups, disappearing messages and broadcast lists don't reach the CRM.",
    coexButton: "Connect with Meta",
    coexConnecting: "Connecting with Meta…",
    coexCancelled: "Connection cancelled in the Meta window.",
    coexSdkFailed: "The Meta window could not load. Check ad blockers or the allowed domain in the Meta app.",
    coexFailed: "The connection could not be completed.",
    coexSuccess: "Number {{number}} connected (app + CRM).",
    coexSyncRequested: "We asked Meta for contacts and history: they arrive in the next few minutes.",
    coexSyncFailed: "Contacts or history could not be requested from Meta: new messages still arrive.",
    coexBadge: "App + CRM",
    coexKeepAlive: "Remember to open the WhatsApp Business app on the phone at least every 13 days.",
    disconnectedTitle: "Meta disconnected the number from the CRM.",
    disconnectedBody:
      "This usually happens if the WhatsApp Business app wasn't opened for ~14 days, the phone changed or access was removed. Open the app and connect with Meta again.",
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
    wapi: {
      title: "Wapi key for this organization",
      description:
        "If your instance uses the Wapi gateway, each organization uses ITS OWN key (hlp_live_…). It is stored encrypted and never shown again: you only see the last 4 characters.",
      forbidden:
        "Only the organization owner or an admin manages the Wapi key.",
      gatewayOff:
        "This instance has no Wapi gateway enabled (WAPI_BASE_URL): the key can be saved, but it is not used today and everything goes straight to Meta.",
      routing: {
        own_key: "This organization's sends go through Wapi with its own key.",
        legacy_global:
          "Legacy mode: this organization uses the instance-wide key. Save its own key to stop depending on it.",
        blocked:
          "Sends blocked: the instance lists several organizations for Wapi and this one has no key of its own. Save its key below.",
        direct: "This organization's sends go straight to Meta.",
      },
      configured: "Key saved (…{{last4}})",
      notConfigured: "No key of its own",
      keyLabel: "Wapi key",
      keyPlaceholder: "hlp_live_…",
      save: "Save key",
      saving: "Saving…",
      saved: "Key saved ✓",
      saveError: "Could not save the key",
      invalidFormat: "The key must start with hlp_live_",
      remove: "Revoke key",
      confirmRemove:
        "Revoke this organization's Wapi key? Sends through Wapi will stop until another key is saved.",
      removeError: "Could not revoke the key",
      loadError:
        "Could not load the Wapi key status: reload the page.",
    },
  },
};
export default messages;
