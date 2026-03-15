import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Globe,
  AlertCircle,
  Clock,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const INTERVAL_OPTIONS = [
  { value: 6,  label: "Every 6 hours" },
  { value: 12, label: "Every 12 hours" },
  { value: 24, label: "Once a day" },
  { value: 48, label: "Every 2 days" },
];

interface FeedCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedCreated?: (feedUrl: string, title: string) => void;
}

interface ScrapedPost {
  title: string;
  link: string;
  description: string;
  pub_date: string | null;
}

interface ScrapeResult {
  success: boolean;
  feed: {
    id: string;
    feed_slug: string;
    site_title: string;
    site_description: string;
    source_url: string;
    last_scraped_at: string;
  };
  posts: ScrapedPost[];
  error?: string;
}

type Step = "input" | "scanning" | "preview" | "done";

export default function FeedCreatorDialog({
  open,
  onOpenChange,
  onFeedCreated,
}: FeedCreatorDialogProps) {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);
  const { toast } = useToast();

  const intervalMutation = useMutation({
    mutationFn: async ({ feedId, hours }: { feedId: string; hours: number }) => {
      const res = await apiRequest("PATCH", `/api/scrape/feeds/${feedId}`, { scrape_interval_hours: hours });
      return res.json();
    },
  });

  const scrapeMutation = useMutation({
    mutationFn: async ({ url, feedId }: { url: string; feedId?: string }) => {
      const res = await apiRequest("POST", "/api/scrape", { url, feedId });
      return res.json() as Promise<ScrapeResult>;
    },
    onSuccess: (data) => {
      if (!data.success && data.error) {
        toast({ title: "Scan failed", description: data.error, variant: "destructive" });
        setStep("input");
        return;
      }
      setResult(data);
      setStep("preview");
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
      setStep("input");
    },
  });

  const handleScan = () => {
    if (!url.trim()) return;
    let normalized = url.trim();
    if (!/^https?:\/\//.test(normalized)) normalized = "https://" + normalized;
    setUrl(normalized);
    setStep("scanning");
    scrapeMutation.mutate({ url: normalized });
  };

  const handleRescan = () => {
    if (!result?.feed) return;
    setStep("scanning");
    scrapeMutation.mutate({ url: result.feed.source_url, feedId: result.feed.id });
  };

  const feedUrl = result
    ? `${window.location.origin}/api/feed/${result.feed.feed_slug}`
    : "";

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddToFeedhunt = () => {
    if (!result) return;
    onFeedCreated?.(feedUrl, result.feed.site_title || result.feed.source_url);
    handleClose();
  };

  const handleIntervalChange = (value: string) => {
    const hours = parseInt(value);
    setIntervalHours(hours);
    if (result?.feed?.id) {
      intervalMutation.mutate({ feedId: result.feed.id, hours });
    }
  };

  const handleClose = () => {
    setUrl("");
    setStep("input");
    setResult(null);
    setCopied(false);
    setIntervalHours(24);
    onOpenChange(false);
  };

  const formatDate = (d: string | null) => {
    if (!d) return "";
    try { return new Date(d).toLocaleDateString(); } catch { return ""; }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-feed-creator">
        <DialogHeader>
          <DialogTitle
            className="flex items-center gap-2"
            style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
          >
            <Sparkles size={18} style={{ color: "hsl(var(--primary))" }} />
            Feed Creator
          </DialogTitle>
          <DialogDescription>
            Generate an RSS feed from any website using AI.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: Input ── */}
        {(step === "input" || step === "scanning") && (
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="creator-url">Website URL</Label>
              <div className="flex gap-2">
                <Input
                  id="creator-url"
                  data-testid="input-creator-url"
                  placeholder="https://www.superhuman.ai"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && step === "input" && handleScan()}
                  disabled={step === "scanning"}
                />
                <Button
                  data-testid="button-scan"
                  onClick={handleScan}
                  disabled={!url.trim() || step === "scanning"}
                  className="shrink-0 gap-2"
                >
                  {step === "scanning" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {step === "scanning" ? "Scanning…" : "Scan"}
                </Button>
              </div>
            </div>

            {step === "scanning" && (
              <div
                className="rounded-xl p-5 flex flex-col items-center gap-3 text-center"
                style={{ background: "hsl(var(--accent))" }}
              >
                <div className="relative">
                  <Globe
                    size={32}
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  />
                  <Loader2
                    size={16}
                    className="animate-spin absolute -top-1 -right-1"
                    style={{ color: "hsl(var(--primary))" }}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                    AI is reading the page…
                  </p>
                  <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Fetching content and extracting articles. This takes 10–20 seconds.
                  </p>
                </div>
                {/* Animated progress dots */}
                <div className="flex gap-1.5 mt-1">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{
                        background: "hsl(var(--primary))",
                        animationDelay: `${i * 150}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div
              className="rounded-lg p-3"
              style={{ background: "hsl(var(--muted))" }}
            >
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                Feed Creator works best on newsletter archives, blog index pages, and publication homepages.
                It generates a live RSS feed URL you can subscribe to from any reader.
              </p>
            </div>
          </div>
        )}

        {/* ── Step: Preview ── */}
        {step === "preview" && result && (
          <div className="space-y-4 pt-1">
            {/* Site info */}
            <div
              className="rounded-xl p-4 flex items-start gap-3"
              style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--border))" }}
            >
              <Globe size={18} style={{ color: "hsl(var(--primary))", flexShrink: 0, marginTop: 2 }} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate" style={{ color: "hsl(var(--foreground))" }}>
                  {result.feed.site_title}
                </p>
                {result.feed.site_description && (
                  <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {result.feed.site_description}
                  </p>
                )}
                <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {result.posts.length} article{result.posts.length !== 1 ? "s" : ""} found
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-xs gap-1">
                <Sparkles size={10} />
                AI
              </Badge>
            </div>

            {/* Scrape interval */}
            <div
              className="rounded-lg p-3 flex items-center justify-between gap-3"
              style={{ background: "hsl(var(--muted))" }}
            >
              <div className="flex items-center gap-2">
                <Clock size={14} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>
                    Auto-refresh
                  </p>
                  <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    How often to re-scan for new posts
                  </p>
                </div>
              </div>
              <Select
                value={String(intervalHours)}
                onValueChange={handleIntervalChange}
              >
                <SelectTrigger
                  className="w-36 h-7 text-xs"
                  data-testid="select-interval"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Generated feed URL */}
            <div className="space-y-1.5">
              <Label style={{ fontSize: "var(--text-sm)" }}>Your RSS feed URL</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={feedUrl}
                  className="text-xs font-mono"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={handleCopyUrl}
                  title="Copy feed URL"
                >
                  {copied ? <Check size={14} style={{ color: "hsl(var(--primary))" }} /> : <Copy size={14} />}
                </Button>
              </div>
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                Use this URL in any RSS reader, or click "Add to Feedhunt" below.
              </p>
            </div>

            {/* Extracted posts preview */}
            {result.posts.length > 0 && (
              <div className="space-y-1.5">
                <Label style={{ fontSize: "var(--text-sm)" }}>Extracted articles</Label>
                <div
                  className="rounded-lg divide-y overflow-hidden"
                  style={{ border: "1px solid hsl(var(--border))", divideColor: "hsl(var(--border))" }}
                >
                  {result.posts.slice(0, 8).map((post, i) => (
                    <a
                      key={i}
                      href={post.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2.5 p-3 hover:bg-accent transition-colors group"
                      style={{ borderTop: i > 0 ? "1px solid hsl(var(--border))" : "none" }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-snug line-clamp-2" style={{ color: "hsl(var(--foreground))" }}>
                          {post.title}
                        </p>
                        {post.pub_date && (
                          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {formatDate(post.pub_date)}
                          </p>
                        )}
                      </div>
                      <ExternalLink
                        size={12}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      />
                    </a>
                  ))}
                </div>
                {result.posts.length > 8 && (
                  <p className="text-xs text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                    +{result.posts.length - 8} more articles in the feed
                  </p>
                )}
              </div>
            )}

            {result.posts.length === 0 && (
              <div
                className="rounded-lg p-4 flex items-start gap-3"
                style={{ background: "hsl(var(--destructive) / 0.08)", border: "1px solid hsl(var(--destructive) / 0.2)" }}
              >
                <AlertCircle size={16} style={{ color: "hsl(var(--destructive))", flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: "hsl(var(--destructive))" }}>
                    No articles found
                  </p>
                  <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Try scanning a blog archive or newsletter index page instead of the homepage.
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                data-testid="button-add-to-feedhunt"
                onClick={handleAddToFeedhunt}
                disabled={result.posts.length === 0}
                className="flex-1 gap-2"
              >
                Add to Feedhunt
              </Button>
              <Button
                data-testid="button-rescan"
                variant="outline"
                onClick={handleRescan}
                disabled={scrapeMutation.isPending}
                className="gap-2"
                title="Re-scan with AI"
              >
                {scrapeMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Re-scan
              </Button>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
