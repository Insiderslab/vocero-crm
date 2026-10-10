import type { LegalMessages } from "@/lib/legal";

/**
 * Public pages: privacy, terms, data deletion. DRAFT to be reviewed by a
 * lawyer before commercial launch (the note lives in
 * docs/lavoro/2026-10-10-app-review.md, not on the page). {{entity}},
 * {{email}} and {{product}} are filled from legalContext().
 */
const legal: LegalMessages = {
  chrome: {
    skipToContent: "Skip to content",
    lastUpdated: "Last updated",
    draftLabel: "draft",
    draftNotice: "Document under legal review",
    nav: "Legal information",
    privacy: "Privacy policy",
    terms: "Terms of service",
    deletion: "Data deletion",
    login: "Log in",
  },
  privacy: {
    title: "Privacy policy",
    summary:
      "How {{product}} handles user account data and the WhatsApp conversations (Instagram and Messenger: coming soon) that businesses manage with the service.",
    sections: [
      {
        title: "1. Who is responsible",
        body: [
          "{{product}} is a messaging CRM for businesses, provided by {{entity}} (\"we\"). Contact for any privacy matter: {{email}}.",
          "There are two kinds of data, with different roles. For user account data (people who log in to the CRM) we are the data controller. For the data of people who message a business on WhatsApp (and, coming soon, on Instagram or Messenger), the controller is the business customer using {{product}}; we act as processor and follow only its instructions.",
        ],
        list: [],
      },
      {
        title: "2. What data we process",
        body: ["Depending on how each business uses the service:"],
        list: [
          "CRM users: name, email address, password (stored only as an encrypted hash, never in clear), role within the business and session data (IP address and browser).",
          "Contacts and conversations: contact name, channel identifier (WhatsApp number or user identifier assigned by Meta), message content, attachments, date and delivery status.",
          "Data the business adds: notes, tags, sales pipeline stages and qualification records.",
          "Connection with Meta: identifiers of the connected business account (for example WhatsApp Business and phone number) and the access credential Meta grants to the business. The credential is stored encrypted and is never shown in full.",
          "Only if the business connects its WhatsApp Business app number to the CRM (coexistence) and chooses so in the Meta window: the chat history of that app (up to 6 months) and the names in the app's address book. The address book is used only to name the contacts who message the business: it creates no contacts or conversations.",
        ],
      },
      {
        title: "3. What we use it for",
        body: [
          "Only to provide the service the business has chosen: receiving its customers' messages, letting it reply, organizing contacts and opportunities, and keeping the platform secure and working.",
          "Legal basis: performance of the contract with the business customer, our legitimate interest in the security of the service and, for the data of its end customers, the basis established by the responsible business (for example consent or a contractual relationship).",
        ],
        list: [],
      },
      {
        title: "4. Who we share data with",
        body: [
          "We do not sell data and we do not use it for advertising. Only these third parties are involved:",
        ],
        list: [
          "Meta Platforms (WhatsApp; Instagram and Facebook Messenger: coming soon): through the channels a business connects, we receive and send messages via their official interfaces.",
          "Infrastructure and hosting provider: where the application and the database run; it acts as a processor.",
          "Language-model provider (OpenRouter-compatible): only if the business turns on the AI agent, the conversation content needed to draft a reply is sent to that provider. If the business does not turn it on, no content leaves for any AI.",
        ],
      },
      {
        title: "5. Data received from Meta",
        body: [
          "Data that arrives through Meta's APIs is used only for the functions the business has asked for (receiving and replying to messages and managing its contacts). It is not sold, not used for advertising or for profiling unrelated to the service, and not transferred to third parties other than the processors listed above.",
        ],
        list: [],
      },
      {
        title: "6. How long we keep it",
        body: [
          "We keep data while the business account is active. When the contract ends, or when we receive a valid deletion request, we delete it within the times described on the data deletion page. Some data may be kept longer only if a law requires it.",
        ],
        list: [],
      },
      {
        title: "7. Security",
        body: [
          "Each business sees only its own data: access is separated by organization. Channel credentials are encrypted at rest and communications use HTTPS. No measure is infallible: if we detect a data breach that affects you, we will act and notify as the law requires.",
        ],
        list: [],
      },
      {
        title: "8. Your rights",
        body: [
          "You can ask for access, rectification, deletion, restriction of or objection to processing, and portability of your data, and lodge a complaint with the data protection authority of your country (in Italy, the Garante per la protezione dei dati personali). If you are an end customer of a business, send the request to that business first; if you write to {{email}} we will forward it. To request deletion, follow the \"Data deletion\" page.",
        ],
        list: [],
      },
      {
        title: "9. Cookies",
        body: [
          "We use only technical cookies: the login session and your language and theme preferences. We use no advertising or third-party analytics cookies.",
        ],
        list: [],
      },
      {
        title: "10. Changes",
        body: [
          "If we change this policy, we will publish the new version on this page with its update date.",
        ],
        list: [],
      },
    ],
  },
  terms: {
    title: "Terms of service",
    summary:
      "Conditions of use for {{product}}, the messaging CRM for WhatsApp (Instagram and Messenger: coming soon).",
    sections: [
      {
        title: "1. Purpose",
        body: [
          "{{product}} is a service by {{entity}} that lets a business receive and manage its customers' conversations on WhatsApp (and, coming soon, on Instagram and Messenger), organize contacts and opportunities and, if it turns it on, use an AI agent. By using it you accept these terms on your own behalf and on behalf of the business you represent.",
        ],
        list: [],
      },
      {
        title: "2. Accounts",
        body: [
          "Access is by invitation or authorized sign-up. You are responsible for safeguarding your credentials and for what is done with your account. You must have the authority to bind the business you represent.",
        ],
        list: [],
      },
      {
        title: "3. Channels and third-party platforms",
        body: [
          "You connect your own Meta business accounts. You agree to comply with the applicable Meta terms and policies, in particular those of WhatsApp Business and the Meta platform. Meta may limit, suspend or change its services, the 24-hour window or message templates; we do not control those decisions and are not responsible for them.",
        ],
        list: [],
      },
      {
        title: "4. Responsibility for your communications",
        body: ["You are responsible for your conversations and, in particular, you must:"],
        list: [
          "have a valid legal basis and, where required, the prior consent of the people you message;",
          "inform your customers how you process their data;",
          "send only legitimate messages and respect opt-outs and objections.",
        ],
      },
      {
        title: "5. Acceptable use",
        body: ["You may not use the service to:"],
        list: [
          "send spam, deceptive messages or bulk messages without consent;",
          "post illegal, abusive or discriminatory content, or content that infringes the rights of others;",
          "attempt to access the data of other organizations, bypass security controls or overload the service;",
          "resell access without a written agreement.",
        ],
      },
      {
        title: "6. AI agent",
        body: [
          "The AI agent is optional and is turned on and supervised by the business. Its replies may be wrong or incomplete: you decide when to use it, you can hand a conversation to a person, and you are responsible for what is sent to your customers.",
        ],
        list: [],
      },
      {
        title: "7. Personal data",
        body: [
          "For the data of your end customers you are the controller and we are the processor, as set out in the privacy policy. If you need it, we can sign a data processing agreement (DPA).",
        ],
        list: [],
      },
      {
        title: "8. Availability and warranties",
        body: [
          "We aim to keep the service running continuously, but it is provided \"as is\", with no guarantee of uninterrupted availability, of being error-free, or that third-party services will work.",
        ],
        list: [],
      },
      {
        title: "9. Liability",
        body: [
          "To the extent permitted by law, we are not liable for indirect damages or lost profits, or for failures of third-party platforms. Nothing above limits liability that the law does not allow to be limited.",
        ],
        list: [],
      },
      {
        title: "10. Suspension and termination",
        body: [
          "You may stop using the service at any time. We may suspend an account that breaches these terms or puts security at risk. On termination, your data is handled as set out in the privacy policy and on the data deletion page.",
        ],
        list: [],
      },
      {
        title: "11. Changes and governing law",
        body: [
          "We may update these terms and will publish the new version here. They are governed by Italian law, without prejudice to the mandatory rights you hold under the law of your country. Contact: {{email}}.",
        ],
        list: [],
      },
    ],
  },
  deletion: {
    title: "Data deletion",
    summary:
      "How to ask us to delete your data from {{product}}, and how to withdraw the access you granted from WhatsApp (and, coming soon, from Facebook or Instagram).",
    sections: [
      {
        title: "1. How to request it",
        body: [
          "Write to {{email}} with the subject \"Data deletion\" and tell us who you are (your name and the channel through which you used the service: WhatsApp number or the email of your account; coming soon: Instagram or Facebook account) and what you want deleted. Do not send passwords or credentials: we do not need them.",
          "We handle requests manually. To protect your data we may ask you to confirm your identity before deleting anything.",
        ],
        list: [],
      },
      {
        title: "2. If you messaged a business",
        body: [
          "If you are an end customer of a business that uses {{product}}, that business is responsible for your data. You can ask it directly; if you write to us, we will forward the request to it and act on its instruction.",
        ],
        list: [],
      },
      {
        title: "3. If you connected a Meta account",
        body: [
          "You can withdraw at any time the access you gave to {{product}} from your Facebook account (coming soon; business integrations, or apps and websites) or Instagram account (coming soon; apps and websites); the exact menu names may vary. Once withdrawn, we can no longer receive or send messages on that account. Data already stored is not deleted automatically: request its deletion as explained above.",
        ],
        list: [],
      },
      {
        title: "4. What we delete",
        body: ["When we accept a request we delete, depending on its scope:"],
        list: [
          "the contact, their conversations, messages and attachments;",
          "the associated notes, tags and opportunities;",
          "the user account and the credentials of connected channels, if the business account is closed.",
        ],
      },
      {
        title: "5. Timeframes and exceptions",
        body: [
          "We confirm receipt and complete the deletion within 30 days at most. We may keep what is strictly necessary if a law requires it or to defend rights in a proceeding; in that case we will explain it to you. Backups are deleted when their retention cycle ends.",
        ],
        list: [],
      },
    ],
  },
};

export default legal;
