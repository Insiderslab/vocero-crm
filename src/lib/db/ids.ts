import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  member: "mem",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  leadStageEvent: "lse",
  credentials: "cred",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  testRun: "run",
  testCase: "case",
  mediaAsset: "ma",
  // Custom heili.cloud
  tag: "tag",
  contactTag: "ctg",
  automationRule: "rule",
  automationRun: "arun",
  botApiKey: "bk",
  wapiCredentials: "wk",
  addressBookEntry: "abk",
  // 005 — livello canali (ADR 0001 §3.2)
  channelAccount: "cha",
  contactIdentity: "ci",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}
