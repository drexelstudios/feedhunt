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
import { Loader2 } from "lucide-react";

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
      <DialogContent className="max-w-sm" data-testid={`dialog-edit-feed-${feed.id}`}>
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>
            Edit Feed
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Feed URL</Label>
            <p
              className="text-xs truncate py-1.5 px-2 rounded"
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-edit-category">
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
              <Label>Max items</Label>
              <Select value={String(maxItems)} onValueChange={(v) => setMaxItems(Number(v))}>
                <SelectTrigger data-testid="select-edit-max-items">
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

          <div className="flex gap-2 pt-1">
            <Button
              data-testid="button-save-feed"
              onClick={() => saveMutation.mutate()}
              disabled={!title.trim() || saveMutation.isPending}
              className="flex-1"
            >
              {saveMutation.isPending ? (
                <><Loader2 size={14} className="animate-spin mr-2" /> Saving…</>
              ) : (
                "Save changes"
              )}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
