import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Rss } from "lucide-react";

interface AddFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  initialUrl?: string;
}

interface FeedPreview {
  title: string;
  description: string;
  items: { title: string; pubDate: string }[];
}

export default function AddFeedDialog({ open, onOpenChange, categories, initialUrl }: AddFeedDialogProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [maxItems, setMaxItems] = useState(10);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const { toast } = useToast();

  const previewMutation = useMutation({
    mutationFn: async (feedUrl: string) => {
      const res = await apiRequest("POST", "/api/feeds/preview", { url: feedUrl });
      return res.json() as Promise<FeedPreview>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setTitle(data.title || url);
      setPreviewError("");
    },
    onError: (err: Error) => {
      setPreviewError(err.message);
      setPreview(null);
    },
  });

  const addMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/feeds", {
        url,
        title: title || url,
        description: preview?.description || "",
        favicon: "",
        category,
        maxItems,
        collapsed: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      toast({ title: "Feed added", description: `"${title}" has been added to your dashboard.` });
      handleClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // When dialog opens with a pre-filled URL (e.g. from Feed Creator), auto-preview it
  useEffect(() => {
    if (open && initialUrl) {
      setUrl(initialUrl);
      previewMutation.mutate(initialUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);

  const handleClose = () => {
    setUrl("");
    setTitle("");
    setCategory("General");
    setMaxItems(10);
    setPreview(null);
    setPreviewError("");
    onOpenChange(false);
  };

  const handlePreview = () => {
    if (!url.trim()) return;
    previewMutation.mutate(url.trim());
  };

  const allCategories = Array.from(new Set(["General", "News", "Tech", "Design", "Science", "Business", "Sports", "Health", "Entertainment", ...categories]));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-add-feed">
        <DialogHeader>
          <DialogTitle
            style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
          >
            Add RSS Feed
          </DialogTitle>
          <DialogDescription>
            Paste an RSS or Atom feed URL to add it to your dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="feed-url">Feed URL</Label>
            <div className="flex gap-2">
              <Input
                id="feed-url"
                data-testid="input-feed-url"
                placeholder="https://example.com/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePreview()}
              />
              <Button
                data-testid="button-preview-feed"
                variant="secondary"
                size="sm"
                onClick={handlePreview}
                disabled={!url.trim() || previewMutation.isPending}
                className="shrink-0"
              >
                {previewMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Search size={14} />
                )}
              </Button>
            </div>
          </div>

          {/* Preview */}
          {previewError && (
            <div
              className="rounded-lg p-3 text-sm"
              style={{
                background: "hsl(var(--destructive) / 0.1)",
                color: "hsl(var(--destructive))",
                border: "1px solid hsl(var(--destructive) / 0.3)",
              }}
            >
              {previewError}
            </div>
          )}

          {preview && (
            <div
              className="rounded-lg p-3 overflow-hidden"
              style={{
                background: "hsl(var(--accent))",
                border: "1px solid hsl(var(--border))",
              }}
              data-testid="feed-preview"
            >
              <div className="flex items-start gap-2 mb-2 min-w-0">
                <Rss size={14} style={{ color: "hsl(var(--primary))", marginTop: 2, flexShrink: 0 }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight truncate">{preview.title}</p>
                  {preview.description && (
                    <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {preview.description.slice(0, 120)}
                    </p>
                  )}
                </div>
              </div>
              {preview.items.length > 0 && (
                <ul className="text-xs space-y-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {preview.items.slice(0, 3).map((item, i) => (
                    <li key={i} className="truncate">· {item.title}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="feed-title">Title</Label>
            <Input
              id="feed-title"
              data-testid="input-feed-title"
              placeholder="My Feed"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Category + Max items */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allCategories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-items">Max items</Label>
              <Select value={String(maxItems)} onValueChange={(v) => setMaxItems(Number(v))}>
                <SelectTrigger data-testid="select-max-items">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 8, 10, 15, 20, 25].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              data-testid="button-add-feed-submit"
              onClick={() => addMutation.mutate()}
              disabled={!url.trim() || !title.trim() || addMutation.isPending}
              className="flex-1"
            >
              {addMutation.isPending ? (
                <><Loader2 size={14} className="animate-spin mr-2" /> Adding…</>
              ) : (
                "Add Feed"
              )}
            </Button>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
