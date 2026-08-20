import type es from "./es";
import admin from "./it/admin";
import agent from "./it/agent";
import auth from "./it/auth";
import common from "./it/common";
import contacts from "./it/contacts";
import inbox from "./it/inbox";
import lab from "./it/lab";
import nav from "./it/nav";
import pipeline from "./it/pipeline";
import settings from "./it/settings";

/** Dizionario italiano: deve rispecchiare la forma ES (il typecheck vigila). */
const it: typeof es = {
  admin,
  agent,
  auth,
  common,
  contacts,
  inbox,
  lab,
  nav,
  pipeline,
  settings,
};
export default it;
