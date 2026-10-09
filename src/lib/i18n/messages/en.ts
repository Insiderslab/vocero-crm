import type es from "./es";
import admin from "./en/admin";
import agent from "./en/agent";
import auth from "./en/auth";
import common from "./en/common";
import contacts from "./en/contacts";
import inbox from "./en/inbox";
import lab from "./en/lab";
import legal from "./en/legal";
import nav from "./en/nav";
import pipeline from "./en/pipeline";
import settings from "./en/settings";

/** English dictionary: must mirror the ES shape (typecheck lo vigila). */
const en: typeof es = {
  admin,
  agent,
  auth,
  common,
  contacts,
  inbox,
  lab,
  legal,
  nav,
  pipeline,
  settings,
};
export default en;
