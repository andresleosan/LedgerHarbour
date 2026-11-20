const publicHostname = "ledgerharbour.pages.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== publicHostname) {
      return new Response("Not found", { status: 404 });
    }

    const forwarded = new Request(request, { redirect: "manual" });
    const clientAddress = request.headers.get("CF-Connecting-IP");
    forwarded.headers.delete("x-ledgerharbour-client-ip");
    if (clientAddress) forwarded.headers.set("x-ledgerharbour-client-ip", clientAddress);

    try {
      const upstream = await env.ORIGIN.fetch(forwarded);
      const response = new Response(upstream.body, upstream);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch {
      return new Response("Service unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
