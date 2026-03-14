import { Link } from "wouter";

export default function NotFound() {
  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
    >
      <div className="text-center">
        <p className="text-6xl font-bold mb-4" style={{ fontFamily: "var(--font-display)" }}>
          404
        </p>
        <p className="mb-6" style={{ color: "hsl(var(--muted-foreground))" }}>
          Page not found
        </p>
        <Link href="/">
          <a
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            Back to dashboard
          </a>
        </Link>
      </div>
    </div>
  );
}
