import { useState } from "react";
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
import { Loader2, Search, Newspaper } from "lucide-react";

interface SearchFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
}

interface FeedPreview {
  title: string;
  description: string;
  items: { title: string; pubDate: string }[];
}

function buildGoogleNewsUrl(keyword: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`;
}

export default function SearchFeedDialog({ open, onOpenChange, categories }: SearchFeedDialogProps) {
  const [keyword, setKeyword] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("News");
  const [maxItems, setMaxItems] = useState(10);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const { toast } = useToast();

  const previewMutation = useMutation({
    mutationFn: async (searchKeyword: string) => {
      const url = buildGoogleNewsUrl(searchKeyword);
      setGeneratedUrl(url);
      const res = await apiRequest("POST", "/api/feeds/preview", { url });
      return res.json() as Promise<FeedPreview>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setTitle(`${keyword} News`);
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
        url: generatedUrl,
        title: title || `${keyword} News`,
        description: `News search results for "${keyword}"`,
        favicon: "",
        category,
        maxItems,
        collapsed: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      toast({ title: "Search feed added", description: `"${title}" has been added to your dashboard.` });
      handleClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setKeyword("");
    setTitle("");
    setCategory("News");
    setMaxItems(10);
    setPreview(null);
    setPreviewError("");
    setGeneratedUrl("");
    onOpenChange(false);
  };

  const handleSearch = () => {
    if (!keyword.trim()) return;
    previewMutation.mutate(keyword.trim());
  };

  const allCategories = Array.from(new Set(["General", "News", "Tech", "Design", "Science", "Business", "Sports", "Health", "Entertainment", ...categories]));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto" style={{ overflowX: "hidden" }} data-testid="dialog-search-feed">
        <DialogHeader>
          <DialogTitle
            style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
          >
            Search Feed
          </DialogTitle>
          <DialogDescription className="text-sm" style={{ overflowWrap: "break-word" }}>
            Enter a keyword or topic to create a feed from news search results.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1 min-w-0 overflow-hidden">
          {/* Keyword */}
          <div className="space-y-1.5">
            <Label htmlFor="search-keyword">Keyword or topic</Label>
            <div className="flex gap-2">
              <Input
                id="search-keyword"
                data-testid="input-search-keyword"
                placeholder='e.g. "Apple", "electric vehicles", "NBA"'
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                autoFocus
              />
              <Button
                data-testid="button-search-preview"
                variant="secondary"
                size="sm"
                onClick={handleSearch}
                disabled={!keyword.trim() || previewMutation.isPending}
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

          {/* Preview error */}
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

          {/* Preview results */}
          {preview && (
            <div
              className="rounded-lg p-3 min-w-0"
              style={{
                background: "hsl(var(--accent))",
                border: "1px solid hsl(var(--border))",
                overflow: "hidden",
              }}
              data-testid="search-preview"
            >
              <div className="flex items-start gap-2 mb-2 min-w-0">
                <Newspaper size={14} style={{ color: "hsl(var(--primary))", marginTop: 2, flexShrink: 0 }} />
                <p className="text-sm font-semibold leading-tight min-w-0 truncate">
                  {preview.items.length} results for "{keyword}"
                </p>
              </div>
              {preview.items.length > 0 && (
                <ul className="text-xs space-y-1" style={{ color: "hsl(var(--muted-foreground))", overflow: "hidden" }}>
                  {preview.items.slice(0, 3).map((item, i) => (
                    <li key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {item.title}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Title + config (shown after preview) */}
          {preview && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="search-title">Feed title</Label>
                <Input
                  id="search-title"
                  data-testid="input-search-title"
                  placeholder="My Search Feed"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="space-y-1.5 flex-1 min-w-[120px]">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger data-testid="select-search-category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allCategories.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 w-[100px] shrink-0">
                  <Label>Max items</Label>
                  <Select value={String(maxItems)} onValueChange={(v) => setMaxItems(Number(v))}>
                    <SelectTrigger data-testid="select-search-max-items" className="w-full">
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
            </>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {preview ? (
              <Button
                data-testid="button-add-search-feed"
                onClick={() => addMutation.mutate()}
                disabled={!title.trim() || addMutation.isPending}
                className="flex-1 min-w-0"
              >
                {addMutation.isPending ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Adding…</>
                ) : (
                  "Add Feed"
                )}
              </Button>
            ) : (
              <Button
                onClick={handleSearch}
                disabled={!keyword.trim() || previewMutation.isPending}
                className="flex-1 min-w-0"
              >
                {previewMutation.isPending ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Searching…</>
                ) : (
                  "Search"
                )}
              </Button>
            )}
            <Button variant="ghost" onClick={handleClose} className="shrink-0">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
