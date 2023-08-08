export function urlToObject(url: URL) {
  return {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    searchParams: [...url.searchParams].map(([key, value]) => ({ key, value })),
    hash: url.hash,
    origin: url.origin,
  };
}
