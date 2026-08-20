"use client";

import { useEffect, useState } from "react";
import { Plus, Tag as TagIcon } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { ContactDto, TagDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Editor de etiquetas de un contacto (custom heili.cloud): checkbox por tag
 * existente + creación al vuelo. Guardar = reemplazo total vía PUT.
 */
export function TagEditor({
  contact,
  onClose,
  onSaved,
}: {
  contact: ContactDto;
  onClose: () => void;
  onSaved: (tags: TagDto[]) => void;
}) {
  const { t } = useT();
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    new Set((contact.tags ?? []).map((t) => t.id))
  );
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/tags").catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { tags: TagDto[] };
      setAllTags(data.tags);
    })();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createTag() {
    const name = newName.trim();
    if (!name) return;
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t("contacts.tagEditor.createError"));
      return;
    }
    const data = (await res.json()) as { tag: TagDto };
    setAllTags((prev) =>
      prev.some((t) => t.id === data.tag.id)
        ? prev
        : [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name))
    );
    setSelected((prev) => new Set(prev).add(data.tag.id));
    setNewName("");
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/contacts/${contact.id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagIds: [...selected] }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(t("contacts.tagEditor.saveError"));
      return;
    }
    const data = (await res.json()) as { tags: TagDto[] };
    onSaved(data.tags);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("contacts.tagEditor.ariaLabel", { name: contact.name })}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">
          {t("contacts.tagEditor.title", { name: contact.name })}
        </h3>

        <div className="space-y-1.5">
          {allTags.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("contacts.tagEditor.empty")}
            </p>
          )}
          {allTags.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={() => toggle(t.id)}
                className="accent-primary"
              />
              <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
              {t.name}
            </label>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            placeholder={t("contacts.tagEditor.newPlaceholder")}
            aria-label={t("contacts.tagEditor.newLabel")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createTag();
            }}
          />
          <Button
            variant="outline"
            disabled={!newName.trim()}
            onClick={() => void createTag()}
          >
            <Plus className="h-4 w-4" />
            {t("contacts.tagEditor.create")}
          </Button>
        </div>

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("contacts.cancel")}
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? t("contacts.tagEditor.saving") : t("contacts.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
