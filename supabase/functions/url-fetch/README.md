# url-fetch

Server-side URL fetcher used by the Sermons app's
`/resources/extract` page. Browsers can't fetch arbitrary external
URLs because of CORS — this Edge Function does it for them, then
strips HTML to plain text and returns the result.

## Auth

Same as `claude-proxy`: requires a Supabase JWT in the `Authorization:
Bearer ...` header. Any authenticated user can call.

## Request

```http
POST /functions/v1/url-fetch
Authorization: Bearer <jwt>
Content-Type: application/json

{ "url": "https://example.com/article" }
```

## Response

```json
{
  "text": "...plain text body...",
  "title": "Article title from <title>",
  "finalUrl": "https://example.com/article"
}
```

## Limits

- 5 MB raw response cap
- 200,000 characters of decoded text returned
- 30 second fetch timeout
- Refuses non-`http(s)` URLs
- Refuses obvious local / RFC1918 / link-local hosts (so it can't be
  used to probe the church's internal network from outside)

## Deploy

```bash
supabase functions deploy url-fetch
```

No additional secrets required.
