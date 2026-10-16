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
    namePlaceholder: "appointment_reminder",
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
    reconnectBody: "Sending is paused until you reconnect the number.",
    // 009 — Embedded Signup + coexistence
    coexPoint2: "You can share up to 6 months of chats: they come into the CRM as history, without waking the AI.",
    coexPoint3: "Groups, disappearing messages and broadcast lists don't reach the CRM.",
    coexButton: "Connect with Meta",
    coexConnecting: "Connecting with Meta…",
    coexCancelled: "Connection cancelled in the Meta window.",
    coexSdkFailed: "The Meta window could not load. Check ad blockers or the allowed domain in the Meta app.",
    coexFailed: "The connection could not be completed.",
    channelAccountConflict:
      "The number was not saved: it conflicts with an already registered channel. Nothing changed; try again or tell your administrator.",
    coexSuccess: "Number {{number}} connected (app + CRM).",
    coexSyncRequested: "We asked Meta for contacts and history: they arrive in the next few minutes.",
    coexSyncFailed: "Contacts or history could not be requested from Meta: new messages still arrive.",
    coexKeepAlive: "Remember to open the WhatsApp Business app on the phone at least every 13 days.",
    disconnectedTitle: "Meta disconnected the number from the CRM.",
    disconnectedBody:
      "This usually happens if the WhatsApp Business app wasn't opened for ~14 days, the phone changed or access was removed. Open the app and connect with Meta again.",
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
    originAgency2: " (README). Currently NOT supported: with mandatory signatures it would need the agency's App Secret on this server, which must never be shared.",
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
    signatureLastVerified: "Last verified signed event: {{when}}.",
    signatureNoneVerified: "No verified signed event has arrived since the last restart.",
    signatureRejected:
      "{{count}} events rejected since restart (last {{when}}): the signature is invalid — if none arrive verified, the secret does not match the app that signs.",
    signatureMissing:
      "META_APP_SECRET is missing: the signature is mandatory, so the webhook REJECTS every event (503) and no message reaches the inbox. Add the App Secret of the Meta app that sends the webhooks (your own app's — agency mode with a callback override is not supported with mandatory signatures, never copy the agency's App Secret here; behind Wapi, the endpoint secret) to the instance and restart.",
    signatureTestMode:
      "Test environment (mocks enabled): without META_APP_SECRET unsigned events are accepted. In production the signature is always mandatory.",
    // 014 — Webhook guard: does Meta send the messages to the CRM?
    route: {
      elsewhereTitle: "Meta is sending WhatsApp messages to another system",
      elsewhereBody:
        "Messages for {{number}} go to {{host}}, not to the CRM: they don't show up in the Inbox and the assistant doesn't reply. This happens when another tool (n8n, Zapier, another CRM) connects to the same Meta app.",
      sameHostBody:
        "Meta calls the CRM with an old address: messages for {{number}} are rejected and don't show up in the Inbox.",
      overrideTitle: "A Meta setting is diverting WhatsApp messages",
      overrideBody:
        "An override on the {{level}} sends messages for {{number}} to {{host}}, not to the CRM. Whoever set it must remove it in Meta (WhatsApp Manager → Configuration).",
      missingTitle: "Meta doesn't know where to send WhatsApp messages",
      missingBody: "Meta has no address for {{number}}: messages don't reach the CRM.",
      level_phone_number: "phone number",
      level_whatsapp_business_account: "WhatsApp Business account (WABA)",
      restoreNote:
        "First turn off the WhatsApp-connected flow in the other system (for example n8n's «WhatsApp Trigger» node), otherwise it takes the messages back.",
      restoreButton: "Restore the connection to the CRM",
      restoreConfirm:
        "Meta will send WhatsApp messages for ALL businesses connected to this app to the CRM again. The other system will stop receiving them. Continue?",
      restoring: "Restoring…",
      restored: "Done: Meta sends the messages to the CRM again.",
      restoreFailed: "Meta rejected the restore: {{message}}",
      restoreFailed_no_app_secret: "The App Secret is missing from the server configuration: restore isn't possible.",
      restoreFailed_no_app_id: "The App ID is missing: save it in /admin → Platform → Meta.",
      restoreFailed_wapi_gateway: "With the Wapi gateway, the gateway manages the webhook, not the CRM.",
      askSuperadmin: "Restoring needs the platform super-admin: let them know.",
      ok: "Meta sends the messages to the CRM (checked {{when}}).",
      quietTitle: "No messages since {{when}}",
      quietBody:
        "This number usually gets messages every day. If this isn't normal, check the connection.",
      checkNow: "Check now",
      checking: "Checking…",
      shellTitle: "WhatsApp: messages are not reaching the CRM.",
      shellLink: "Open Settings → WhatsApp",
    },
    // 013 — Guided connection (3 steps + status strip)
    guide: {
      title: "Connect WhatsApp in 3 steps",
      intro:
        "You need the phone with the WhatsApp Business app and the business's Facebook login. It takes a couple of minutes.",
      loadError: "Could not load the WhatsApp status: reload the page.",
      advanced: "Advanced",
      advancedHint:
        "Manual connection (WABA and token), webhook, agency override and Wapi key. Only for whoever configures the Meta app.",
      stepState: {
        done: "Done",
        current: "Now",
        todo: "Next",
        blocked: "Waiting for your administrator",
      },
      steps: {
        connect: {
          title: "Connect the number",
          body: "Press the button and log in with Facebook: the WhatsApp Business app stays on the phone and keeps working, and messages also arrive here.",
          done: "Number {{number}} connected.",
          reconnectHint: "The number needs reconnecting: use the button above.",
          reconnectManualHint: "The number needs a new token: use the button above.",
        },
        confirm: {
          title: "Confirm on the phone",
          body: "In the Meta window pick the number, confirm in the WhatsApp Business app on the phone and tap “Share chat history”.",
        },
        test: {
          title: "Test it",
          body: "Text the number from another phone: the message shows up here and in the Inbox.",
          waiting: "Waiting for the first message…",
          received: "Last message received: {{when}}.",
          openInbox: "Open the Inbox",
          newMessage: "New message received.",
        },
      },
      notConfigured: {
        title: "Your administrator needs to finish the Meta setup.",
        body: "Until then, the “Connect with Meta” button does not appear.",
        wapi: "This instance uses the Wapi gateway: connect the number from Advanced.",
        manual: "Already have a token? Open Advanced.",
      },
      another: {
        title: "Connect another number with Meta",
        body: "Replaces the current number ({{number}}) with another WhatsApp Business app number.",
        button: "Connect another number with Meta",
        confirm: "The new number REPLACES {{number}} in this company (and switches to App + CRM mode). Continue?",
      },
      banner: {
        connected: "WhatsApp is connected: {{number}}.",
        ready: "All set: follow the 3 steps below to connect your number.",
        reconnectButton: "Reconnect with Meta",
        manualAlternative: "Or paste a new token in Advanced.",
        manualReconnectBody:
          "This number was connected manually (WABA and token): paste a new token to reconnect it. We don't reconnect it with Meta, so its mode does not change.",
        manualReconnectButton: "Paste a new token",
        platformNotReadyBody:
          "Reconnecting with Meta needs the platform's Meta setup, which is missing: ask your administrator. Meanwhile you can paste a new token.",
      },
      status: {
        label: "WhatsApp status",
        number: "Number",
        numberNone: "No number connected",
        mode: "Mode",
        mode_coexistence: "App + CRM (coexistence)",
        mode_api: "API only",
        signature: "Webhook signature",
        sigVerified: "Verified {{when}}",
        sig_waiting: "Waiting for the first signed event",
        sig_rejected: "Signatures rejected: the App Secret does not match",
        sig_missing: "App Secret missing (server setting)",
        sig_test_mode: "Test environment (mocks)",
        lastInbound: "Last message received",
        lastInboundNone: "None yet",
      },
    },
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
