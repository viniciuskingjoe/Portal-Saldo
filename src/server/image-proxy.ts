const ALLOWED_HOSTS = new Set([
  "dfcl9ybffzusy.cloudfront.net",
]);

function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host);
}

export async function handleImageProxyRequest(request: Request): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== "/api/image") return null;

  const rawTarget = requestUrl.searchParams.get("url");
  if (!rawTarget) {
    return Response.json({ message: "URL da imagem nao informada." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    return Response.json({ message: "URL da imagem invalida." }, { status: 400 });
  }

  if (!["http:", "https:"].includes(target.protocol) || !isAllowedImageHost(target.hostname)) {
    return Response.json({ message: "Origem da imagem nao permitida." }, { status: 400 });
  }

  const response = await fetch(target, {
    headers: {
      "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    return Response.json(
      { message: "Nao foi possivel carregar a imagem." },
      { status: response.status },
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return Response.json({ message: "O arquivo informado nao e uma imagem." }, { status: 415 });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": contentType,
    },
  });
}
