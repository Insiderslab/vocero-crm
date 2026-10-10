"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, ChevronRight, LogIn, Pencil, UserPlus } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { useT } from "@/lib/i18n/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Org = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  memberCount: number;
  contactCount: number;
};

type Member = {
  id: string;
  role: string;
  name: string;
  email: string;
  createdAt: string;
};

function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function AdminClient() {
  const router = useRouter();
  const { t } = useT();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  // Crear empresa
  const [orgName, setOrgName] = useState("");
  const [withOwner, setWithOwner] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);

  // Usuarios por empresa
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [userError, setUserError] = useState<string | null>(null);
  const [userCreated, setUserCreated] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  // 007 — Renombrar empresa
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const refetchOrgs = useCallback(async () => {
    const res = await fetch("/api/admin/orgs").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { orgs: Org[] };
    setOrgs(data.orgs);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetchOrgs();
  }, [refetchOrgs]);

  async function createOrg() {
    setCreating(true);
    setCreateError(null);
    setCreatedCredentials(null);
    const payload: Record<string, unknown> = { name: orgName.trim() };
    if (withOwner) {
      payload.owner = {
        name: ownerName.trim(),
        email: ownerEmail.trim(),
        password: ownerPassword,
      };
    }
    const res = await fetch("/api/admin/orgs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setCreating(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setCreateError(data?.error?.message ?? t("admin.orgs.createError"));
      return;
    }
    if (withOwner) {
      setCreatedCredentials({ email: ownerEmail.trim(), password: ownerPassword });
    }
    setOrgName("");
    setOwnerName("");
    setOwnerEmail("");
    setOwnerPassword("");
    setWithOwner(false);
    void refetchOrgs();
  }

  async function toggleExpand(orgId: string) {
    if (expanded === orgId) {
      setExpanded(null);
      return;
    }
    setExpanded(orgId);
    setUserError(null);
    setUserCreated(null);
    setNewUserName("");
    setNewUserEmail("");
    setNewUserPassword("");
    const res = await fetch(`/api/admin/orgs/${orgId}/users`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { members: Member[] };
    setMembers(data.members);
  }

  async function addUser(orgId: string) {
    setSavingUser(true);
    setUserError(null);
    setUserCreated(null);
    const res = await fetch(`/api/admin/orgs/${orgId}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        password: newUserPassword,
      }),
    }).catch(() => null);
    setSavingUser(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setUserError(data?.error?.message ?? t("admin.orgs.userCreateError"));
      return;
    }
    setUserCreated({ email: newUserEmail.trim(), password: newUserPassword });
    setNewUserName("");
    setNewUserEmail("");
    setNewUserPassword("");
    await toggleExpand(orgId); // recarga miembros (expanded ya era esta org)
    setExpanded(orgId);
    void refetchOrgs();
  }

  async function rename() {
    if (!renaming) return;
    setSavingName(true);
    setRenameError(null);
    const res = await fetch(`/api/admin/orgs/${renaming.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: renaming.name.trim() }),
    }).catch(() => null);
    setSavingName(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setRenameError(data?.error?.message ?? t("admin.orgs.renameError"));
      return;
    }
    setRenaming(null);
    void refetchOrgs();
    router.refresh();
  }

  async function enter(orgId: string) {
    await authClient.organization.setActive({ organizationId: orgId });
    router.push("/inbox");
    router.refresh();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.orgs.newTitle")}</CardTitle>
          <CardDescription>{t("admin.orgs.newDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">{t("admin.orgs.orgName")}</Label>
            <Input
              id="org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder={t("admin.orgs.orgNamePlaceholder")}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withOwner}
              onChange={(e) => setWithOwner(e.target.checked)}
            />
            {t("admin.orgs.withOwner")}
          </label>

          {withOwner && (
            <div className="space-y-4 rounded-md border p-3">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="owner-name">{t("admin.orgs.name")}</Label>
                  <Input
                    id="owner-name"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="owner-email">{t("admin.orgs.email")}</Label>
                  <Input
                    id="owner-email"
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="owner-password">
                  {t("admin.orgs.tempPassword")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="owner-password"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    placeholder={t("admin.orgs.passwordPlaceholder")}
                  />
                  <Button
                    variant="outline"
                    onClick={() => setOwnerPassword(generatePassword())}
                  >
                    {t("admin.orgs.generate")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {createError && (
            <p className="text-sm text-destructive">{createError}</p>
          )}
          {createdCredentials && (
            <div className="rounded-md border border-success-soft bg-success-tint p-3 text-sm">
              <p className="font-medium text-success-text">
                {t("admin.orgs.createdTitle")}
              </p>
              <p className="mt-1 text-success-text opacity-90">
                {t("admin.orgs.createdShare")}
                <br />
                <code>{createdCredentials.email}</code> ·{" "}
                {t("admin.orgs.passwordWord")}{" "}
                <code>{createdCredentials.password}</code>
              </p>
            </div>
          )}
          <Button
            disabled={
              creating ||
              !orgName.trim() ||
              (withOwner &&
                (!ownerName.trim() ||
                  !ownerEmail.trim() ||
                  ownerPassword.length < 8))
            }
            onClick={() => void createOrg()}
          >
            <Building2 className="h-4 w-4" />
            {creating ? t("admin.orgs.creating") : t("admin.orgs.createSubmit")}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("admin.orgs.listTitle")}
        </p>
        {loading && (
          <p className="text-sm text-muted-foreground">
            {t("admin.orgs.loading")}
          </p>
        )}
        {orgs.map((o) => (
          <div key={o.id} className="rounded-lg border bg-card">
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => void toggleExpand(o.id)}
                aria-label={
                  expanded === o.id
                    ? t("admin.orgs.collapse")
                    : t("admin.orgs.viewUsers")
                }
                className="text-muted-foreground hover:text-foreground"
              >
                {expanded === o.id ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{o.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("admin.orgs.stats", {
                    members: o.memberCount,
                    contacts: o.contactCount,
                  })}
                </p>
              </div>
              <Badge variant="secondary">{o.slug}</Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenameError(null);
                  setRenaming({ id: o.id, name: o.name });
                }}
              >
                <Pencil className="h-4 w-4" />
                {t("admin.orgs.rename")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void enter(o.id)}
              >
                <LogIn className="h-4 w-4" />
                {t("admin.orgs.enter")}
              </Button>
            </div>

            {renaming?.id === o.id && (
              <div className="space-y-2 border-t px-4 py-3">
                <Label htmlFor={`rename-${o.id}`}>{t("admin.orgs.renameLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    id={`rename-${o.id}`}
                    value={renaming.name}
                    maxLength={80}
                    onChange={(e) =>
                      setRenaming({ id: o.id, name: e.target.value })
                    }
                  />
                  <Button
                    size="sm"
                    disabled={
                      savingName ||
                      !renaming.name.trim() ||
                      renaming.name.trim().length > 80
                    }
                    onClick={() => void rename()}
                  >
                    {t("admin.orgs.renameSave")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRenaming(null)}
                  >
                    {t("admin.orgs.renameCancel")}
                  </Button>
                </div>
                {renameError && (
                  <p className="text-sm text-destructive">{renameError}</p>
                )}
              </div>
            )}

            {expanded === o.id && (
              <div className="space-y-3 border-t px-4 py-3">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                      {m.role === "owner"
                        ? t("admin.orgs.roleOwner")
                        : t("admin.orgs.roleMember")}
                    </Badge>
                  </div>
                ))}

                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("admin.orgs.addUserTitle")}
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input
                      aria-label={t("admin.orgs.name")}
                      placeholder={t("admin.orgs.name")}
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                    />
                    <Input
                      aria-label={t("admin.orgs.email")}
                      type="email"
                      placeholder={t("admin.orgs.email")}
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Input
                      aria-label={t("admin.orgs.tempPassword")}
                      placeholder={t("admin.orgs.tempPassword")}
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => setNewUserPassword(generatePassword())}
                    >
                      {t("admin.orgs.generate")}
                    </Button>
                  </div>
                  {userError && (
                    <p className="text-sm text-destructive">{userError}</p>
                  )}
                  {userCreated && (
                    <div className="rounded-md border border-success-soft bg-success-tint p-3 text-sm">
                      <p className="font-medium text-success-text">
                        {t("admin.orgs.userCreatedTitle")}
                      </p>
                      <p className="mt-1 text-success-text opacity-90">
                        <code>{userCreated.email}</code> ·{" "}
                        {t("admin.orgs.passwordWord")}{" "}
                        <code>{userCreated.password}</code>
                      </p>
                    </div>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      savingUser ||
                      !newUserName.trim() ||
                      !newUserEmail.trim() ||
                      newUserPassword.length < 8
                    }
                    onClick={() => void addUser(o.id)}
                  >
                    <UserPlus className="h-4 w-4" />
                    {savingUser
                      ? t("admin.orgs.creating")
                      : t("admin.orgs.createAccount")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
