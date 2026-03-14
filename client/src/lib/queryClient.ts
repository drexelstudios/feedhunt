import { QueryClient } from "@tanstack/react-query";

// Use __PORT_5000__ which deploy_website rewrites to the correct proxy path
export const API_BASE = "__PORT_5000__";

export async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
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
        const res = await fetch(url as string);
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      },
    },
  },
});
