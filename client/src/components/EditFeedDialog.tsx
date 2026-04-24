import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Feed } from "@shared/schema";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";

interface EditFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feed: Feed;
}



export default function EditFeedDialog({ open, onOpenChange, feed }: EditFeedDialogProps) {
  const [title, setTitle] = useState(feed.title);
  const [category, setCategory] = useState(feed.category);
  const [maxItems, setMaxItems] = useState(feed.maxItems);
  const { toast } = useToast();

  // Live category list — picks up any tabs the user has created
  const { data: categoryData = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/categories"],
  });
  const allCategories = categoryData.map((c) => c.name);

  useEffect(() => {
    setTitle(feed.title);
    setCategory(feed.category);
    setMaxItems(feed.maxItems);
  }, [feed]);

  // Re-scan (only for scraped/Feed Creator feeds — url contains /api/feed/<slug>)
  const feedCreatorSlug = (() => {
    try {
      const u = new URL(feed.url);
      const m = u.pathname.match(/\/api\/feed\/([^/]+)/);
      return m ? m[1] : null;
    } catch { return null; }
  })();
  const isScrapedFeed = !!feedCreatorSlug;

  const rescanMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/scrape/rescan", { slug: feedCreatorSlug, feedId: feed.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      queryClient.invalidateQueries({ queryKey: [`/api/feeds/${feed.id}/items`] });
      toast({ title: "Re-scan complete", description: "Feed items have been refreshed." });
    },
    onError: (err: Error) => {
      toast({ title: "Re-scan failed", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/feeds/${feed.id}`, { title, category, maxItems }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      toast({ title: "Feed updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md overflow-hidden" data-testid={`dialog-edit-feed-${feed.id}`}>
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>
            Edit Feed
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1 min-w-0">
          <div className="space-y-1.5">
            <Label>Feed URL</Label>
            <p
              className="text-xs py-1.5 px-2 rounded w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap block"
              style={{
                background: "hsl(var(--muted))",
                color: "hsl(var(--muted-foreground))",
                fontFamily: "monospace",
              }}
            >
              {feed.url}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              data-testid="input-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="space-y-1.5 flex-1 min-w-[120px]">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-edit-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allCategories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 w-[100px]">
              <Label>Max items</Label>
              <Select value={String(maxItems)} onValueChange={(v) => setMaxItems(Number(v))}>
                <SelectTrigger data-testid="select-edit-max-items" className="w-full">
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

          <div className="flex flex-col gap-2 pt-1">
            <div className="flex gap-2 w-full">
              <Button
                data-testid="button-save-feed"
                onClick={() => saveMutation.mutate()}
                disabled={!title.trim() || saveMutation.isPending}
                className="flex-1 min-w-0"
              >
                {saveMutation.isPending ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Saving…</>
                ) : (
                  "Save changes"
                )}
              </Button>
              <Button variant="ghost" className="shrink-0" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
            {isScrapedFeed && (
              <Button
                variant="outline"
                size="sm"
                data-testid="button-rescan-feed"
                onClick={() => rescanMutation.mutate()}
                disabled={rescanMutation.isPending}
                className="w-full"
              >
                {rescanMutation.isPending ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Re-scanning…</>
                ) : (
                  <><RefreshCw size={14} className="mr-2" /> Re-scan feed</>  
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
