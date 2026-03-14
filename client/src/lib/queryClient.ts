import { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";

// Empty base — API calls use relative paths (works on Vercel and local dev)
export const API_BASE = "";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    };
  }
  return { "Content-Type": "application/json" };
}

export async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
      queryFn: async ({ queryKey }) => {
        const url = `${API_BASE}${queryKey[0]}`;
        const headers = await getAuthHeaders();
        const res = await fetch(url as string, { headers });
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      },
    },
  },
});
