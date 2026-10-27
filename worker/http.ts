import type { Env } from './env';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export const nowIso = () => new Date().toISOString();

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  exec: ExecutionContext;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  public: boolean;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler, opts: { public?: boolean } = {}) {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/:(\w+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, pattern, keys, handler, public: !!opts.public });
    return this;
  }

  get = (p: string, h: Handler, o?: { public?: boolean }) => this.add('GET', p, h, o);
  post = (p: string, h: Handler, o?: { public?: boolean }) => this.add('POST', p, h, o);
  put = (p: string, h: Handler, o?: { public?: boolean }) => this.add('PUT', p, h, o);
  patch = (p: string, h: Handler, o?: { public?: boolean }) => this.add('PATCH', p, h, o);
  delete = (p: string, h: Handler, o?: { public?: boolean }) => this.add('DELETE', p, h, o);

  match(method: string, path: string) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }
}

export async function readJson<T = any>(req: Request): Promise<T> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > 1_500_000) throw new HttpError(413, 'La información enviada es demasiado grande.');
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Formato de datos inválido.');
  }
}

// ---------- Validación sencilla ----------

export function str(v: unknown, max = 500): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function reqStr(v: unknown, field: string, max = 500): string {
  const s = str(v, max);
  if (!s) throw new HttpError(400, `El campo "${field}" es obligatorio.`);
  return s;
}

export function num(v: unknown, field: string, { min = -Infinity, max = Infinity } = {}): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `El campo "${field}" debe ser un número.`);
  if (n < min || n > max) throw new HttpError(400, `El campo "${field}" está fuera de rango.`);
  return Math.round(n * 100) / 100;
}

export function optInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

export function isoDate(v: unknown, field: string): string {
  const s = String(v ?? '');
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) throw new HttpError(400, `Fecha inválida en "${field}".`);
  return d.toISOString();
}

export function ymdOrNull(v: unknown): string | null {
  const s = str(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'Fecha inválida (usa AAAA-MM-DD).');
  return s;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw new HttpError(400, `Valor inválido en "${field}".`);
  return v as T;
}
