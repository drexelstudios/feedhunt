/**
 * NewsletterManager — Newsletter source management UI
 *
 * Lists all newsletter sources with per-source controls:
 *   - Display limit (5 / 10 / 25 / 50 / All)
 *   - Active toggle
 *   - Delete button
 *
 * Also shows the dedicated inbox address and a "Add source" form for
 * manually pre-registering a sender, plus a "Sync now" button.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  RefreshCw,
  Trash2,
  Plus,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NewsletterSource {
  id: string;
  feed_id: number | null;
  sender_email: string;
  sender_name: string | null;
  display_name: string | null;
  is_active: boolean;
  item_display_limit: number;
  created_at: string;
  last_received_at: string | null;
  item_count: number;
}

interface NewsletterManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// The inbox address shown to users so they can subscribe to newsletters
const INBOX_ADDRESS = import.meta.env.VITE_NEWSLETTER_INBOX_DISPLAY || "newsletters@feedhunt.app";

const LIMIT_OPTIONS = [
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "25", value: 25 },
  { label: "50", value: 50 },
  { label: "All", value: 0 },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewsletterManager({ open, onOpenChange }: NewsletterManagerProps) {
  const { toast } = useToast();
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [copiedInbox, setCopiedInbox] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: sources = [], isLoading } = useQuery<NewsletterSource[]>({
    queryKey: ["/api/newsletter/sources"],
    enabled: open,
    staleTime: 30_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addMutation = useMutation({
    mutationFn: (body: { sender_email: string; display_name?: string }) =>
      apiRequest("POST", "/api/newsletter/sources", body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/newsletter/sources"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      setAddEmail("");
      setAddName("");
      setShowAddForm(false);
      toast({ title: "Source added", description: "It will appear in your feed once newsletters arrive." });
    },
    onError: async (err: any) => {
      // Try to parse the error body
      let msg = err?.message || "Failed to add source";
      try {
        if (err?.response) {
          const body = await (err.response as Response).json();
          msg = body?.error || msg;
        }
      } catch { /* ignore */ }
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<NewsletterSource> }) =>
      apiRequest("PATCH", `/api/newsletter/sources/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletter/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/newsletter/sources/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletter/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      toast({ title: "Source removed" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/newsletter/sync"),
    onSuccess: async (res) => {
      const data = await (res as Response).json();
      await queryClient.invalidateQueries({ queryKey: ["/api/newsletter/sources"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      const processed = data?.processed ?? 0;
      toast({
        title: "Sync complete",
        description: processed === 0
          ? "No new newsletters found."
          : `${processed} new email${processed !== 1 ? "s" : ""} fetched.`,
      });
    },
    onError: (err: Error) =>
      toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAdd = () => {
    const email = addEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Invalid email", description: "Please enter a valid sender email address.", variant: "destructive" });
      return;
    }
    addMutation.mutate({ sender_email: email, display_name: addName.trim() || undefined });
  };

  const handleCopyInbox = async () => {
    try {
      await navigator.clipboard.writeText(INBOX_ADDRESS);
      setCopiedInbox(true);
      setTimeout(() => setCopiedInbox(false), 2000);
    } catch { /* silent */ }
  };

  const handleToggleActive = (source: NewsletterSource) => {
    patchMutation.mutate({ id: source.id, updates: { is_active: !source.is_active } });
  };

  const handleLimitChange = (source: NewsletterSource, value: string) => {
    const limit = parseInt(value, 10);
    patchMutation.mutate({ id: source.id, updates: { item_display_limit: limit } });
  };

  const handleDelete = (source: NewsletterSource) => {
    if (!confirm(`Remove "${source.display_name || source.sender_email}" and all its emails?`)) return;
    deleteMutation.mutate(source.id);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        style={{ maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        <DialogHeader>
          <DialogTitle
            style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-base)" }}
          >
            Newsletter Sources
          </DialogTitle>
        </DialogHeader>

        {/* ── Inbox address ───────────────────────────────────────────────── */}
        <div
          className="rounded-lg p-3"
          style={{
            background: "hsl(var(--muted))",
            border: "1px solid hsl(var(--border))",
          }}
        >
          <p
            className="mb-2"
            style={{ fontSize: "var(--text-xs)", color: "hsl(var(--muted-foreground))" }}
          >
            Subscribe to newsletters using this address. Emails sent here are
            automatically added to your feed.
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 truncate rounded px-2 py-1 text-xs"
              style={{
                background: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))",
                fontFamily: "monospace",
                color: "hsl(var(--foreground))",
              }}
            >
              {INBOX_ADDRESS}
            </code>
            <button
              data-testid="button-copy-inbox"
              onClick={handleCopyInbox}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-accent"
              style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }}
              title="Copy address"
            >
              {copiedInbox ? <Check size={12} style={{ color: "hsl(var(--primary))" }} /> : <Copy size={12} />}
              {copiedInbox ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {/* ── Scrollable source list ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
          {isLoading ? (
            <div className="flex flex-col gap-3 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <div className="skeleton" style={{ width: 32, height: 32, borderRadius: "50%" }} />
                  <div className="flex-1">
                    <div className="skeleton" style={{ height: 13, width: "60%", marginBottom: 4 }} />
                    <div className="skeleton" style={{ height: 11, width: "40%" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : sources.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-10 text-center"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <Mail size={28} className="mb-3 opacity-30" />
              <p style={{ fontSize: "var(--text-sm)" }}>No newsletter sources yet.</p>
              <p style={{ fontSize: "var(--text-xs)", marginTop: 4, opacity: 0.7 }}>
                Subscribe to newsletters using the address above, or add a sender manually.
              </p>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
              {sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onToggleActive={handleToggleActive}
                  onLimitChange={handleLimitChange}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          )}
        </div>

        {/* ── Footer actions ───────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between gap-3 pt-3"
          style={{ borderTop: "1px solid hsl(var(--border))" }}
        >
          <div className="flex items-center gap-2">
            <Button
              data-testid="button-sync-newsletters"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw size={12} className={syncMutation.isPending ? "animate-spin" : ""} />
              Sync now
            </Button>
          </div>

          {showAddForm ? (
            <AddSourceForm
              email={addEmail}
              name={addName}
              onEmailChange={setAddEmail}
              onNameChange={setAddName}
              onSubmit={handleAdd}
              onCancel={() => { setShowAddForm(false); setAddEmail(""); setAddName(""); }}
              isPending={addMutation.isPending}
            />
          ) : (
            <Button
              data-testid="button-add-newsletter-source"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowAddForm(true)}
            >
              <Plus size={12} />
              Add source
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── SourceRow ─────────────────────────────────────────────────────────────────

function SourceRow({
  source,
  onToggleActive,
  onLimitChange,
  onDelete,
}: {
  source: NewsletterSource;
  onToggleActive: (s: NewsletterSource) => void;
  onLimitChange: (s: NewsletterSource, v: string) => void;
  onDelete: (s: NewsletterSource) => void;
}) {
  const displayName = source.display_name || source.sender_name || source.sender_email;

  return (
    <li className="flex items-start gap-3 py-3">
      {/* Avatar */}
      <div
        className="flex-shrink-0 rounded-full flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          background: "hsl(var(--accent))",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        <Mail size={14} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div
          className="font-medium truncate"
          style={{ fontSize: "var(--text-sm)", color: "hsl(var(--foreground))" }}
        >
          {displayName}
        </div>
        {source.display_name && source.sender_email !== displayName && (
          <div
            className="truncate"
            style={{ fontSize: "var(--text-xs)", color: "hsl(var(--muted-foreground))" }}
          >
            {source.sender_email}
          </div>
        )}
        <div
          className="flex items-center gap-2 mt-0.5"
          style={{ fontSize: "var(--text-xs)", color: "hsl(var(--muted-foreground))" }}
        >
          {source.item_count > 0 && (
            <span>{source.item_count} email{source.item_count !== 1 ? "s" : ""}</span>
          )}
          {source.last_received_at && (
            <>
              {source.item_count > 0 && <span>·</span>}
              <span>Last: {timeAgo(source.last_received_at)}</span>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Display limit */}
        <Select
          value={String(source.item_display_limit)}
          onValueChange={(v) => onLimitChange(source, v)}
        >
          <SelectTrigger
            className="h-7 text-xs w-16"
            data-testid={`select-limit-${source.id}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMIT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Active toggle */}
        <Switch
          data-testid={`switch-active-${source.id}`}
          checked={source.is_active}
          onCheckedChange={() => onToggleActive(source)}
          aria-label={`${source.is_active ? "Disable" : "Enable"} ${displayName}`}
        />

        {/* Delete */}
        <button
          data-testid={`button-delete-source-${source.id}`}
          onClick={() => onDelete(source)}
          className="p-1 rounded transition-colors hover:bg-destructive/20"
          style={{ color: "hsl(var(--muted-foreground))" }}
          title="Remove source"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}

// ── AddSourceForm ─────────────────────────────────────────────────────────────

function AddSourceForm({
  email,
  name,
  onEmailChange,
  onNameChange,
  onSubmit,
  onCancel,
  isPending,
}: {
  email: string;
  name: string;
  onEmailChange: (v: string) => void;
  onNameChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        data-testid="input-sender-email"
        placeholder="sender@example.com"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        className="h-7 text-xs w-44"
        autoFocus
      />
      <Input
        data-testid="input-sender-name"
        placeholder="Display name (optional)"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        className="h-7 text-xs w-36"
      />
      <Button
        data-testid="button-confirm-add-source"
        size="sm"
        className="h-7 text-xs px-3"
        onClick={onSubmit}
        disabled={isPending || !email.trim()}
      >
        {isPending ? <RefreshCw size={11} className="animate-spin" /> : "Add"}
      </Button>
      <button
        data-testid="button-cancel-add-source"
        onClick={onCancel}
        className="p-1 rounded text-xs transition-colors hover:bg-accent"
        style={{ color: "hsl(var(--muted-foreground))" }}
        title="Cancel"
      >
        Cancel
      </button>
    </div>
  );
}
