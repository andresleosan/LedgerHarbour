export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    url.protocol = "http:";
    const upstream = new Request(url, request);
    upstream.headers.delete("forwarded");
    upstream.headers.set("x-forwarded-host", url.host);
    upstream.headers.set("x-forwarded-proto", "https");
    upstream.headers.set("x-forwarded-port", "443");
    return env.PRIVATE_APP.fetch(upstream, { redirect: "manual" });
  },
};
